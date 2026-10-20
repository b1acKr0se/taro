/**
 * An owner committing code before its ticket has a plan (TR-206): the TR-205 owner judged its ticket
 * trivial, skipped the plan and every record, and built. Every level writes a plan first
 * (roles/owner.md), so the plugin flags such commits on the ticket and stops the owner. Pure.
 */

/** Statuses after which nobody builds on the ticket any more. */
const CLOSED: ReadonlySet<string> = new Set(["Done", "Cancelled"]);

/**
 * Whether a ticket still worked on has no plan: then any commit on its owner's branch came first. An
 * older ticket kept its criteria as a checklist instead (reference/tickets.md), which counts as one.
 */
export function lacksPlan(ticket: { status: string; plan: string | null; criteria: number }): boolean {
  return !CLOSED.has(ticket.status) && (ticket.plan ?? "").trim() === "" && ticket.criteria === 0;
}

export function noPlanRecord(at: string, commits: number, branch: string, base: string): string {
  const counted = commits === 1 ? "1 commit" : `${commits} commits`;
  return `NO-PLAN ${at} — ${counted} on ${branch} past ${base} with no plan on the ticket: the owner was told to stop and write it`;
}
