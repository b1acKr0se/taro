/**
 * Who may not take the user's actions on a ticket from the `taro` command: the ticket's own workers
 * (its owner and that owner's subagents), so no worker approves or accepts its own work. Any other
 * agent session, such as one the user asked to act for them, may. Pure, so vitest reads it.
 */

/** A ticket and its children (`TR-12`, `TR-12.1`) share workers: an owner's child agents carry the child's id. */
export function sameTicketFamily(first: string, second: string): boolean {
  if (first === second) return true;
  return first.startsWith(`${second}.`) || second.startsWith(`${first}.`);
}

export interface CallerIdentity {
  project: string;
  ticket: string | null;
}

/** Whether the calling agent, by its labels, works on this project's ticket. */
export function isTicketWorker(caller: CallerIdentity | null, project: string, ticket: string | null): boolean {
  if (caller === null || caller.ticket === null || ticket === null) return false;
  return caller.project === project && sameTicketFamily(caller.ticket, ticket);
}

export function workerRefusal(action: string): string {
  return `${action} is the user's: it refuses inside the ticket's own owner and subagents, which cannot approve or accept their own work. Ask the user.`;
}
