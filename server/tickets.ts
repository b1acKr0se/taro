/**
 * Tickets, read through the Backlog CLI's versioned JSON (`task list --json`,
 * `task view --json`), so the plugin never parses task files itself.
 */
import { z } from "zod";

import { noteRecords } from "../shared/execution";
import { runBacklog } from "./tracker";

const TicketSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    labels: z.array(z.string()).default([]),
    parentTaskId: z.string().nullable().default(null),
    acceptanceCriteriaCompleted: z.number().default(0),
    acceptanceCriteriaCount: z.number().default(0),
    createdAt: z.string().nullable().default(null),
    updatedAt: z.string().nullable().default(null),
    isReady: z.boolean().default(false),
  })
  .passthrough();
export type TicketSummary = z.infer<typeof TicketSummarySchema>;

const TicketListSchema = z.object({ tasks: z.array(TicketSummarySchema) }).passthrough();

const TicketDetailSchema = TicketSummarySchema.extend({
  description: z.string().nullable().default(null),
  dependencies: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.object({ index: z.number(), text: z.string(), checked: z.boolean().default(false) }).passthrough()).default([]),
  implementationPlan: z.string().nullable().default(null),
  implementationNotes: z.string().nullable().default(null),
  finalSummary: z.string().nullable().default(null),
  subtasks: z.array(z.object({ id: z.string(), title: z.string(), status: z.string().optional() }).passthrough()).default([]),
});
export type TicketDetail = z.infer<typeof TicketDetailSchema>;

export async function listTickets(trackerPath: string): Promise<TicketSummary[]> {
  const output = await runBacklog(trackerPath, ["task", "list", "--json"]);
  return TicketListSchema.parse(JSON.parse(output)).tasks;
}

export async function viewTicket(trackerPath: string, ticketId: string): Promise<TicketDetail> {
  const output = await runBacklog(trackerPath, ["task", "view", ticketId, "--json"]);
  const parsed: unknown = JSON.parse(output);
  const task: unknown = typeof parsed === "object" && parsed !== null && "task" in parsed ? Reflect.get(parsed, "task") : parsed;
  return TicketDetailSchema.parse(task);
}

/** Appends a timestamped record to the ticket's notes. */
export async function appendTicketNote(trackerPath: string, ticketId: string, record: string): Promise<void> {
  await runBacklog(trackerPath, ["task", "edit", ticketId, "--append-notes", record, "--plain"]);
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
