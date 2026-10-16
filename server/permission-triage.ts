/**
 * Answers a bypass-mode Taro agent's shell permission ask by the fixed rules of
 * `shared/permission-triage.ts` (TR-143), so a safe cleanup does not wait overnight and a wrong one
 * is refused with a reason the agent can act on. Whatever the rules leave stays a pending
 * permission, shown in Needs you as before (TR-096). Every decision is recorded on the agent's
 * ticket; a denial also counts in its stats.
 */
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, relative } from "node:path";

import { isBypassMode, permissionRecord, ruleReasons, triagePermission, type ShellAsk } from "../shared/permission-triage";
import { fetchLiveAgent } from "./agents";
import type { PaseoApi } from "./host-types";
import { TEMPLATES, message, readTemplate, skillDirectory, withoutNotes } from "./package-files";
import { projectPaths } from "./projects";
import type { Stats } from "./stats";
import { identityFromLabels } from "./supervision";
import { appendTicketNote } from "./tickets";

export interface PermissionAsker {
  id: string;
  cwd: string;
}

export interface PermissionRequest extends ShellAsk {
  id: string;
}

/**
 * Whether the plugin records this agent's asks (TR-149): Taro's agents only. Its stored supervision
 * record is read first, without a call; an agent before its first turn end has none yet, so its
 * labels are read then.
 */
export async function isTaroAsker(paseo: PaseoApi, known: (agentId: string) => Promise<unknown>, agentId: string): Promise<boolean> {
  if ((await known(agentId)) !== null) return true;
  const agent = await fetchLiveAgent(paseo, agentId);
  return agent !== null && identityFromLabels(agent.labels, agent.title ?? null) !== null;
}

/** Marks the recorded ask as answered by the rules, and takes the mark back (TR-149). */
export interface RulesMark {
  mark(requestId: string, rule: string): Promise<unknown>;
  clear(requestId: string): Promise<unknown>;
}

/** What the rules did with the ask: answered it, or left it to the user (`null`). */
export async function triageAsk(paseo: PaseoApi, stats: Stats, asker: PermissionAsker, request: PermissionRequest, rulesMark: RulesMark | null = null): Promise<"allow" | "deny" | null> {
  // Cheap first: most asks are not shell commands and need no lookup.
  if (request.kind !== "tool" || request.name !== "Bash") return null;
  const triage = triagePermission(request, { cwd: asker.cwd, home: homedir() });
  if (triage.verdict === "ask") return null;
  if (triage.verdict === "allow" && !(await allInsideOnDisk(triage.paths, asker.cwd))) return null;
  const agent = await fetchLiveAgent(paseo, asker.id);
  if (agent === null) return null;
  const identity = identityFromLabels(agent.labels, agent.title ?? null);
  if (identity === null || !isBypassMode(agent.currentModeId)) return null;

  const response =
    triage.verdict === "allow"
      ? ({ behavior: "allow" } as const)
      : ({
          behavior: "deny",
          interrupt: false,
          message: await message(TEMPLATES.permissionDenied, {
            path: triage.path,
            rule: triage.rule,
            why: ruleReasons(withoutNotes(await readTemplate(TEMPLATES.permissionRules)))[triage.rule] ?? "",
            skill: await skillDirectory(),
          }),
        } as const);
  // Before responding: Paseo reports the answer as soon as it is given, and it must read as the rules'.
  // A mark that fails to save leaves the record wrong, which is no reason to keep the agent waiting.
  await rulesMark?.mark(request.id, triage.rule).catch((error: unknown) => console.warn(`[taro] could not mark permission ${request.id} as the rules': ${String(error)}`));
  try {
    await paseo.agents.ref(asker.id).respondToPermission({ requestId: request.id, response });
  } catch (error) {
    // The user answered first, or the turn ended: nothing was decided here.
    await rulesMark?.clear(request.id).catch(() => undefined);
    console.log(`[taro] ${asker.id}: could not answer permission ${request.id}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const command = typeof request.input?.command === "string" ? request.input.command : "";
  const record = permissionRecord(new Date().toISOString(), identity.role, asker.id, command, triage);
  console.log(`[taro] ${record}`);
  if (identity.ticket !== null) {
    const ticket = identity.ticket;
    const paths = await projectPaths(identity.project);
    await appendTicketNote(paths.tracker, ticket, record).catch((error: unknown) => {
      console.warn(`[taro] could not record a permission decision on ${ticket}: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (triage.verdict === "deny") await stats.count(identity.project, ticket, "permissionDenials").catch(() => undefined);
  }
  return triage.verdict;
}

/**
 * Whether each path's folder really lies inside /tmp or the working directory: the rules read paths
 * as text, and a symbolic link on the way (`/tmp/x` → `/`) would take a removal elsewhere. The
 * removed path itself may be a link, which `rm` removes rather than follows.
 */
export async function allInsideOnDisk(paths: readonly string[], cwd: string): Promise<boolean> {
  const roots = await Promise.all(["/tmp", cwd].map((root) => realpath(root).catch(() => null)));
  for (const path of paths) {
    const folder = await realFolder(dirname(path));
    if (folder === null) return false;
    const inside = roots.some((root) => root !== null && (folder === root || isWithin(root, folder)));
    if (!inside) return false;
  }
  return true;
}

/** The real path of the folder, or of its nearest existing ancestor with the missing rest appended. */
async function realFolder(folder: string): Promise<string | null> {
  let existing = folder;
  let rest = "";
  for (;;) {
    try {
      const real = await realpath(existing);
      return rest === "" ? real : `${real === "/" ? "" : real}/${rest}`;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return null;
      rest = rest === "" ? existing.slice(parent.length).replace(/^\//, "") : `${existing.slice(parent.length).replace(/^\//, "")}/${rest}`;
      existing = parent;
    }
  }
}

function isWithin(root: string, path: string): boolean {
  const way = relative(root, path);
  return way !== "" && !way.startsWith("..") && !way.startsWith("/");
}
