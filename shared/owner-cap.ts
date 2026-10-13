/**
 * The cap on owners running at once (TR-029). An owner whose ticket waits for the user (Awaiting
 * acceptance) or is finished (Done, Cancelled) holds no slot, though it may still be alive; children
 * have no owner of their own, so they never hold one. The manager applies the same rule
 * (skill/roles/manager.md); the plugin uses it to decide when a slot frees up and to tell the count.
 */
import { TARO_LABELS } from "./project";

/** Statuses whose owner holds no slot. */
export const SLOT_FREE_STATUSES: ReadonlySet<string> = new Set(["Awaiting acceptance", "Done", "Cancelled"]);

export interface CapTicket {
  id: string;
  status: string;
  parentTaskId: string | null;
}

export interface CapOwner {
  status: string;
  labels: Readonly<Record<string, string>>;
}

/** Whether a ticket in this status, with an owner, holds a slot. Backlog has no owner yet. */
export function holdsSlot(status: string): boolean {
  return status !== "Backlog" && !SLOT_FREE_STATUSES.has(status);
}

/**
 * The tickets whose live owners count towards the cap, sorted, each once however many owners it
 * has. An owner of a ticket the tracker does not list counts: the cap errs towards waiting.
 */
export function ticketsCountingTowardsCap(owners: readonly CapOwner[], tickets: readonly CapTicket[]): string[] {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const counting = new Set<string>();
  for (const owner of owners) {
    if (owner.status === "closed" || owner.labels[TARO_LABELS.role] !== "owner") continue;
    const id = owner.labels[TARO_LABELS.ticket];
    if (id === undefined || id === "") continue;
    const ticket = byId.get(id);
    if (ticket !== undefined && (ticket.parentTaskId !== null || !holdsSlot(ticket.status))) continue;
    counting.add(id);
  }
  return [...counting].sort();
}

export interface StatusChange {
  ticket: string;
  status: string;
  /** The ticket stopped holding an owner slot with this change. */
  freesSlot: boolean;
}

/**
 * The changes since the last look that may concern the manager: every ticket newly Done (its
 * dependents may be clear) and every top-level ticket that stopped holding a slot. A ticket the
 * last look did not know (just created) frees nothing.
 */
export function statusChanges(previous: ReadonlyMap<string, string>, tickets: readonly CapTicket[]): StatusChange[] {
  return tickets.flatMap((ticket) => {
    const before = previous.get(ticket.id);
    if (before === ticket.status) return [];
    const freesSlot = ticket.parentTaskId === null && before !== undefined && holdsSlot(before) && !holdsSlot(ticket.status);
    return freesSlot || ticket.status === "Done" ? [{ ticket: ticket.id, status: ticket.status, freesSlot }] : [];
  });
}

/** Wake the manager when tickets were waiting on this one, or when a freed slot lets a queued ticket start. */
export function shouldWakeManager(input: { dependents: number; queued: number; freesSlot: boolean; counting: number; cap: number }): boolean {
  if (input.dependents > 0) return true;
  return input.freesSlot && input.queued > 0 && input.counting < input.cap;
}
