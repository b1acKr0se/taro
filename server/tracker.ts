/**
 * A project's tracker: a git worktree of the project's repository on the
 * `taro/backlog` branch, holding a Backlog.md project (decision 31). The plugin
 * creates it, reads tickets through the Backlog CLI's JSON output, appends
 * answer records, and is the only committer.
 */
import { access, constants, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TrackerSyncProblem } from "../shared/contracts";
import { TICKET_STATUSES } from "../shared/project";
import { gainedGuidelines, identityChanges, INSTRUCTION_FILES, TRACKER_CONFIG, withCommittedIdentity } from "../shared/tracker-guard";
import { backlogEnvironment, findExecutable, searchDirectories, taroBacklogDirectory } from "./backlog-install";
import { commandError, runChecked, runCommand, type CommandResult } from "./process";

export const TRACKER_BRANCH = "taro/backlog";

let backlogLookup: Promise<string | null> | null = null;

/** A `backlog` the user installed comes first; Taro's own copy (TR-063) only when there is none. */
export async function findBacklog(directories: readonly string[] = searchDirectories()): Promise<string | null> {
  return (await findExecutable("backlog", directories)) ?? (await findExecutable("backlog", [taroBacklogDirectory()]));
}

/** Looked up once while found; a miss is looked up again, so an install shows without a reload. */
export function backlogBinary(find: () => Promise<string | null> = () => findBacklog()): Promise<string | null> {
  backlogLookup ??= find().then((found) => {
    if (found === null) backlogLookup = null;
    return found;
  });
  return backlogLookup;
}

/** After Taro installs its copy: the next lookup searches again. */
export function forgetBacklogLookup(): void {
  backlogLookup = null;
}

async function requireBacklog(): Promise<string> {
  const binary = await backlogBinary();
  if (binary === null) throw new Error("The Backlog.md CLI (`backlog`) is not installed on the daemon host.");
  return binary;
}

export async function runBacklog(trackerPath: string, args: readonly string[]): Promise<string> {
  const binary = await requireBacklog();
  return runChecked(binary, args, { cwd: trackerPath, env: { ...backlogEnvironment(binary), BACKLOG_CWD: trackerPath }, timeoutMs: 60_000 });
}

function git(directory: string, args: readonly string[]): Promise<string> {
  return runChecked("git", ["-C", directory, ...args], { timeoutMs: 120_000 });
}

