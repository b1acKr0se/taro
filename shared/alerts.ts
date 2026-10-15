/**
 * What a board alert is called, on its card and in its notification (TR-064). Pure.
 */
import { QUEUED_ALERT_ID } from "./queue-check";
import type { BoardAlert } from "./recovery";
import type { TicketProblem } from "./ticket-format";

const HEADINGS: Readonly<Record<string, string>> = {
  headroom: "Threads running low",
  "manager-crashed": "The manager crashed",
  [QUEUED_ALERT_ID]: "Queued with a free slot",
};

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

/** The alerts the user may dismiss: those that only report (a queue the manager left). */
export function dismissible(alertId: string): boolean {
  return alertId === QUEUED_ALERT_ID;
}
