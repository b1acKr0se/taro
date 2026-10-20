/**
 * Relaunch owner on a ticket's detail view (TR-219): a fresh owner from the latest HANDOFF, offered
 * in every status where the ticket is worked or waits for the user, so a closed or missing owner
 * (TR-207 sat Awaiting acceptance with none) never leaves the user without a way forward. Queued has
 * no owner or workspace yet, a paused ticket keeps Resume, a child is its parent owner's, and an
 * owner in a turn is nudged or interrupted instead.
 */

export interface RelaunchFacts {
  status: string;
  parent: string | null;
  paused: boolean;
  /** The owner is in a turn right now. */
  ownerRunning: boolean;
}

/** A status no owner works in any more, or has not started in yet. */
const NO_OWNER_STATUSES = new Set(["Queued", "Done", "Cancelled"]);

/** Why Relaunch owner is not offered for this ticket now, in the user's words; null when it is. */
export function relaunchRefusal(ticket: string, facts: RelaunchFacts): string | null {
  if (facts.parent !== null) return `${ticket} is part of ${facts.parent}; ${facts.parent}'s owner runs it.`;
  if (facts.status === "Done" || facts.status === "Cancelled") return `${ticket} is ${facts.status}.`;
  if (NO_OWNER_STATUSES.has(facts.status)) return `${ticket} has not started; its owner starts when a slot is free.`;
  if (facts.paused) return `${ticket} is paused. Resume it instead.`;
  if (facts.ownerRunning) return `${ticket}'s owner is running; nudge or interrupt it instead.`;
  return null;
}

export function offersRelaunch(facts: RelaunchFacts): boolean {
  return relaunchRefusal("", facts) === null;
}
