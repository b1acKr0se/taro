/**
 * Change spec… (TR-129): a ticket waiting in Queued has no owner whose chat would take a change, so
 * its Chat and Ticket tabs send the user's words to the manager instead. A child is its parent
 * owner's to change, and a paused ticket the user's to resume, so neither offers it.
 */

export interface SpecChangeFacts {
  status: string;
  parent: string | null;
  /** A live owner (any status but closed), on this host or another. */
  ownerRunning: boolean;
  paused: boolean;
}

/** Why Change spec… cannot send for this ticket now, in the user's words; null when it can. */
export function specChangeRefusal(ticket: string, facts: SpecChangeFacts): string | null {
  if (facts.parent !== null) return `${ticket} is part of ${facts.parent}. Tell ${facts.parent}'s owner in its chat instead.`;
  if (facts.status !== "Queued") return `${ticket} is ${facts.status} now. Tell its owner in its chat instead.`;
  if (facts.ownerRunning) return `${ticket} has an owner now. Tell it in its chat instead.`;
  if (facts.paused) return `${ticket} is paused. Resume it, then tell its owner.`;
  return null;
}

export function offersSpecChange(facts: SpecChangeFacts): boolean {
  return specChangeRefusal("", facts) === null;
}
