/**
 * Review findings by the model that wrote the reviewed code, read from the tickets' notes. Each independent
 * review's REVIEW record carries one `findings: <model> — high <n>, medium <n>, low <n>` line per author model,
 * counting only that record's new findings, so summing across records counts each finding once. Owners type the
 * lines by hand: the usual variants are read, and a line missing a level is skipped rather than guessed.
 */

import { noteRecords } from "./execution.ts";
import { isPlanReview } from "./plan-lint.ts";

export interface ModelFindings {
  model: string;
  high: number;
  medium: number;
  low: number;
}

export interface FindingsRow extends ModelFindings {
  /** Distinct tickets with at least one findings line naming the model. */
  tickets: number;
  /** ESCAPE records on those tickets: defects found after delivery. */
  escapes: number;
}

export interface TicketNotes {
  id: string;
  notes: string | null;
}

export const ALL_MODELS = "All models";

/** `<model> — high <n>, medium <n>, low <n>`, the dash an em or en dash, `--` or a spaced `-`. */
const FINDINGS_LINE = /^[ \t]*findings[ \t]*:[ \t]*(\S+?)(?:[ \t]*[—–][ \t]*|[ \t]+--?[ \t]+)high[ \t]*:?[ \t]*(\d+)[ \t]*,[ \t]*medium[ \t]*:?[ \t]*(\d+)[ \t]*,[ \t]*low[ \t]*:?[ \t]*(\d+)\b/gim;

/** `claude/claude-sonnet-5-5[1m]` → `claude-sonnet-5-5`: the provider and the context window are not the model. */
export function normaliseModel(model: string): string {
  const bare = model.replace(/^`+|`+$/g, "");
  return bare.slice(bare.lastIndexOf("/") + 1).replace(/\[[^\]]*\]$/, "").toLowerCase();
}

/** Every findings line of one REVIEW record, in order. */
export function parseFindingsLines(record: string): ModelFindings[] {
  return [...record.matchAll(FINDINGS_LINE)].flatMap((match) => {
    const model = normaliseModel(match[1] ?? "");
    if (model === "") return [];
    return [{ model, high: Number(match[2]), medium: Number(match[3]), low: Number(match[4]) }];
  });
}

/**
 * A ticket's records, with a line an owner wrote as `FINDINGS: …` kept in the record it belongs to: the notes split
 * at any line starting with an upper-case word, which would cut it off its REVIEW record.
 */
function recordsOf(notes: string | null): string[] {
  const records: string[] = [];
  noteRecords(notes).forEach((record) => {
    if (/^FINDINGS[ \t]*:/.test(record) && records.length > 0) records[records.length - 1] += `\n${record}`;
    else records.push(record);
  });
  return records;
}

interface TicketFindings {
  id: string;
  /** One entry per findings line of every work REVIEW record. */
  lines: ModelFindings[];
  /** Work REVIEW records with at least one findings line. */
  reviews: number;
  escapes: number;
}

// The record names exactly: `\b` also matches before a hyphen, so `ESCAPE-NOTE` or `REVIEW-NOTE` would count.
const REVIEW_RECORD = /^REVIEW(?=[\s:]|$)/;
const ESCAPE_RECORD = /^ESCAPE(?=[\s:]|$)/;

function ticketFindings(ticket: TicketNotes): TicketFindings {
  const records = recordsOf(ticket.notes);
  const reviews = records.filter((record) => REVIEW_RECORD.test(record) && !isPlanReview(record)).map(parseFindingsLines);
  return {
    id: ticket.id,
    lines: reviews.flat(),
    reviews: reviews.filter((lines) => lines.length > 0).length,
    escapes: records.filter((record) => ESCAPE_RECORD.test(record)).length,
  };
}

function emptyRow(model: string): FindingsRow {
  return { model, tickets: 0, high: 0, medium: 0, low: 0, escapes: 0 };
}

function highPerTicket(row: FindingsRow): number {
  return row.tickets === 0 ? 0 : row.high / row.tickets;
}

/** Highest High per ticket reviewed first, then more tickets reviewed, then by name. */
export function compareRows(left: FindingsRow, right: FindingsRow): number {
  return highPerTicket(right) - highPerTicket(left) || right.tickets - left.tickets || left.model.localeCompare(right.model);
}

/** One row per author model, sorted by `compareRows`. */
export function findingsByModel(tickets: readonly TicketNotes[]): FindingsRow[] {
  return rowsByModel(tickets.map(ticketFindings));
}

function rowsByModel(tickets: readonly TicketFindings[]): FindingsRow[] {
  const rows = new Map<string, FindingsRow>();
  tickets.forEach((ticket) => {
    const named = new Set<string>();
    ticket.lines.forEach((line) => {
      const row = rows.get(line.model) ?? emptyRow(line.model);
      rows.set(line.model, row);
      row.high += line.high;
      row.medium += line.medium;
      row.low += line.low;
      named.add(line.model);
    });
    named.forEach((model) => {
      const row = rows.get(model);
      if (row === undefined) return;
      row.tickets += 1;
      row.escapes += ticket.escapes;
    });
  });
  return [...rows.values()].sort(compareRows);
}

/** The All models row: each ticket and each ESCAPE record once, however many models a ticket names. */
export function allModels(tickets: readonly TicketNotes[]): FindingsRow {
  return allRow(tickets.map(ticketFindings));
}

function allRow(tickets: readonly TicketFindings[]): FindingsRow {
  const row = emptyRow(ALL_MODELS);
  tickets.forEach((ticket) => {
    if (ticket.lines.length === 0) return;
    row.tickets += 1;
    row.escapes += ticket.escapes;
    ticket.lines.forEach((line) => {
      row.high += line.high;
      row.medium += line.medium;
      row.low += line.low;
    });
  });
  return row;
}

/** REVIEW records with at least one findings line, plan reviews left out. */
export function reviewsWithFindings(tickets: readonly TicketNotes[]): number {
  return reviewCount(tickets.map(ticketFindings));
}

function reviewCount(tickets: readonly TicketFindings[]): number {
  return tickets.reduce((total, ticket) => total + ticket.reviews, 0);
}

export interface FindingsSummary {
  models: FindingsRow[];
  all: FindingsRow;
  reviews: number;
}

/** The whole answer for a project's tickets, each ticket's notes read once. */
export function findingsSummary(tickets: readonly TicketNotes[]): FindingsSummary {
  const read = tickets.map(ticketFindings);
  return { models: rowsByModel(read), all: allRow(read), reviews: reviewCount(read) };
}
