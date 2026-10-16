/**
 * What a Queued ticket waits on (TR-138), for its board card: its dependencies not yet Done and the
 * manager's HOLD in force, with the tickets either names, so tickets queued behind the same one read
 * alike; with neither, the owner slots and threads it waits for (TR-142), from the plugin's own
 * recount, so the card and the manager's wake-ups never disagree. A user's pause is not a wait: the
 * card says it as a pause. Pure.
 */
import { z } from "zod";

import { dependsOn } from "./owner-cap";
import { PAUSED_REASON } from "./pause";
import { unmetDependencies, type Recount } from "./queue-check";

/** What a startable ticket (no unmet dependency, no hold) waits for: a free owner slot and thread headroom. */
export const QueuedSlotSchema = z.object({
  /** The tickets whose owners count towards the cap. */
  running: z.array(z.string()),
  cap: z.number(),
  /** Startable tickets in the project, this one included: more than the free slots means not all start now. */
  startable: z.number(),
  /** Threads in use and the limit, or null where the host publishes none. */
  threads: z.object({ current: z.number(), max: z.number() }).nullable(),
  /** A live manager to start it once a slot is free: without one, nothing does. */
  managerRunning: z.boolean().default(true),
});
export type QueuedSlot = z.infer<typeof QueuedSlotSchema>;

export const QueuedWaitSchema = z.object({
  /** Every ticket it waits on, dependencies first then those the HOLD names, each with its status (null when the tracker has no such ticket). */
  on: z.array(z.object({ id: z.string(), status: z.string().nullable() })),
  /** The dependencies not yet Done. */
  dependencies: z.array(z.string()),
  /** The manager's HOLD reason in force, else null. */
  hold: z.string().nullable(),
  /** With no dependency or hold in the way, what the plugin's recount says it waits for (TR-142), else null. */
  slot: QueuedSlotSchema.nullable().default(null),
});
export type QueuedWait = z.infer<typeof QueuedWaitSchema>;

/** Ticket ids named in free text, in order, once each: `TR-131`, `NA-027.01`. */
export function namedTicketIds(text: string): string[] {
  return [...new Set(text.match(/\b[A-Z][A-Z0-9]*-\d+(?:\.\d+)*\b/g) ?? [])];
}

export function queuedWait(input: {
  id: string;
  dependencies: readonly string[];
  /** The HOLD reason in force (`holdReason`), else null. */
  holdReason: string | null;
  tickets: readonly { id: string; status: string; parentTaskId: string | null }[];
  /** `queuedSlot` of the plugin's recount: null when the recount does not find it startable. */
  slot?: QueuedSlot | null;
}): QueuedWait | null {
  const hold = input.holdReason !== null && !input.holdReason.toLowerCase().startsWith(PAUSED_REASON) ? input.holdReason : null;
  // Ids as the tracker writes them, so a dependency written "tr-131" and a HOLD naming TR-131 are one ticket.
  const ticketOf = (id: string) => input.tickets.find((ticket) => dependsOn([id], ticket.id)) ?? null;
  const tracked = (id: string) => ticketOf(id)?.id ?? id;
  const dependencies = unmetDependencies(input.dependencies, input.tickets).map(tracked);
  if (hold === null && dependencies.length === 0) {
    const slot = input.slot ?? null;
    return slot === null ? null : { on: [], dependencies: [], hold: null, slot };
  }
  const named = hold === null ? [] : namedTicketIds(hold).map(tracked).filter((id) => id !== input.id);
  const ids = [...new Set([...dependencies, ...named])];
  return { on: ids.map((id) => ({ id, status: ticketOf(id)?.status ?? null })), dependencies, hold, slot: null };
}

/**
 * The slot a ticket waits for, when the recount finds it startable; a held, waiting, owned (paused back
 * to Queued) or child ticket waits for something else, so it gets none.
 */
export function queuedSlot(count: Recount, id: string, managerRunning: boolean): QueuedSlot | null {
  if (!count.startable.includes(id)) return null;
  return { running: count.counting, cap: count.cap, startable: count.startable.length, threads: count.threads, managerRunning };
}
