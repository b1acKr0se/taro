/**
 * An owner that ends its turn waiting for the user's acceptance while its ticket is not in Awaiting
 * acceptance (TR-252): no Accept card shows and nothing reaches Needs you. Pure.
 */

/** Statuses where the ticket cannot be waiting for acceptance any more or yet by design. */
const NOT_WORKED_ON: ReadonlySet<string> = new Set(["Done", "Cancelled", "Awaiting acceptance"]);

/** A status line that waits for the user to accept or merge: `waiting: user's accept`. */
export function waitsForAcceptance(status: { state: string; text: string } | null): boolean {
  return status !== null && status.state === "waiting" && /\baccept(?:ance|ed|s)?\b|\bmerge\b/i.test(status.text);
}

/** Whether the ending is an owner claiming acceptance while its ticket is still being worked on. */
export function waitsPrematurely(status: { state: string; text: string } | null, ticketStatus: string): boolean {
  return waitsForAcceptance(status) && !NOT_WORKED_ON.has(ticketStatus);
}

/**
 * Whether the plugin tells the owner on its `count`th premature ending in a row: the first, then the
 * second, fourth, eighth… so an owner that ignores the reminder is not told every turn.
 */
export function remindsAtCount(count: number): boolean {
  return count >= 1 && (count & (count - 1)) === 0;
}
