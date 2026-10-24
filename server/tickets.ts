/**
 * Tickets, read and written in process through one ticket store per tracker (TR-081): no process
 * is started for a ticket.
 */
import { deliveryOnOffer } from "../shared/delivery-end";
import { executionBranch, executionOwners, noteRecords } from "../shared/execution";
import { startsPlanning } from "../shared/owner-start";
import { dispatchPending } from "../shared/pause";
import { closeRoundRefusal, reopenedRecordText, reopenRefusal, reopenRound, roundClosedRecordText } from "../shared/reopen";
import type { TicketPriority, TicketProblem } from "../shared/ticket-format";
import { createTicketStore, type TicketStore } from "./ticket-store";

export interface TicketSummary {
  id: string;
  title: string;
  status: string;
  priority: TicketPriority | null;
  labels: string[];
  parentTaskId: string | null;
  dependencies: string[];
  acceptanceCriteriaCompleted: number;
  acceptanceCriteriaCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TicketDetail extends TicketSummary {
  description: string | null;
  acceptanceCriteria: { index: number; text: string; checked: boolean }[];
  implementationPlan: string | null;
  implementationNotes: string | null;
  finalSummary: string | null;
  subtasks: { id: string; title: string; status: string }[];
}

export type { TicketProblem };

const stores = new Map<string, TicketStore>();

function storeFor(trackerPath: string): TicketStore {
  let store = stores.get(trackerPath);
  if (store === undefined) {
    store = createTicketStore(trackerPath);
    stores.set(trackerPath, store);
  }
  return store;
}

/** An empty section reads as null. */
function textOrNull(text: string): string | null {
  return text === "" ? null : text;
}

export async function listTickets(trackerPath: string): Promise<TicketSummary[]> {
  const { tickets } = await storeFor(trackerPath).list();
  return tickets.map((ticket) => ({
    id: ticket.id,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    labels: ticket.labels,
    parentTaskId: ticket.parent,
    dependencies: ticket.dependsOn,
    acceptanceCriteriaCompleted: ticket.criteriaChecked,
    acceptanceCriteriaCount: ticket.criteriaCount,
    createdAt: ticket.created,
    updatedAt: ticket.updated,
  }));
}

/** The files that could not be read as tickets, each with its line; their cards are left off the board. */
export async function ticketProblems(trackerPath: string): Promise<TicketProblem[]> {
  return (await storeFor(trackerPath).list()).problems;
}

export async function viewTicket(trackerPath: string, ticketId: string): Promise<TicketDetail> {
  const { ticket, subtasks } = await storeFor(trackerPath).view(ticketId);
  return {
    id: ticket.id,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    labels: ticket.labels,
    parentTaskId: ticket.parent,
    dependencies: ticket.dependsOn,
    acceptanceCriteriaCompleted: ticket.criteria.filter((criterion) => criterion.checked).length,
    acceptanceCriteriaCount: ticket.criteria.length,
    createdAt: ticket.created,
    updatedAt: ticket.updated,
    description: textOrNull(ticket.description),
    acceptanceCriteria: ticket.criteria.map((criterion) => ({ index: criterion.index, text: criterion.text, checked: criterion.checked })),
    implementationPlan: textOrNull(ticket.plan),
    implementationNotes: textOrNull(ticket.notes),
    finalSummary: textOrNull(ticket.finalSummary),
    subtasks: subtasks.map((child) => ({ id: child.id, title: child.title, status: child.status })),
  };
}

/** What a parent's detail shows of a child (TR-187), read from the child's file alone: a tracker of 200 tickets is not listed once per child. */
export async function childRecords(trackerPath: string, ticketId: string): Promise<{ id: string; status: string; labels: string[]; notes: string | null }> {
  const ticket = await storeFor(trackerPath).read(ticketId);
  return { id: ticket.id, status: ticket.status, labels: ticket.labels, notes: textOrNull(ticket.notes) };
}

/** Appends a timestamped record to the ticket's notes. */
export async function appendTicketNote(trackerPath: string, ticketId: string, record: string): Promise<void> {
  await storeFor(trackerPath).appendNote(ticketId, record);
}

/**
 * The user sent changes on a delivery (TR-131): the record lands, and a ticket still Awaiting
 * acceptance goes back to In Progress in the same write, so its acceptance card leaves at once.
 * Any other status (the owner already moved it, or it was accepted) is left as it is.
 */
export async function recordChangesRequested(trackerPath: string, ticketId: string, record: string): Promise<void> {
  await storeFor(trackerPath).edit(ticketId, { appendNotes: [record], status: "In Progress", statusFrom: "Awaiting acceptance" });
}

/**
 * The owner asked a blocking question while its delivery was on offer (TR-130): the record lands and the
 * ticket goes back to In Progress in one write, checked under the lock so an Accept that just landed
 * keeps its ticket. False when the delivery was no longer on offer (nothing written).
 */
export async function endDelivery(trackerPath: string, ticketId: string, record: string): Promise<boolean> {
  const ticket = await storeFor(trackerPath).editIf(ticketId, deliveryOnOffer, { appendNotes: [record], status: "In Progress" });
  return ticket !== null;
}

/** Sets a Queued ticket Planning with the record in one write, as its owner starts (TR-173); false when it had moved on. */
export async function startPlanning(trackerPath: string, ticketId: string, record: string): Promise<boolean> {
  const ticket = await storeFor(trackerPath).editIf(ticketId, startsPlanning, { appendNotes: [record], status: "Planning" });
  return ticket !== null;
}

/** Appends the record and sets the ticket Done in one write: Accept run by the plugin (TR-141). */
export async function closeTicket(trackerPath: string, ticketId: string, record: string): Promise<void> {
  await storeFor(trackerPath).edit(ticketId, { status: "Done", appendNotes: [record] });
}

/** What Reopen did: the round now open and the owners of the earlier ones. */
export interface Reopened {
  title: string;
  round: number;
  pastOwners: string[];
}

/**
 * Reopen (TR-229): the REOPENED record (with a copy of the final summary, indented) and the ticket
 * Queued, the final summary kept: a reopened round verifies what it describes, and its own FINAL
 * replaces it at delivery. All in one write checked under the lock, so a ticket that changed
 * since it was read (another Reopen, a late owner note) is refused rather than reopened twice.
 * `beforeWrite` runs between the checks and the write.
 */
export async function reopenTicket(trackerPath: string, ticketId: string, note: string, at: string, beforeWrite: () => Promise<void> = async () => undefined): Promise<Reopened> {
  const store = storeFor(trackerPath);
  const ticket = await store.read(ticketId);
  const refusal = reopenRefusal(ticket.id, { status: ticket.status, parent: ticket.parent, note });
  if (refusal !== null) throw new Error(refusal);
  // What the caller checks outside the tracker (the last owner); a ticket changed meanwhile is refused below.
  await beforeWrite();
  const notes = textOrNull(ticket.notes);
  const round = reopenRound(notes) + 1;
  const pastOwners = executionOwners(notes);
  const record = reopenedRecordText({ at, note, round, pastOwners, finalSummary: textOrNull(ticket.finalSummary) });
  const unchanged = (current: { status: string; notes: string; finalSummary: string }) =>
    current.status === "Done" && current.notes === ticket.notes && current.finalSummary === ticket.finalSummary;
  const written = await store.editIf(ticket.id, unchanged, { appendNotes: [record], status: "Queued" });
  if (written === null) throw new Error(`${ticket.id} changed while it was being reopened; try again.`);
  return { title: ticket.title, round, pastOwners };
}

/** What Close round did: the round it closed and the branch its owner worked on, if one started. */
export interface RoundClosed {
  round: number;
  branch: string | null;
}

/**
 * Close round (TR-229): the ROUND-CLOSED record and the ticket Done, the final summary left as Reopen
 * kept it, in one write checked under the lock. Notes the owner wrote meanwhile do not refuse it (the user
 * is stopping that owner); a ticket that left the round or a status Close round allows is refused,
 * and so is one whose owner the manager is starting right now, as Park refuses it (TR-166): that
 * owner would start on a Done ticket, with nothing live yet to stop.
 * `beforeWrite` runs between the checks and the write.
 */
export async function closeRound(trackerPath: string, ticketId: string, at: string, beforeWrite: () => Promise<void> = async () => undefined): Promise<RoundClosed> {
  const store = storeFor(trackerPath);
  const ticket = await store.read(ticketId);
  const notes = textOrNull(ticket.notes);
  const round = reopenRound(notes);
  const refusal = closeRoundRefusal(ticket.id, { status: ticket.status, parent: ticket.parent, round });
  if (refusal !== null) throw new Error(refusal);
  const starting = (text: string | null) => dispatchPending(text, Date.now());
  if (starting(notes)) throw new Error(`The manager is starting ${ticket.id}'s owner right now: close its round in a minute, once the owner runs.`);
  // What the caller does outside the tracker (stopping the round's agents) comes before the write.
  await beforeWrite();
  const branch = executionBranch(notes);
  const stillOpen = (current: { status: string; notes: string }) =>
    reopenRound(textOrNull(current.notes)) === round && closeRoundRefusal(ticket.id, { status: current.status, parent: ticket.parent, round }) === null && !starting(textOrNull(current.notes));
  const written = await store.editIf(ticket.id, stillOpen, { appendNotes: [roundClosedRecordText({ at, round, branch })], status: "Done" });
  if (written === null) throw new Error(`${ticket.id} changed while its round was being closed; try again.`);
  return { round, branch };
}

/** The watcher saw `file` (a name under `tickets/`; every file when undefined) change: the next list reads it again. */
export function forgetTicketFile(trackerPath: string, file: string | undefined): void {
  stores.get(trackerPath)?.forget(file);
}

/** The latest `<KIND> …` record in the notes (records start a line with an upper-case name). */
export function latestRecord(notes: string | null, kinds: readonly string[]): string | null {
  const pattern = new RegExp(`^(?:${kinds.join("|")})\\b`);
  const records = noteRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (pattern.test(record)) return record;
  }
  return null;
}
