/**
 * `taro stats <ID>` and `taro stats --project <p> [--since <date>]` (TR-263): how long a ticket's round
 * took from Planning to its first Awaiting acceptance, what the user was asked before and after the
 * round's approval, and what the plugin had to correct. Read from the plugin's stats file and the
 * tracker, both read-only. Run by `bin/taro` under plain Node type stripping: erasable TypeScript
 * only, `.ts` import extensions, Node builtins only.
 */
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { deliveryTimings, spreadOf, type DeliveryTimings, type Spread } from "../shared/delivery-timings.ts";
import { createTicketStore } from "./ticket-store.ts";

export class StatsUsage extends Error {}
export class StatsRefused extends Error {}

export interface StatsIo {
  stdout(text: string): void;
  env: Record<string, string | undefined>;
  now?: () => number;
}

const MINUTE = 60_000;

/** One ticket's recorded stats as the file holds them; a file from before a field existed lacks it. */
interface RecordedTicket {
  project: string;
  ticket: string;
  title: string;
  transitions: { to: string; at: string }[];
  waiting: { start: string; end: string }[];
  nudges: number;
  nudgedAt: string[];
  permissionWaits: { start: string; end: string }[];
}

function recorded(value: unknown): RecordedTicket | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.project !== "string" || typeof raw.ticket !== "string") return null;
  const stretches = (field: string): { start: string; end: string }[] => list(field).flatMap((each) => (typeof each.start === "string" && typeof each.end === "string" ? [{ start: each.start, end: each.end }] : []));
  const list = (field: string): Record<string, unknown>[] => (Array.isArray(raw[field]) ? (raw[field] as unknown[]).filter((each): each is Record<string, unknown> => typeof each === "object" && each !== null) : []);
  const number = (field: string): number => (typeof raw[field] === "number" ? (raw[field] as number) : 0);
  return {
    project: raw.project,
    ticket: raw.ticket,
    title: typeof raw.title === "string" ? raw.title : "",
    transitions: list("transitions").flatMap((each) => (typeof each.to === "string" && typeof each.at === "string" ? [{ to: each.to, at: each.at }] : [])),
    waiting: stretches("waiting"),
    nudges: number("nudges"),
    nudgedAt: Array.isArray(raw.nudgedAt) ? raw.nudgedAt.filter((each): each is string => typeof each === "string") : [],
    permissionWaits: stretches("permissionWaits"),
  };
}

async function readRecorded(home: string): Promise<RecordedTicket[]> {
  const text = await readFile(join(home, "plugin-data", "taro", "state", "stats.json"), "utf8").catch(() => null);
  if (text === null) throw new StatsRefused(`No stats file under ${home}: is --home right?`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StatsRefused(`The stats file under ${home} is not readable.`);
  }
  const tickets = typeof parsed === "object" && parsed !== null ? (parsed as { tickets?: unknown }).tickets : undefined;
  if (typeof tickets !== "object" || tickets === null) return [];
  return Object.values(tickets).flatMap((each) => {
    const ticket = recorded(each);
    return ticket === null ? [] : [ticket];
  });
}

interface Row {
  ticket: string;
  title: string;
  timings: DeliveryTimings;
}

async function rowFor(recordedTicket: RecordedTicket, tracker: string, now: number): Promise<Row | null> {
  const ticket = await createTicketStore(tracker).read(recordedTicket.ticket).catch(() => null);
  if (ticket === null) return null;
  const timings = deliveryTimings({ notes: ticket.notes, transitions: recordedTicket.transitions, waiting: recordedTicket.waiting, nudges: recordedTicket.nudges, nudgedAt: recordedTicket.nudgedAt, permissionWaits: recordedTicket.permissionWaits }, now);
  return { ticket: recordedTicket.ticket, title: ticket.title, timings };
}

