/**
 * The reload after every compaction (TR-101): when a Claude manager or owner session opens (create
 * and resume), its reload text goes to a file in the plugin's data folder and a SessionStart hook
 * (matcher "compact") that prints it goes into `.claude/settings.local.json` in its working
 * directory: Paseo lets a plugin change only a session's env, and Claude reads hooks only from
 * settings files. A new owner gets it at its first turn start (`ensureCompactHook`). The merge and
 * the file's place outside git are `local-settings.ts`'s.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { reloadHookCommand, withTaroHook } from "../shared/claude-settings";
import { fetchLiveAgent } from "./agents";
import { dataPath } from "./data-dir";
import { isInside } from "./environment";
import { writeTextAtomically } from "./files";
import type { PaseoApi } from "./host-types";
import { mergeLocalSettings } from "./local-settings";
import { skillDirectory } from "./package-files";
import { projectsDirectory } from "./projects";
import { identityFromLabels, reloadText, type TaroIdentity } from "./supervision";

const RELOAD_FOLDER = "reload";

export function reloadFilePath(agentId: string): string {
  return dataPath(join(RELOAD_FOLDER, `${agentId}.md`));
}

/**
 * Agents whose labels were read in this plugin run: whether each is a manager or owner was settled
 * then. A new agent's session opens before Paseo stores it, so its labels cannot be read yet; its
 * first turn start installs the hook instead (Claude reads a settings file changed mid-session).
 */
const settled = new Set<string>();

/** A manager or an owner; a manager's home under the projects folder identifies it when labels do not. */
async function sessionIdentity(paseo: PaseoApi, agentId: string, cwd: string): Promise<TaroIdentity | null> {
  const agent = await fetchLiveAgent(paseo, agentId);
  if (agent !== null) settled.add(agentId);
  const identity = agent === null ? null : identityFromLabels(agent.labels, agent.title ?? null);
  if (identity !== null) return identity.role === "manager" || identity.role === "owner" ? identity : null;
  const root = await projectsDirectory();
  if (!isInside(root, cwd)) return null;
  const project = cwd.slice(root.length).split(/[\\/]/).find((part) => part !== "");
  return project === undefined ? null : { project, role: "manager", ticket: null, title: null };
}

/** Returns what it changed in the working directory, for the log, or null when nothing there changed. */
export async function installCompactHook(paseo: PaseoApi, request: { agentId: string; cwd: string; provider: string }): Promise<string | null> {
  if (request.provider !== "claude") return null;
  const identity = await sessionIdentity(paseo, request.agentId, request.cwd);
  if (identity === null) return null;
  const reloadFile = reloadFilePath(request.agentId);
  await writeTextAtomically(reloadFile, `${await reloadText(identity)}\n`);
  const command = reloadHookCommand(dataPath(RELOAD_FOLDER), await skillDirectory());
  return mergeLocalSettings(request.cwd, "hook", (current) => withTaroHook(current, command));
}

/** At a turn start: installs once for an agent whose labels its session open could not read. */
export async function ensureCompactHook(paseo: PaseoApi, agent: { id: string; cwd: string; provider: string }): Promise<string | null> {
  if (settled.has(agent.id) || agent.provider !== "claude") return null;
  return installCompactHook(paseo, { agentId: agent.id, cwd: agent.cwd, provider: agent.provider });
}

/** An archived agent's hook goes quiet: it prints nothing once its reload file is gone. */
export async function removeReloadFile(agentId: string): Promise<void> {
  settled.delete(agentId);
  await rm(reloadFilePath(agentId), { force: true });
}
