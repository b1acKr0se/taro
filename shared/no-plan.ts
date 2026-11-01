/**
 * An owner committing code before its ticket has a plan (TR-206): the plugin flags such commits on
 * the ticket and stops the owner. A trivial or low ticket is exempt (TR-241): its owner may build first and
 * write the plan afterwards, and the acceptance card shows it. Pure.
 */

/** Statuses after which nobody builds on the ticket any more. */
const CLOSED: ReadonlySet<string> = new Set(["Done", "Cancelled"]);

/** Whether the owner rated the ticket trivial or low: the levels that may build before they plan. */
export function mayBuildBeforePlan(labels: readonly string[]): boolean {
  return labels.includes("complexity-trivial") || labels.includes("complexity-low");
}

/**
 * Whether a ticket still worked on has no plan: then any commit on its owner's branch came first. An
 * older ticket kept its criteria as a checklist instead (reference/tickets.md), which counts as one.
 */
export function lacksPlan(ticket: { status: string; plan: string | null; criteria: number; labels: readonly string[] }): boolean {
  return !CLOSED.has(ticket.status) && !mayBuildBeforePlan(ticket.labels) && (ticket.plan ?? "").trim() === "" && ticket.criteria === 0;
}

export function noPlanRecord(at: string, commits: number, branch: string, base: string): string {
  const counted = commits === 1 ? "1 commit" : `${commits} commits`;
  return `NO-PLAN ${at} — ${counted} on ${branch} past ${base} with no plan on the ticket: the owner was told to stop and write it`;
}
