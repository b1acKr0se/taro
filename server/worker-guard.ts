/**
 * The check behind the `taro` command's user-only actions: an agent that works on the ticket (its
 * owner or one of the owner's subagents) is refused; the buttons send no `caller` and are never held.
 */
import { isTicketWorker, workerRefusal } from "../shared/worker-guard";
import { PARENT_AGENT_LABEL } from "../shared/unlabelled-agents";
import type { PaseoApi } from "./host-types";
import { identityFromLabels } from "./supervision";

/** How far up an unlabelled agent's parents to look: a subagent's subagent is two. */
const PARENT_DEPTH = 3;

/**
 * Whether the agent, or an agent above it (an owner's child started without Taro labels has the
 * owner as its parent), works on the ticket. A lookup that fails refuses: an owner must not get
 * through on a hiccup. An agent Paseo does not know or has archived is nobody's worker.
 */
async function worksOn(paseo: PaseoApi, agentId: string, project: string, ticket: string | null, depth: number): Promise<boolean> {
  const refreshed = await paseo.agents.ref(agentId).refresh();
  if (refreshed === null || (refreshed.agent.archivedAt !== null && refreshed.agent.archivedAt !== undefined)) return false;
  const labels = refreshed.agent.labels;
  const identity = identityFromLabels(labels, refreshed.agent.title ?? null);
  if (isTicketWorker(identity, project, ticket)) return true;
  const parent = labels[PARENT_AGENT_LABEL];
  if (identity !== null || parent === undefined || parent === "" || depth >= PARENT_DEPTH) return false;
  return worksOn(paseo, parent, project, ticket, depth + 1);
}

export async function refuseTicketWorker(paseo: PaseoApi, caller: string | undefined, project: string, ticket: string | null, action: string): Promise<void> {
  if (caller === undefined || caller === "") return;
  let worker: boolean;
  try {
    worker = await worksOn(paseo, caller, project, ticket, 1);
  } catch {
    throw new Error(`${action}: could not check who is asking; try again.`);
  }
  if (worker) throw new Error(workerRefusal(action));
}

/** A decision: the agent that asked it and the ticket's workers are refused. */
export async function refuseDecisionWorker(
  paseo: PaseoApi,
  caller: string | undefined,
  decision: { agentId: string; project: string; ticket: string | null } | null,
  action: string,
): Promise<void> {
  if (caller === undefined || caller === "" || decision === null) return;
  if (caller === decision.agentId) throw new Error(workerRefusal(action));
  await refuseTicketWorker(paseo, caller, decision.project, decision.ticket, action);
}