function minutes(ms: number | null): string {
  if (ms === null) return "-";
  const value = ms / MINUTE;
  return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

function correctionTotal(timings: DeliveryTimings): number {
  const { noPlan, noApproval, held, madeNonBlocking, nudges } = timings.corrections;
  return noPlan + noApproval + held + madeNonBlocking + nudges;
}

function ticketText(row: Row, state: string): string {
  const { timings } = row;
  const corrections = timings.corrections;
  return [
    `${row.ticket}  ${row.title}`,
    `  Planning → first Awaiting acceptance: ${timings.planningToAwaitingMs === null ? `not reached (${state})` : `${minutes(timings.planningToAwaitingMs)} min`}${timings.planningAt === null ? "" : ` (Planning at ${timings.planningAt})`}`,
    `  Approved: ${timings.approvedAt ?? "not approved this round"}`,
    `  In Needs you before approval: ${minutes(timings.needsYouBeforeApprovalMs)} min; after: ${minutes(timings.needsYouAfterApprovalMs)} min`,
    `  Cards answered after approval: ${timings.cardsAnsweredAfterApproval}`,
    `  Plugin corrections: ${correctionTotal(timings)} (NO-PLAN ${corrections.noPlan}, NO-APPROVAL ${corrections.noApproval}, held ${corrections.held}, made non-blocking ${corrections.madeNonBlocking}, nudges ${corrections.nudges}${corrections.untimedNudges === 0 ? "" : `, ${corrections.untimedNudges} of them from before nudge times were kept, so not limited to this round`})`,
    `  Permission asks waited: ${minutes(timings.permissionWaitMs)} min`,
    "",
  ].join("\n");
}

function spreadLine(label: string, spread: Spread | null, unit: "min" | ""): string {
  const show = (value: number): string => (unit === "min" ? minutes(value) : String(Math.round(value * 10) / 10));
  const suffix = unit === "min" ? " min" : "";
  return spread === null ? `  ${label}: no data` : `  ${label}: median ${show(spread.median)}${suffix}, p90 ${show(spread.p90)}${suffix} (${spread.count} tickets)`;
}

function projectText(project: string, since: string | null, rows: readonly Row[]): string {
  const reached = rows.filter((row) => row.timings.planningToAwaitingMs !== null);
  const planned = rows.filter((row) => row.timings.planningAt !== null);
  const pick = (list: readonly Row[], read: (timings: DeliveryTimings) => number): Spread | null => spreadOf(list.map((row) => read(row.timings)));
  return [
    `Project ${project}${since === null ? "" : `, planned since ${since}`}: ${planned.length} tickets planned, ${reached.length} reached Awaiting acceptance`,
    spreadLine("Planning → first Awaiting acceptance", pick(reached, (timings) => timings.planningToAwaitingMs ?? 0), "min"),
    spreadLine("In Needs you before approval", pick(reached, (timings) => timings.needsYouBeforeApprovalMs), "min"),
    spreadLine("In Needs you after approval", pick(reached, (timings) => timings.needsYouAfterApprovalMs), "min"),
    spreadLine("Cards answered after approval", pick(reached, (timings) => timings.cardsAnsweredAfterApproval), ""),
    spreadLine("Plugin corrections", pick(reached, correctionTotal), ""),
    spreadLine("Permission asks waited", pick(reached, (timings) => timings.permissionWaitMs), "min"),
    "",
  ].join("\n");
}

function parseOptions(args: readonly string[]): { positionals: string[]; options: Map<string, string> } {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  const withValue = new Set(["--project", "--since", "--home", "--tracker"]);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] as string;
    if (argument === "--json") options.set("--json", "");
    else if (argument === "--plain") continue;
    else if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = equals === -1 ? argument : argument.slice(0, equals);
      if (!withValue.has(name)) throw new StatsUsage(`Unknown option ${name}.`);
      const value = equals === -1 ? args[++index] : argument.slice(equals + 1);
      if (value === undefined) throw new StatsUsage(`${name} needs a value.`);
      options.set(name, value);
    } else positionals.push(argument);
  }
  return { positionals, options };
}

