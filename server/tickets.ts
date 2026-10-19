/**
 * Tickets, read and written in process through one ticket store per tracker (TR-081): no process
 * is started for a ticket.
 */
import { deliveryOnOffer } from "../shared/delivery-end";
import { noteRecords } from "../shared/execution";
import { startsPlanning } from "../shared/owner-start";
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
