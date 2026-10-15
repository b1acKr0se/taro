/** When Compact is offered for a ticket's owner: in the ticket view's summary, beside Pause (TR-095). */

/** Over this much context an idle owner offers Compact. */
export const COMPACT_OFFER_TOKENS = 150_000;

/** A child's owner is its parent's, so Compact stays on the parent. */
export function offersCompact(ticket: { parent: string | null; owner: { status: string; contextUsedTokens: number | null } | null }): boolean {
  const owner = ticket.owner;
  return ticket.parent === null && owner !== null && owner.status === "idle" && (owner.contextUsedTokens ?? 0) > COMPACT_OFFER_TOKENS;
}
