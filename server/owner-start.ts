/**
 * The plugin, not the owner, moves a ticket out of Queued (TR-173): at the first turn start it sees of
 * each owner, whoever started it (the manager's dispatch, Resume, an Accept takeover).
 */
import { ownerStartedRecord } from "../shared/owner-start";
import { fetchLiveAgent } from "./agents";
import type { PaseoApi } from "./host-types";
import { projectPaths } from "./projects";
import { identityFromLabels } from "./supervision";
import { TicketNotFound } from "./ticket-store";
import { startPlanning } from "./tickets";

/** Agents already looked at since the plugin loaded: a ticket moves once, at its owner's first turn. */
const looked = new Set<string>();

/** Sets the owner's Queued ticket Planning; the ticket id when it moved, null otherwise. */
export async function markOwnerStarted(paseo: PaseoApi, agentId: string, now: () => Date = () => new Date()): Promise<string | null> {
  if (looked.has(agentId)) return null;
  const live = await fetchLiveAgent(paseo, agentId);
  // Unreadable now: the next turn start looks again.
  if (live === null) return null;
  looked.add(agentId);
  const identity = identityFromLabels(live.labels, live.title ?? null);
  if (identity === null || identity.role !== "owner" || identity.ticket === null) return null;
  try {
    const tracker = (await projectPaths(identity.project)).tracker;
    return (await startPlanning(tracker, identity.ticket, ownerStartedRecord(now().toISOString(), agentId))) ? identity.ticket : null;
  } catch (error) {
    // A ticket the tracker does not hold will not appear; anything else may pass by the next turn.
    if (error instanceof TicketNotFound) return null;
    looked.delete(agentId);
    throw error;
  }
}

/** An archived agent is forgotten. */
export function forgetOwnerStart(agentId: string): void {
  looked.delete(agentId);
}
