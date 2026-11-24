/**
 * A project's past escapes, read from the ESCAPE records owners write by hand on delivered tickets
 * (`ESCAPE 2026-01-06T09:00Z — <what shipped; fixed by …; missed by: …>`). Pure: picking, sorting and
 * formatting only. Run by `bin/taro` under Node type stripping, so erasable TypeScript and `.ts` imports.
 */

import { noteRecords } from "./execution.ts";

export const DEFAULT_ESCAPE_LIMIT = 20;
export const ESCAPE_LINE_LIMIT = 300;

export interface Escape {
  ticket: string;
  /** The time as the record wrote it, null when it wrote none. */
  time: string | null;
  /** The time as an instant (a date alone is that day's midnight UTC), null when unreadable. */
  instant: number | null;
  text: string;
}

const TIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

function instantOf(time: string): number | null {
  const withZone = time.includes("T") && !HAS_ZONE.test(time) ? `${time}Z` : time;
  const instant = Date.parse(withZone);
  return Number.isNaN(instant) ? null : instant;
}

/** One record as an escape, or null when it is not an ESCAPE record (the word must start the record). */
export function parseEscape(ticket: string, record: string): Escape | null {
  const match = /^ESCAPE\b[\s:]*([\s\S]*)$/.exec(record);
  if (match === null) return null;
  let rest = match[1] as string;
  const timeMatch = TIME.exec(rest);
  const time = timeMatch === null ? null : timeMatch[0];
  if (time !== null) rest = rest.slice(time.length);
  const text = rest.replace(/^[\s:]*(?:[—–-]+\s*)?/, "").replace(/\s+/g, " ").trim();
  return { ticket, time, instant: time === null ? null : instantOf(time), text };
}

/** Every ESCAPE record of the tickets given in ticket order, newest first; no time, or an unreadable one, last. */
export function sortedEscapes(tickets: readonly { id: string; notes: string }[]): Escape[] {
  const found = tickets.flatMap((ticket) => noteRecords(ticket.notes).flatMap((record) => parseEscape(ticket.id, record) ?? []));
  // Array.prototype.sort is stable, so equal instants keep ticket order.
  return found.sort((left, right) => {
    if (left.instant === null || right.instant === null) return (left.instant === null ? 1 : 0) - (right.instant === null ? 1 : 0);
    return right.instant - left.instant;
  });
}

/** `<ticket> · <time as written> — <text>`, cut to the line limit with an ellipsis. */
export function escapeLine(escape: Escape): string {
  const line = `${escape.ticket} · ${escape.time ?? "no time"} — ${escape.text}`;
  const characters = [...line];
  return characters.length <= ESCAPE_LINE_LIMIT ? line : `${characters.slice(0, ESCAPE_LINE_LIMIT - 1).join("")}…`;
}

/** The whole output; `limit` null shows every escape. */
export function escapesReport(escapes: readonly Escape[], limit: number | null, project: string): string {
  if (escapes.length === 0) return `No escapes recorded in ${project}.\n`;
  const shown = limit === null ? escapes : escapes.slice(0, limit);
  const hint = shown.length < escapes.length ? " (--all shows every one)" : "";
  const header = `${shown.length} of ${escapes.length} escapes recorded in ${project}, newest first${hint}`;
  return `${[header, ...shown.map(escapeLine)].join("\n")}\n`;
}
