/**
 * A ticket becomes Planning as soon as its owner starts (TR-173): the board places a card in Working
 * once its owner runs, and a Queued badge there read as not started for the minutes the owner took to
 * read its rules. Only a Queued ticket with no parent moves: one an owner takes over past Planning (a
 * Resume, an Accept takeover) keeps its status, and a child has no owner of its own. Pure.
 */

export function startsPlanning(ticket: { status: string; parent: string | null }): boolean {
  return ticket.status === "Queued" && ticket.parent === null;
}

export function ownerStartedRecord(at: string, agentId: string): string {
  return `OWNER-STARTED ${at} — the plugin set Planning: owner ${agentId} started on this Queued ticket`;
}
