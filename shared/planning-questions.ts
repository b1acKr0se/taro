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
 * ticket goes straight to In Progress without one, and its later questions keep their own flag.
 */
export function planningTicket(ticket: { status: string; notes: string | null }): boolean {
  return BEFORE_BUILD.has(ticket.status) && !roundRecords(ticket.notes).some((record) => /^APPROVAL\b/.test(record));
}

/** The decision as the plugin stores it: blocking while planning, marked so the chat still matches its block. */
export function asPlanningQuestion<D extends { blocking: boolean }>(decision: D, planning: boolean): D & { madeBlocking?: true } {
  return planning && !decision.blocking ? { ...decision, blocking: true, madeBlocking: true } : decision;
}

/** The block as the plugin stored it, for comparing an agent's block with its stored decision. */
export function asStored<D extends { blocking: boolean }>(block: D, stored: { madeBlocking?: boolean | undefined }): D {
  return stored.madeBlocking === true ? { ...block, blocking: true } : block;
}
