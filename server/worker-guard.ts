/**
 * The check behind the `taro` command's user-only actions: an agent that works on the ticket (its
 * owner or one of the owner's subagents) is refused; the buttons send no `caller` and are never held.
 */
import { isTicketWorker, workerRefusal } from "../shared/worker-guard";
import { fetchLiveAgent } from "./agents";
import type { PaseoApi } from "./host-types";
import { identityFromLabels } from "./supervision";

export async function refuseTicketWorker(paseo: PaseoApi, caller: string | undefined, project: string, ticket: string | null, action: string): Promise<void> {
  if (caller === undefined || caller === "") return;
  const agent = await fetchLiveAgent(paseo, caller);
  const identity = agent === null ? null : identityFromLabels(agent.labels, agent.title ?? null);
  if (isTicketWorker(identity, project, ticket)) throw new Error(workerRefusal(action));
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
