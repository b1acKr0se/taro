/**
 * Every question an owner asks before its plan is approved waits for the user (TR-146): an answer
 * then can change the whole plan, so going on with a default wastes the plan built on it. The plugin
 * shows such a question as blocking whatever its flag says. Pure.
 */
import { roundRecords } from "./execution";

/** Statuses before the build starts (reference/tickets.md); Ready and later come after approval. */
const BEFORE_BUILD: ReadonlySet<string> = new Set(["Queued", "Planning"]);

/**
 * Whether the ticket is still being planned: Queued or Planning, with no APPROVAL record. A trivial
 * or low ticket goes straight to In Progress without one, and its later questions keep their own flag.
 */
export function planningTicket(ticket: { status: string; notes: string | null }): boolean {
  return BEFORE_BUILD.has(ticket.status) && !roundRecords(ticket.notes).some((record) => /^APPROVAL(?![\w-])/.test(record));
}

/** The decision as the plugin stores it: blocking while planning, marked so the chat still matches its block. */
export function asPlanningQuestion<D extends { blocking: boolean }>(decision: D, planning: boolean): D & { madeBlocking?: true } {
  return planning && !decision.blocking ? { ...decision, blocking: true, madeBlocking: true } : decision;
}

/** The block as the plugin stored it, for comparing an agent's block with its stored decision (made blocking, TR-146, or not, TR-263). */
export function asStored<D extends { blocking: boolean }>(block: D, stored: { madeBlocking?: boolean | undefined; madeNonBlocking?: boolean | undefined }): D {
  if (stored.madeBlocking === true) return { ...block, blocking: true };
  return stored.madeNonBlocking === true ? { ...block, blocking: false } : block;
}

/**
 * An owner's question asked after approval that the plugin showed not blocking, the owner going on with
 * its default (TR-263): the owner decided it, so it holds neither the delivery nor Accept, and it is not
 * counted in Needs you, the Inbox or a notification. It stays answerable in the ticket chat until delivery.
 */
export function wentOnWithDefault(decision: { madeNonBlocking?: boolean | undefined }): boolean {
  return decision.madeNonBlocking === true;
}