/** Runs `taro stats …`; throws StatsUsage for a misuse and StatsRefused for a missing file or ticket. */
export async function statsCommand(args: readonly string[], io: StatsIo): Promise<number> {
  const { positionals, options } = parseOptions(args);
  const now = (io.now ?? Date.now)();
  const home = options.get("--home") ?? io.env.PASEO_HOME ?? join(homedir(), ".paseo");
  const json = options.has("--json");
  const sinceText = options.get("--since") ?? null;
  const since = sinceText === null ? null : Date.parse(sinceText);
  if (since !== null && Number.isNaN(since)) throw new StatsUsage(`--since needs a date such as 2026-10-13, not "${sinceText}".`);
  const all = await readRecorded(home);
  const trackerFor = async (project: string): Promise<string> => {
    // An explicit --project names its own tracker under --home; $TARO_TRACKER (an agent's) serves the commands that name none.
    const derived = join(home, "plugin-data", "taro", "home", "projects", project, "tracker");
    const tracker = options.get("--tracker") ?? (options.has("--project") ? derived : (io.env.TARO_TRACKER ?? derived));
    const directory = await stat(tracker).catch(() => null);
    if (directory === null || !directory.isDirectory()) throw new StatsRefused(`Tracker ${tracker} is not a directory.`);
    return tracker;
  };

  if (positionals.length === 1) {
    if (options.has("--since")) throw new StatsUsage("--since goes with --project.");
    const id = positionals[0] as string;
    const project = options.get("--project") ?? io.env.TARO_PROJECT;
    const matches = all.filter((each) => each.ticket === id && (project === undefined || each.project === project));
    const found = matches[0];
    if (found === undefined || matches.length > 1) {
      throw new StatsRefused(matches.length > 1 ? `${id} is in several projects: pass --project.` : `No stats recorded for ${id}.`);
    }
    const row = await rowFor(found, await trackerFor(found.project), now);
    if (row === null) throw new StatsRefused(`${id} is not in the tracker.`);
    const last = found.transitions[found.transitions.length - 1]?.to ?? "no status";
    io.stdout(json ? `${JSON.stringify({ ticket: id, title: row.title, ...row.timings }, null, 2)}\n` : ticketText(row, last));
    return 0;
  }
  if (positionals.length > 1 || (positionals.length === 0 && !options.has("--project"))) {
    throw new StatsUsage("Give one ticket id, or --project <name> [--since <date>].");
  }
  const project = options.get("--project") as string;
  const tracker = await trackerFor(project);
  const rows = (await Promise.all(all.filter((each) => each.project === project).map((each) => rowFor(each, tracker, now)))).filter((row): row is Row => row !== null);
  const inRange = rows.filter((row) => since === null || (row.timings.planningAt !== null && Date.parse(row.timings.planningAt) >= since));
  if (json) {
    const reached = inRange.filter((row) => row.timings.planningToAwaitingMs !== null);
    const spread = (read: (timings: DeliveryTimings) => number) => spreadOf(reached.map((row) => read(row.timings)));
    io.stdout(
      `${JSON.stringify(
        {
          project,
          since: sinceText,
          tickets: inRange.map((row) => ({ ticket: row.ticket, title: row.title, ...row.timings })),
          planningToAwaitingMs: spread((timings) => timings.planningToAwaitingMs ?? 0),
          needsYouBeforeApprovalMs: spread((timings) => timings.needsYouBeforeApprovalMs),
          needsYouAfterApprovalMs: spread((timings) => timings.needsYouAfterApprovalMs),
          cardsAnsweredAfterApproval: spread((timings) => timings.cardsAnsweredAfterApproval),
          corrections: spread(correctionTotal),
          permissionWaitMs: spread((timings) => timings.permissionWaitMs),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }
  io.stdout(projectText(project, sinceText, inRange));
  return 0;
}