async function gitSucceeds(directory: string, args: readonly string[]): Promise<boolean> {
  return (await runCommand("git", ["-C", directory, ...args], { timeoutMs: 60_000 })).code === 0;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The repository's absolute git common directory, used to tell two checkouts of one repository apart from two repositories. */
export async function gitCommonDirectory(directory: string): Promise<string> {
  return (await git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
}

export async function hasOriginRemote(repoPath: string): Promise<boolean> {
  return (await git(repoPath, ["remote"])).split("\n").map((line) => line.trim()).includes("origin");
}

export interface TrackerSetup {
  repoPath: string;
  trackerPath: string;
  project: string;
  ticketPrefix: string;
  baseBranch: string;
}

/**
 * Creates the tracker worktree (reusing a local or remote `taro/backlog`) and
 * initialises Backlog.md in it when it has no project yet. An existing tracker
 * is adopted as it is, with Taro's statuses ensured.
 */
export async function ensureTracker(setup: TrackerSetup): Promise<{ adopted: boolean }> {
  const { repoPath, trackerPath } = setup;
  if (!(await gitSucceeds(repoPath, ["rev-parse", "--is-inside-work-tree"]))) {
    throw new Error(`${repoPath} is not a git repository.`);
  }
  if (!(await exists(trackerPath))) {
    const origin = await hasOriginRemote(repoPath);
    let start = `refs/heads/${setup.baseBranch}`;
    if (origin) {
      await git(repoPath, ["fetch", "origin", setup.baseBranch]).catch(() => "");
      start = `refs/remotes/origin/${setup.baseBranch}`;
      const remote = (await git(repoPath, ["ls-remote", "--heads", "origin", `refs/heads/${TRACKER_BRANCH}`]).catch(() => "")).trim();
      if (remote !== "") await git(repoPath, ["fetch", "origin", `refs/heads/${TRACKER_BRANCH}:refs/remotes/origin/${TRACKER_BRANCH}`]);
    }
    const references = (await git(repoPath, ["for-each-ref", "--format=%(refname)"])).split("\n");
    if (references.includes(`refs/heads/${TRACKER_BRANCH}`)) {
      await git(repoPath, ["worktree", "add", trackerPath, TRACKER_BRANCH]);
    } else {
      if (references.includes(`refs/remotes/origin/${TRACKER_BRANCH}`)) start = `refs/remotes/origin/${TRACKER_BRANCH}`;
      else if (!references.includes(start)) start = "HEAD";
      await git(repoPath, ["worktree", "add", "-b", TRACKER_BRANCH, trackerPath, start]);
    }
  }
  const branch = (await git(trackerPath, ["symbolic-ref", "--short", "HEAD"])).trim();
  if (branch !== TRACKER_BRANCH) throw new Error(`${trackerPath} is on ${branch}, not ${TRACKER_BRANCH}.`);
  if ((await gitCommonDirectory(trackerPath)) !== (await gitCommonDirectory(repoPath))) {
    throw new Error(`${trackerPath} belongs to another repository.`);
  }

  const configPath = join(trackerPath, "backlog", "config.yml");
  const adopted = await exists(configPath);
  if (!adopted) {
    await runBacklog(trackerPath, [
      "init",
      setup.project,
      "--defaults",
      "--integration-mode",
      "none",
      "--task-prefix",
      setup.ticketPrefix,
      "--zero-padded-ids",
      "3",
      "--check-branches",
      "false",
      "--include-remote",
      "false",
      "--auto-open-browser",
      "false",
    ]);
    await runBacklog(trackerPath, ["config", "set", "defaultStatus", "Backlog"]);
    await runBacklog(trackerPath, ["config", "set", "autoCommit", "false"]);
  }
  await ensureStatuses(configPath);
  return { adopted };
}

/** Rewrites the inline `statuses:` list to Taro's, keeping any extra columns before Done. */
export async function ensureStatuses(configPath: string): Promise<void> {
  const text = await readFile(configPath, "utf8");
  const next = withTaroStatuses(text);
  if (next !== text) await writeFile(configPath, next, "utf8");
}

export function withTaroStatuses(configText: string): string {
  const match = /^statuses:\s*(\[.*\])\s*$/m.exec(configText);
  if (match === null || match[1] === undefined) throw new Error("The Backlog config has no inline statuses list.");
  let current: unknown;
  try {
    current = JSON.parse(match[1]);
  } catch {
    throw new Error("The Backlog config's statuses list is not a JSON-style list.");
  }
  const existing = Array.isArray(current) ? current.filter((status): status is string => typeof status === "string") : [];
  const extras = existing.filter((status) => !(TICKET_STATUSES as readonly string[]).includes(status));
  const statuses = [...TICKET_STATUSES.slice(0, -1), ...extras, "Done"];
  if (JSON.stringify(existing) === JSON.stringify(statuses)) return configText;
  return configText.replace(match[0], `statuses: ${JSON.stringify(statuses)}`);
}

export interface TrackerCommit {
  /** The commit message, or null when nothing changed. */
  subject: string | null;
  /** What the guard restored instead of committing (TR-051); empty when nothing. */
  restored: string[];
}

/**
 * Commits everything changed under `backlog/`, after restoring what a stray
 * `backlog init` against the tracker changed (see protectTracker).
 */
export async function commitTracker(trackerPath: string): Promise<TrackerCommit> {
  const restored = await protectTracker(trackerPath);
  await git(trackerPath, ["add", "-A", "backlog"]);
  const staged = (await git(trackerPath, ["diff", "--cached", "--name-only"])).split("\n").filter((line) => line.trim() !== "");
  if (staged.length === 0) return { subject: null, restored };
  const ticketIds = [...new Set(staged.map(ticketIdInPath).filter((id): id is string => id !== null))].sort();
  const subject = ticketIds.length === 0 ? "taro: update tracker" : `taro: update ${ticketIds.slice(0, 8).join(", ")}${ticketIds.length > 8 ? ", …" : ""}`;
  await git(trackerPath, ["-c", "user.name=Taro", "-c", "user.email=taro@localhost", "commit", "--no-verify", "-q", "-m", subject]);
  return { subject, restored };
}

/** A file's committed text at HEAD, or null when HEAD lacks it. */
async function committedText(trackerPath: string, file: string): Promise<string | null> {
  const result = await runCommand("git", ["-C", trackerPath, "show", `HEAD:${file}`], { timeoutMs: 30_000 });
  return result.code === 0 ? result.stdout : null;
}

async function workingText(trackerPath: string, file: string): Promise<string | null> {
  try {
    return await readFile(join(trackerPath, file), "utf8");
  } catch {
    return null;
  }
}

/**
 * Undoes what `backlog init` does to an existing tracker (TR-051): a changed
 * project name, ticket prefix or id padding in `backlog/config.yml` gets its
 * committed line back (other config edits stay), a deleted config comes back
 * whole; Backlog's guidelines written into an instruction file
 * at the tracker's root restore the committed file, or remove it when it was
 * not committed. A tracker without a committed config (onboarding) is left
 * alone. Returns what it restored.
 */
export async function protectTracker(trackerPath: string): Promise<string[]> {
  const restored: string[] = [];
  const committedConfig = await committedText(trackerPath, TRACKER_CONFIG);
  if (committedConfig === null) return restored;
  const workingConfig = await workingText(trackerPath, TRACKER_CONFIG);
  if (workingConfig === null) {
    await git(trackerPath, ["checkout", "HEAD", "--", TRACKER_CONFIG]);
    restored.push(`${TRACKER_CONFIG} (deleted)`);
  } else {
    const changes = identityChanges(committedConfig, workingConfig);
    if (changes.length > 0) {
      await writeFile(join(trackerPath, TRACKER_CONFIG), withCommittedIdentity(committedConfig, workingConfig), "utf8");
      restored.push(`${TRACKER_CONFIG} (${changes.join(", ")})`);
    }
  }
  for (const file of INSTRUCTION_FILES) {
    const working = await workingText(trackerPath, file);
    if (working === null) continue;
    const committed = await committedText(trackerPath, file);
    if (!gainedGuidelines(committed, working)) continue;
    if (committed === null) {
      await rm(join(trackerPath, file), { force: true });
      restored.push(`${file} (removed: Backlog wrote it)`);
    } else {
      await git(trackerPath, ["checkout", "HEAD", "--", file]);
      restored.push(`${file} (Backlog's guidelines taken out)`);
    }
  }
  if (restored.length > 0) console.warn(`[taro] refused to commit ${trackerPath}: restored ${restored.join("; ")}`);
  return restored;
}

/** `backlog/tasks/sh-012 - Title.md` → `SH-012`. */
export function ticketIdInPath(path: string): string | null {
  const match = /(?:^|\/)([a-z]+-\d+(?:\.\d+)*) - /i.exec(path);
  return match?.[1] === undefined ? null : match[1].toUpperCase();
}

/**
 * How a pull settles lines changed on both sides: plain rebase stops on them;
 * the others let one side win in those lines only (in a rebase, "theirs" is
 * the local commits being replayed).
 */
export type SyncStrategy = "rebase" | "keep-local" | "keep-remote";

const STRATEGY_OPTIONS: Readonly<Record<SyncStrategy, readonly string[]>> = {
  rebase: [],
  "keep-local": ["-X", "theirs"],
  "keep-remote": ["-X", "ours"],
};

/**
 * Commits pending ticket writes, pulls (rebase) and pushes `taro/backlog`;
 * returns null when in sync, or the problem instead of throwing. Never
 * autostashes: popping a stash over a conflicting remote edit leaves conflict
 * markers in the tree, which the next commit would publish. A write landing
 * between the commit and the pull makes git refuse, so commit and try again.
 * A conflicting rebase is aborted, so the tracker stays on its branch with
 * nothing lost. What the guard restores on the way is handed to `onRestored`.
 */
export async function syncTracker(
  trackerPath: string,
  strategy: SyncStrategy = "rebase",
  onRestored: (restored: readonly string[]) => void = () => undefined,
): Promise<TrackerSyncProblem | null> {
  let pull: CommandResult | null = null;
  for (let attempt = 0; attempt < 3 && (pull === null || refusedForLocalChanges(pull)); attempt += 1) {
    const { restored } = await commitTracker(trackerPath);
    if (restored.length > 0) onRestored(restored);
    pull = await runCommand("git", ["-C", trackerPath, "pull", "--rebase", ...STRATEGY_OPTIONS[strategy], "origin", TRACKER_BRANCH], { timeoutMs: 120_000 });
  }
  if (pull === null || refusedForLocalChanges(pull)) {
    return { kind: "failed", message: "Tickets kept changing while syncing; it runs again after the next change.", tickets: [] };
  }
  if (pull.code !== 0 && !/couldn't find remote ref/i.test(pull.stderr)) {
    const unmerged = await runCommand("git", ["-C", trackerPath, "diff", "--name-only", "--diff-filter=U"], { timeoutMs: 30_000 });
    const files = unmerged.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    await runCommand("git", ["-C", trackerPath, "rebase", "--abort"], { timeoutMs: 30_000 });
    if (files.length > 0) return conflictProblem(files);
    return { kind: "failed", message: `Pulling from origin failed: ${gitComplaint(pull)}`, tickets: [] };
  }
  const push = await runCommand("git", ["-C", trackerPath, "push", "-u", "origin", TRACKER_BRANCH], { timeoutMs: 120_000 });
  if (push.code !== 0) return { kind: "failed", message: `Pushing to origin failed: ${gitComplaint(push)}`, tickets: [] };
  return null;
}

/** `git pull --rebase` refusing to start because the tree has uncommitted changes. */
function refusedForLocalChanges(result: CommandResult): boolean {
  return result.code !== 0 && /cannot pull with rebase|uncommitted changes|unstaged changes/i.test(result.stderr);
}

export function conflictProblem(files: readonly string[]): TrackerSyncProblem {
  const tickets = [...new Set(files.map(ticketIdInPath).filter((id): id is string => id !== null))].sort();
  const others = files.filter((file) => ticketIdInPath(file) === null);
  const named = [...tickets, ...others];
  const subject = named.length <= 3 ? named.join(", ") : `${named.slice(0, 3).join(", ")} and ${named.length - 3} more`;
  return { kind: "conflict", message: `${subject} changed both here and on the remote.`, tickets };
}

/** Git's own reason (its fatal/error line), not the progress chatter that comes first on stderr. */
export function gitComplaint(result: CommandResult): string {
  const lines = `${result.stderr}\n${result.stdout}`.split("\n").map((line) => line.trim());
  return lines.find((line) => /^(fatal|error):/i.test(line)) ?? commandError(result);
}
