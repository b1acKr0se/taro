/**
 * The reload after every compaction (TR-101): when a Claude manager or owner session opens (create
 * and resume), its reload text goes to a file in the plugin's data folder and a SessionStart hook
 * (matcher "compact") that prints it goes into `.claude/settings.local.json` in its working
 * directory: Paseo lets a plugin change only a session's env, and Claude reads hooks only from
 * settings files. The worktree stays clean: the file is excluded from git when nothing ignores it.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { reloadHookCommand, withTaroHook } from "../shared/claude-settings";
import { fetchLiveAgent } from "./agents";
import { dataPath } from "./data-dir";
import { isInside } from "./environment";
import { readTextIfPresent, writeTextAtomically } from "./files";
import type { PaseoApi } from "./host-types";
import { skillDirectory } from "./package-files";
import { runCommand } from "./process";
import { projectsDirectory } from "./projects";
import { identityFromLabels, reloadText, type TaroIdentity } from "./supervision";

const SETTINGS_FILE = join(".claude", "settings.local.json");
const EXCLUDE_PATTERN = "**/.claude/settings.local.json";
const GIT_TIMEOUT_MS = 10_000;

const RELOAD_FOLDER = "reload";

export function reloadFilePath(agentId: string): string {
  return dataPath(join(RELOAD_FOLDER, `${agentId}.md`));
}

/** A manager or an owner; a manager's home under the projects folder identifies it when labels do not. */
async function sessionIdentity(paseo: PaseoApi, agentId: string, cwd: string): Promise<TaroIdentity | null> {
  const agent = await fetchLiveAgent(paseo, agentId);
  const identity = agent === null ? null : identityFromLabels(agent.labels, agent.title ?? null);
  if (identity !== null) return identity.role === "manager" || identity.role === "owner" ? identity : null;
  const root = await projectsDirectory();
  if (!isInside(root, cwd)) return null;
  const project = cwd.slice(root.length).split(/[\\/]/).find((part) => part !== "");
  return project === undefined ? null : { project, role: "manager", ticket: null, title: null };
}

/** Adds the pattern to the repository's own `info/exclude` unless git already ignores the file; outside a repository, nothing. */
async function excludeFromGit(cwd: string): Promise<void> {
  const ignored = await runCommand("git", ["-C", cwd, "check-ignore", "-q", SETTINGS_FILE], { timeoutMs: GIT_TIMEOUT_MS });
  if (ignored.code !== 1) return; // 0: ignored already; 128: not a repository
  const located = await runCommand("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], { timeoutMs: GIT_TIMEOUT_MS });
  const exclude = located.stdout.trim();
  if (located.code !== 0 || exclude === "") return;
  const current = (await readTextIfPresent(exclude)) ?? "";
  if (current.split("\n").includes(EXCLUDE_PATTERN)) return;
  await writeTextAtomically(exclude, `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${EXCLUDE_PATTERN}\n`);
}

/** Returns what it changed in the working directory, for the log, or null when nothing there changed. */
export async function installCompactHook(paseo: PaseoApi, request: { agentId: string; cwd: string; provider: string }): Promise<string | null> {
  if (request.provider !== "claude") return null;
  const identity = await sessionIdentity(paseo, request.agentId, request.cwd);
  if (identity === null) return null;
  const reloadFile = reloadFilePath(request.agentId);
  await writeTextAtomically(reloadFile, `${await reloadText(identity)}\n`);
  const settingsPath = join(request.cwd, SETTINGS_FILE);
  const current = await readTextIfPresent(settingsPath);
  const merged = withTaroHook(current, reloadHookCommand(dataPath(RELOAD_FOLDER), await skillDirectory()));
  if (merged === null) return `left ${settingsPath} alone: it is not a settings object Taro can add to`;
  await excludeFromGit(request.cwd);
  if (merged === current) return null;
  await writeTextAtomically(settingsPath, merged);
  return `hook written to ${settingsPath}`;
}

/** An archived agent's hook goes quiet: it prints nothing once its reload file is gone. */
export async function removeReloadFile(agentId: string): Promise<void> {
  await rm(reloadFilePath(agentId), { force: true });
}
