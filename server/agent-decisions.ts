import type { StoredDecision } from "../shared/state";

/** An agent's decisions of any status for its chat's finished cards (TR-149); one held back was never shown, so it is left out. */
export function decisionsOfAgent(decisions: readonly StoredDecision[], agentId: string): StoredDecision[] {
  return decisions.filter((decision) => decision.agentId === agentId && decision.held !== true);
}
