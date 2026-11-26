/**
 * The check behind the `taro` command's user-only actions: an agent that works on the ticket (its
 * owner or one of the owner's subagents), or for a project-wide choice any of the project's agents, is refused; the buttons send no `caller` and are never held.
 */
import { isTicketWorker, workerRefusal } from "../shared/worker-guard";
import { PARENT_AGENT_LABEL } from "../shared/unlabelled-agents";
import type { PaseoApi } from "./host-types";
import { identityFromLabels, type TaroIdentity } from "./supervision";

/** How far up an unlabelled agent's parents to look: a subagent's subagent is two. */
const PARENT_DEPTH = 3;

/**
 * Whether the agent, or an agent above it (an owner's child started without Taro labels has the
 * owner as its parent), is one `matches` picks out by its Taro labels. The first labelled agent up
 * the chain decides. An agent Paseo does not know or has archived matches nothing.
 */
async function callerMatches(paseo: PaseoApi, agentId: string, matches: (identity: TaroIdentity) => boolean, depth: number): Promise<boolean> {
  const refreshed = await paseo.agents.ref(agentId).refresh();
  if (refreshed === null || (refreshed.agent.archivedAt !== null && refreshed.agent.archivedAt !== undefined)) return false;
  const labels = refreshed.agent.labels;
  const identity = identityFromLabels(labels, refreshed.agent.title ?? null);
  if (identity !== null) return matches(identity);
  const parent = labels[PARENT_AGENT_LABEL];
  if (parent === undefined || parent === "" || depth >= PARENT_DEPTH) return false;
  return callerMatches(paseo, parent, matches, depth + 1);
}

/** Refuses a caller `matches` picks out; a lookup that fails refuses too, so no worker gets through on a hiccup. */
async function refuseCaller(paseo: PaseoApi, caller: string | undefined, matches: (identity: TaroIdentity) => boolean, action: string, refusal: string): Promise<void> {
  if (caller === undefined || caller === "") return;
  let matched: boolean;
  try {
    matched = await callerMatches(paseo, caller, matches, 1);
  } catch {
    throw new Error(`${action}: could not check who is asking; try again.`);
  }
  if (matched) throw new Error(refusal);
}

export function refuseTicketWorker(paseo: PaseoApi, caller: string | undefined, project: string, ticket: string | null, action: string): Promise<void> {
  return refuseCaller(paseo, caller, (identity) => isTicketWorker(identity, project, ticket), action, workerRefusal(action));
}

/**
 * A project-wide choice (the start question): refused inside any of the project's own agents, its
 * manager too, which must ask the user; another project's agents and other sessions may act.
 */
export function refuseProjectAgent(paseo: PaseoApi, caller: string | undefined, project: string, action: string): Promise<void> {
  return refuseCaller(paseo, caller, (identity) => identity.project === project, action, `${action} is the user's: it refuses inside the project's own agents. Ask the user.`);
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
