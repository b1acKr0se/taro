/**
 * Answers a bypass-mode Taro agent's shell permission ask by the fixed rules of
 * `shared/permission-triage.ts` (TR-143), so a safe cleanup does not wait overnight and a wrong one
 * is refused with a reason the agent can act on. Whatever the rules leave stays a pending
 * permission, shown in Needs you as before (TR-096). Every decision is recorded on the agent's
 * ticket; a denial also counts in its stats.
 */
import { homedir } from "node:os";

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

/** What the rules did with the ask: answered it, or left it to the user (`null`). */
export async function triageAsk(paseo: PaseoApi, stats: Stats, asker: PermissionAsker, request: PermissionRequest): Promise<"allow" | "deny" | null> {
  // Cheap first: most asks are not shell commands and need no lookup.
  if (request.kind !== "tool" || request.name !== "Bash") return null;
  const triage = triagePermission(request, { cwd: asker.cwd, home: homedir() });
  if (triage.verdict === "ask") return null;
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
  try {
    await paseo.agents.ref(asker.id).respondToPermission({ requestId: request.id, response });
  } catch (error) {
    // The user answered first, or the turn ended: nothing was decided here.
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
