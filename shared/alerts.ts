/**
 * What a board alert is called, on its card and in its notification (TR-064). Pure.
 */
import { QUEUED_ALERT_ID } from "./queue-check";
import type { BoardAlert } from "./recovery";
import type { TicketProblem } from "./ticket-format";

/** A tracker still in Backlog.md format shows no tickets until `taro convert` runs (TR-081). */
export const BACKLOG_FORMAT_ALERT_ID = "tracker-backlog-format";

const HEADINGS: Readonly<Record<string, string>> = {
  headroom: "Threads running low",
  "manager-crashed": "Manager crashed",
  [QUEUED_ALERT_ID]: "Queued with a free slot",
  [BACKLOG_FORMAT_ALERT_ID]: "Tracker not converted",
};

export function backlogFormatAlert(trackerPath: string): BoardAlert {
  return {
    id: BACKLOG_FORMAT_ALERT_ID,
    tickets: [],
    text: `This project's tracker is still in Backlog.md format, so the board shows no tickets and none can be created. Run taro convert --dry-run, then taro convert, in ${trackerPath}.`,
  };
}

/** One alert per ticket file that cannot be read (TR-081): this prefix, then the file. */
export const TICKET_FILE_ALERT_PREFIX = "ticket-file:";

/** One alert per file, naming its first problem by line; the file's card is left off the board until it is fixed. */
export function ticketFileAlerts(problems: readonly TicketProblem[]): BoardAlert[] {
  const byFile = new Map<string, TicketProblem[]>();
  for (const problem of problems) byFile.set(problem.file, [...(byFile.get(problem.file) ?? []), problem]);
  return [...byFile].map(([file, [first, ...rest]]) => ({
    id: `${TICKET_FILE_ALERT_PREFIX}${file}`,
    tickets: [],
    text: `${file} line ${first?.line ?? 1}: ${first?.message ?? "cannot be read"}${rest.length === 0 ? "" : ` (and ${rest.length} more ${rest.length === 1 ? "problem" : "problems"})`}. Its ticket is left off the board until the file is fixed; taro ticket check lists every problem.`,
  }));
}

export function alertHeading(alertId: string): string {
  if (alertId.startsWith(TICKET_FILE_ALERT_PREFIX)) return "Ticket file unreadable";
  return HEADINGS[alertId] ?? "Needs you";
}

/** The alerts the user may dismiss: those that only report (a queue the Manager left). */
export function dismissible(alertId: string): boolean {
  return alertId === QUEUED_ALERT_ID;
}
