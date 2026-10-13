/**
 * Sketch: how a card's board column is derived from the recorded ticket and the
 * live Paseo agent (decision 9). Not wired up or tested.
 *
 * Live agent state wins for urgent facts (a permission request, an error, a
 * running turn); otherwise the recorded Backlog.md status decides. "Stalled" is
 * the case only the join can see: the ticket says work is under way, but the
 * agent stopped without recording why it waits.
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

export interface RecordedTicket {
  id: string;
  status: TicketStatus;
  /** Set when the owner recorded that it waits on the user (a question, plan approval, a blocker). */
  waitingOnUser: boolean;
  /** Set when the owner recorded an outside wait it expects to clear (CI, a long command). */
  waitingOnOutside: boolean;
  dependenciesOpen: boolean;
}

export interface LiveAgent {
  status: "initializing" | "idle" | "running" | "error" | "closed";
  pendingPermissions: number;
}

export function boardColumn(ticket: RecordedTicket, agent: LiveAgent | null): ColumnId {
  if (ticket.status === "Done" || ticket.status === "Cancelled") return "done";

  if (agent !== null) {
    if (agent.pendingPermissions > 0) return "needs-you";
    if (agent.status === "running" || agent.status === "initializing") return "working";
  }

  if (ticket.status === "Awaiting acceptance" || ticket.waitingOnUser) return "needs-you";
  if (ticket.status === "Blocked") return "needs-you";

  const underWay = ticket.status === "Planning" || ticket.status === "In Progress" || ticket.status === "Reviewing";
  if (underWay) {
    // The ticket says someone is on it. Without a live agent (gone, errored, or
    // idle) and without a recorded reason to wait, nobody is.
    if (agent === null || agent.status === "error" || agent.status === "closed") return "stalled";
    if (agent.status === "idle" && !ticket.waitingOnOutside) return "stalled";
    return "working";
  }

  // Backlog / Ready: not started, or waiting on another ticket.
  return "queued";
}

/**
 * Caveat for multi-machine use: an agent on another machine is invisible to the
 * local daemon (agent === null), so a teammate's In Progress ticket would read
 * as stalled. The real implementation must check the ticket's recorded
 * machine/daemon before calling it stalled and fall back to the recorded status.
 */
