/**
 * Sketch: how a card's board column is derived (decisions 9, 28, 30, 40; spec §5).
 * Not wired up or tested.
 *
 * Inputs come from three places: the ticket's Backlog.md status, the live Paseo agent, and
 * the plugin's own state (the owner's last status line and its open decisions). Live state
 * wins for urgent facts; otherwise the recorded status decides. "Stalled" is the case only
 * the join can see: the ticket says work is under way but nobody is on it.
 */

export type ColumnId = "needs-you" | "working" | "stalled" | "queued" | "done";

export type TicketStatus =
  | "Backlog"
  | "Planning"
  | "Ready"
  | "In Progress"
  | "Reviewing"
  | "Awaiting acceptance"
  | "Blocked"
  | "Cancelled"
  | "Done";

export type StatusLineState = "working" | "waiting" | "blocked" | "done" | "failed";

export interface CardInputs {
  status: TicketStatus;
  /** The owner runs on another machine (EXECUTION record names another daemon). */
  ownerElsewhere: boolean;
  /** The live owner on this daemon, or null when there is none. */
  agent: { status: "initializing" | "idle" | "running" | "error" | "closed"; pendingPermissions: number } | null;
  /** From the owner's last turn, kept by the plugin. */
  lastStatusLine: StatusLineState | null;
  openBlockingDecisions: number;
  /** Two consecutive stalls after the plugin's nudge. */
  stalledAfterNudge: boolean;
}

export function boardColumn(card: CardInputs): ColumnId {
  if (card.status === "Done" || card.status === "Cancelled") return "done";
  if (card.ownerElsewhere) return recordedColumn(card.status);

  const agent = card.agent;
  if (agent !== null && agent.pendingPermissions > 0) return "needs-you";
  if (agent !== null && (agent.status === "running" || agent.status === "initializing")) return "working";

  if (card.openBlockingDecisions > 0) return "needs-you";
  if (card.status === "Awaiting acceptance" || card.status === "Blocked") return "needs-you";
  if (card.lastStatusLine === "blocked") return "needs-you";

  const underWay = card.status === "Planning" || card.status === "In Progress" || card.status === "Reviewing";
  if (underWay) {
    if (agent === null || agent.status === "error" || agent.status === "closed") return "stalled";
    if (card.lastStatusLine === "failed" || card.stalledAfterNudge) return "stalled";
    // Idle while waiting on something outside itself, or between the nudge and its answer.
    return "working";
  }

  // Backlog / Ready: not started, or waiting on another ticket.
  return "queued";
}

/** A teammate's owner is invisible to this daemon: never call it stalled. */
function recordedColumn(status: TicketStatus): ColumnId {
  if (status === "Awaiting acceptance" || status === "Blocked") return "needs-you";
  if (status === "Planning" || status === "In Progress" || status === "Reviewing") return "working";
  return "queued";
}
