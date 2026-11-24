/**
 * `taro escapes [--all | --limit <n>]`: the project's past escapes, newest first, for a reviewer to check a
 * change against. Reads the tracker only. Run by `bin/taro` under Node type stripping: erasable TypeScript,
 * `.ts` import extensions, Node built-ins only.
 */
import { DEFAULT_ESCAPE_LIMIT, escapesReport, sortedEscapes } from "../shared/escapes.ts";
import type { TicketStore } from "./ticket-store.ts";

export class EscapesUsage extends Error {}

/** The number of escapes to show: null for all; a usage error for anything but a positive integer. */
export function escapeLimit(all: boolean, limit: string | undefined): number | null {
  if (all && limit !== undefined) throw new EscapesUsage("Give --all or --limit <n>, not both.");
  if (all) return null;
  if (limit === undefined) return DEFAULT_ESCAPE_LIMIT;
  if (!/^\d+$/.test(limit) || Number(limit) < 1) throw new EscapesUsage(`--limit needs a positive whole number, not "${limit}".`);
  return Number(limit);
}

export async function escapesCommand(input: { store: TicketStore; project: string; limit: number | null }, stdout: (text: string) => void): Promise<number> {
  const { tickets } = await input.store.list();
  const read = await Promise.all(tickets.map(async (summary) => ({ id: summary.id, notes: (await input.store.read(summary.id)).notes })));
  stdout(escapesReport(sortedEscapes(read), input.limit, input.project));
  return 0;
}
