/**
 * What a Queued ticket waits on (TR-138), for its board card: its dependencies not yet Done and the
 * manager's HOLD in force, with the tickets either names, so tickets queued behind the same one read
 * alike. A user's pause is not a wait: the card says it as a pause. Pure.
 */
import { z } from "zod";

import { dependsOn } from "./owner-cap";
import { PAUSED_REASON } from "./pause";
import { unmetDependencies } from "./queue-check";

export const QueuedWaitSchema = z.object({
  /** Every ticket it waits on, dependencies first then those the HOLD names, each with its status (null when the tracker has no such ticket). */
  on: z.array(z.object({ id: z.string(), status: z.string().nullable() })),
  /** The dependencies not yet Done. */
  dependencies: z.array(z.string()),
  /** The manager's HOLD reason in force, else null. */
  hold: z.string().nullable(),
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
}): QueuedWait | null {
  const hold = input.holdReason !== null && !input.holdReason.toLowerCase().startsWith(PAUSED_REASON) ? input.holdReason : null;
  // Ids as the tracker writes them, so a dependency written "tr-131" and a HOLD naming TR-131 are one ticket.
  const ticketOf = (id: string) => input.tickets.find((ticket) => dependsOn([id], ticket.id)) ?? null;
  const tracked = (id: string) => ticketOf(id)?.id ?? id;
  const dependencies = unmetDependencies(input.dependencies, input.tickets).map(tracked);
  if (hold === null && dependencies.length === 0) return null;
  const named = hold === null ? [] : namedTicketIds(hold).map(tracked).filter((id) => id !== input.id);
  const ids = [...new Set([...dependencies, ...named])];
  return { on: ids.map((id) => ({ id, status: ticketOf(id)?.status ?? null })), dependencies, hold };
}
