/**
 * What the chat composer's pick lists offer (TR-232): the agent's slash commands for `/`, the files of
 * the agent's working directory for `@`, the project's tickets for `#`, and the commands the user
 * picked lately. Ranking is the client's (`shared/composer-picks.ts`); this only gathers the lists.
 */
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { rememberCommand, type AgentCommand, type FileIndex, type TicketSummary } from "../shared/composer-picks";
import { fetchLiveAgent } from "./agents";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import type { PaseoApi } from "./host-types";
import { runCommand, type CommandOptions, type CommandResult } from "./process";
import { projectPaths, requireProjectConfig } from "./projects";
import { serialized } from "./serialize";
import { listTickets } from "./tickets";

export type CommandRunner = (command: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>;

const MAX_FILES = 20_000;
const MAX_WALK_DEPTH = 8;
const RECENT_COMMITS = 30;
const MAX_RECENT_FILES = 30;
/** The composer asks again each time `@` is typed; a few seconds' old list is good enough and spares git. */
const FILE_INDEX_FRESH_MS = 10_000;
const GIT_TIMEOUT_MS = 10_000;
const SKIPPED_FOLDERS = new Set([".git", "node_modules"]);

/** The agent's commands as its provider lists them, each name once; a provider's failure is reported, not thrown. */
export async function agentCommands(paseo: PaseoApi, agentId: string): Promise<{ commands: AgentCommand[]; error: string | null }> {
  try {
    const answer = await paseo.agents.ref(agentId).commands();
    const seen = new Set<string>();
    const commands: AgentCommand[] = [];
    answer.commands.forEach((command) => {
      if (seen.has(command.name)) return;
      seen.add(command.name);
      commands.push({ name: command.name, description: command.description, argumentHint: command.argumentHint, ...(command.kind === undefined ? {} : { kind: command.kind }) });
    });
    return { commands, error: answer.error ?? null };
  } catch (error) {
    return { commands: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** The files the agent's `@` list offers, from the agent's own working directory as Paseo knows it. */
export async function projectFiles(paseo: PaseoApi, project: string, agentId: string, runner: CommandRunner = runCommand): Promise<FileIndex> {
  const config = await requireProjectConfig(project);
  const agent = await fetchLiveAgent(paseo, agentId);
  if (agent === null) throw new Error("This agent is gone.");
  const isFolder = await stat(agent.cwd).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (!isFolder) throw new Error(`This agent's folder ${agent.cwd} no longer exists.`);
  return fileIndexOf(agent.cwd, config.baseBranch, runner);
}

const fileIndexes = new Map<string, { at: number; index: Promise<FileIndex> }>();

/** The folder's file index, from a call in the last ten seconds when there was one. */
export function fileIndexOf(cwd: string, baseBranch: string, runner: CommandRunner = runCommand): Promise<FileIndex> {
  const key = `${cwd}\n${baseBranch}`;
  const cached = fileIndexes.get(key);
  if (cached !== undefined && Date.now() - cached.at < FILE_INDEX_FRESH_MS) return cached.index;
  const index = buildFileIndex(cwd, baseBranch, runner);
  fileIndexes.set(key, { at: Date.now(), index });
  // A failure is not kept: the next call tries again.
  index.catch(() => {
    if (fileIndexes.get(key)?.index === index) fileIndexes.delete(key);
  });
  return index;
}

/** For tests: every folder is read again. */
export function forgetFileIndexes(): void {
  fileIndexes.clear();
}

async function buildFileIndex(cwd: string, baseBranch: string, runner: CommandRunner): Promise<FileIndex> {
  const fromGit = await gitFileIndex(cwd, baseBranch, runner).catch(() => null);
  if (fromGit !== null) return fromGit;
  const walked = await walkFiles(cwd);
  return { files: walked.files, changed: [], recent: [], truncated: walked.truncated };
}

/** Runs git in the folder; a failure to start counts as a failed run. */
async function git(runner: CommandRunner, cwd: string, args: readonly string[]): Promise<CommandResult> {
  return runner("git", ["-c", "core.quotepath=off", ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS }).catch((error: unknown) => ({
    code: null,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));
}

function nulSeparated(output: string): string[] {
  return output
    .split("\0")
    .map((entry) => entry.replace(/^\n+/, ""))
    .filter((entry) => entry !== "");
}

/** Null when the folder is not in a git work tree or git fails there. */
async function gitFileIndex(cwd: string, baseBranch: string, runner: CommandRunner): Promise<FileIndex | null> {
  const [listed, prefixRun] = await Promise.all([git(runner, cwd, ["ls-files", "-co", "--exclude-standard", "-z"]), git(runner, cwd, ["rev-parse", "--show-prefix"])]);
  if (listed.code !== 0 || prefixRun.code !== 0) return null;
  // Diff, status and log name paths from the repository's top; the list names them from the agent's folder.
  const prefix = prefixRun.stdout.trim();
  const fromCwd = (path: string): string | null => (path.startsWith(prefix) ? path.slice(prefix.length) : null);
  const all = [...new Set(nulSeparated(listed.stdout))];
  const files = all.slice(0, MAX_FILES);
  const [changed, recent] = await Promise.all([changedFiles(runner, cwd, baseBranch, fromCwd), recentFiles(runner, cwd, fromCwd, new Set(files))]);
  return { files, changed, recent, truncated: all.length > MAX_FILES };
}

type ChangeStatus = "new" | "changed";

/** Files that differ from where the branch left the base branch, and uncommitted ones; deleted files are left out. */
async function changedFiles(runner: CommandRunner, cwd: string, baseBranch: string, fromCwd: (path: string) => string | null): Promise<{ path: string; status: ChangeStatus }[]> {
  const statuses = new Map<string, ChangeStatus>();
  const note = (rootPath: string, status: ChangeStatus): void => {
    const path = fromCwd(rootPath);
    if (path === null || path === "") return;
    // A file new on the branch and edited since is still new.
    if (statuses.get(path) !== "new") statuses.set(path, status);
  };
  const mergeBase = await git(runner, cwd, ["merge-base", "HEAD", baseBranch]);
  const base = mergeBase.stdout.trim();
  if (mergeBase.code === 0 && base !== "") {
    const diff = await git(runner, cwd, ["diff", "--name-status", "-z", base]);
    if (diff.code === 0) {
      const entries = diff.stdout.split("\0");
      for (let index = 0; index < entries.length; index += 1) {
        const code = entries[index] ?? "";
        if (code === "") continue;
        const letter = code.charAt(0);
        // A rename or copy names the old path, then the new one.
        if (letter === "R" || letter === "C") {
          const newPath = entries[index + 2] ?? "";
          index += 2;
          note(newPath, letter === "C" ? "new" : "changed");
          continue;
        }
        const path = entries[index + 1] ?? "";
        index += 1;
        if (letter === "D") continue;
        note(path, letter === "A" ? "new" : "changed");
      }
    }
  }
  const status = await git(runner, cwd, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  if (status.code === 0) {
    const entries = status.stdout.split("\0");
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] ?? "";
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      const path = entry.slice(3);
      // A rename's old path follows as an entry of its own.
      if (code.includes("R") || code.includes("C")) index += 1;
      if (code.includes("D")) continue;
      note(path, code === "??" || code.includes("A") || code.includes("C") ? "new" : "changed");
    }
  }
  return [...statuses].map(([path, status]) => ({ path, status }));
}

/** Files the last commits touched, newest first, each once, only those still listed. */
async function recentFiles(runner: CommandRunner, cwd: string, fromCwd: (path: string) => string | null, existing: ReadonlySet<string>): Promise<string[]> {
  const log = await git(runner, cwd, ["log", "-n", String(RECENT_COMMITS), "--name-only", "--format=", "-z"]);
  if (log.code !== 0) return [];
  const recent: string[] = [];
  for (const rootPath of nulSeparated(log.stdout)) {
    const path = fromCwd(rootPath);
    if (path === null || !existing.has(path) || recent.includes(path)) continue;
    recent.push(path);
    if (recent.length >= MAX_RECENT_FILES) break;
  }
  return recent;
}

/** A folder outside git: its files level by level, skipping dot-folders and `node_modules`, bounded in depth and count. */
async function walkFiles(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  let level: string[] = [""];
  for (let depth = 0; depth < MAX_WALK_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const folder of level) {
      const entries: Dirent[] = await readdir(join(root, folder), { withFileTypes: true }).catch(() => []);
      entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
      for (const entry of entries) {
        const path = `${folder}${entry.name}`;
        if (entry.isDirectory()) {
          if (!SKIPPED_FOLDERS.has(entry.name) && !entry.name.startsWith(".")) next.push(`${path}/`);
          continue;
        }
        if (files.length >= MAX_FILES) return { files, truncated: true };
        files.push(path);
      }
    }
    level = next;
  }
  return { files, truncated: false };
}

/** Every ticket of the project's tracker, as the `#` list needs it. */
export async function ticketsForPicks(project: string): Promise<TicketSummary[]> {
  await requireProjectConfig(project);
  const tickets = await listTickets((await projectPaths(project)).tracker);
  return tickets.map((ticket) => ({ id: ticket.id, title: ticket.title, status: ticket.status }));
}

const RecentCommandsSchema = z.array(z.string());

async function recentCommandsFile(project: string): Promise<string> {
  await requireProjectConfig(project);
  return join((await projectPaths(project)).home, "recent-commands.json");
}

async function readNames(file: string): Promise<string[]> {
  try {
    return RecentCommandsSchema.parse((await readJsonIfPresent(file)) ?? []);
  } catch {
    // A damaged file starts the list over rather than failing the composer.
    return [];
  }
}

/** The commands the user picked lately in this project, latest first. */
export async function recentCommands(project: string): Promise<string[]> {
  return readNames(await recentCommandsFile(project));
}

export async function rememberRecentCommand(project: string, name: string): Promise<string[]> {
  const file = await recentCommandsFile(project);
  return serialized(file, async () => {
    const names = rememberCommand(await readNames(file), name);
    await writeJsonAtomically(file, names);
    return names;
  });
}
