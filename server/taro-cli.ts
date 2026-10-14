/**
 * The `taro` command (TR-081 spec S7): `taro ticket list|view|search|create|edit|check` over the
 * ticket store. Run by `bin/taro` under plain Node type stripping: erasable TypeScript only, `.ts`
 * import extensions, Node builtins only, no npm packages.
 *
 * The first word picks the command from `commands`; `taro convert` (TR-081.03) joins that table.
 */
import { readFile, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isTicketStatus,
  TICKET_PRIORITIES,
  type Ticket,
  type TicketPriority,
  type TicketProblem,
  type TicketStatus,
  type TicketSummary,
} from "../shared/ticket-format.ts";
import {
  createTicketStore,
  RevisionConflict,
  TicketInvalid,
  TicketNotFound,
  type TicketChanges,
  type TicketStore,
} from "./ticket-store.ts";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
}

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_CONFLICT = 3;

const USAGE = `Usage:
  taro ticket list [-s <status>] [-l <label>] [-p <parent>] [--plain|--json]
  taro ticket view <ID> [--plain|--json]
  taro ticket search <query> [-s <status>] [--plain|--json]
  taro ticket create <title> [-d <text>] [-l <label>]... [-p <parent>] [--dep <ID>]...
                     [--priority high|medium|low] [-s <status>]
  taro ticket edit <ID> [-s <status>] [-t <title>] [-d <text>] [--plan <text>] [--final-summary <text>]
                   [--add-label <l>]... [--remove-label <l>]... [--dep <ID>]... [--priority <p>]
                   [--append-notes <text>]... [--check-ac <n>]... [--uncheck-ac <n>]...
                   [--revision <rev>] [--plain]
  taro ticket check [--json]
Every ticket command takes --tracker <path> (or $TARO_TRACKER). -l and --dep accept comma-separated lists.`;

class UsageError extends Error {}

interface OptionSpec {
  key: string;
  value: boolean;
}

type OptionTable = Record<string, OptionSpec>;

interface Parsed {
  positionals: string[];
  /** Every occurrence of an option, in order; a flag without a value records "". */
  options: Map<string, string[]>;
}

const COMMON_OPTIONS: OptionTable = {
  "--tracker": { key: "tracker", value: true },
  "--plain": { key: "plain", value: false },
  "--json": { key: "json", value: false },
};

/** Options may come before or after positionals; `--` ends option parsing; `--name=value` works too. */
function parseArguments(args: readonly string[], specific: OptionTable): Parsed {
  const table: OptionTable = { ...COMMON_OPTIONS, ...specific };
  const positionals: string[] = [];
  const options = new Map<string, string[]>();
  const record = (key: string, value: string) => options.set(key, [...(options.get(key) ?? []), value]);
  let index = 0;
  let optionsEnded = false;
  while (index < args.length) {
    const argument = args[index] as string;
    index += 1;
    if (optionsEnded || !argument.startsWith("-") || argument === "-") {
      positionals.push(argument);
      continue;
    }
    if (argument === "--") {
      optionsEnded = true;
      continue;
    }
    const equals = argument.startsWith("--") ? argument.indexOf("=") : -1;
    const name = equals === -1 ? argument : argument.slice(0, equals);
    const spec = table[name];
    if (spec === undefined) throw new UsageError(`Unknown option ${name}.`);
    if (!spec.value) {
      if (equals !== -1) throw new UsageError(`${name} takes no value.`);
      record(spec.key, "");
      continue;
    }
    if (equals !== -1) {
      record(spec.key, argument.slice(equals + 1));
      continue;
    }
    if (index >= args.length) throw new UsageError(`${name} needs a value.`);
    record(spec.key, args[index] as string);
    index += 1;
  }
  return { positionals, options };
}

function single(parsed: Parsed, key: string): string | undefined {
  const values = parsed.options.get(key);
  return values === undefined ? undefined : values[values.length - 1];
}

function has(parsed: Parsed, key: string): boolean {
  return parsed.options.has(key);
}

function commaList(parsed: Parsed, key: string): string[] | undefined {
  const values = parsed.options.get(key);
  if (values === undefined) return undefined;
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function numberList(parsed: Parsed, key: string, flag: string): number[] | undefined {
  const items = commaList(parsed, key);
  if (items === undefined) return undefined;
  return items.map((item) => {
    if (!/^\d+$/.test(item) || Number(item) < 1) throw new UsageError(`${flag} needs a criterion number, not "${item}".`);
    return Number(item);
  });
}

function expectPositionals(parsed: Parsed, count: number, what: string): void {
  if (parsed.positionals.length !== count) throw new UsageError(`Expected ${what}.`);
}

function priorityOf(value: string): TicketPriority {
  if (!(TICKET_PRIORITIES as readonly string[]).includes(value)) {
    throw new UsageError(`"${value}" is not a priority (high, medium, low).`);
  }
  return value as TicketPriority;
}

function statusOf(value: string): TicketStatus {
  if (!isTicketStatus(value)) throw new UsageError(`"${value}" is not a ticket status.`);
  return value;
}

function sameText(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

// ---------------------------------------------------------------- output

function summaryLine(summary: TicketSummary): string {
  const details = [
    summary.priority === null ? "" : `priority ${summary.priority}`,
    summary.labels.length === 0 ? "" : `labels ${summary.labels.join(", ")}`,
    summary.parent === null ? "" : `parent ${summary.parent}`,
  ].filter((part) => part !== "");
  return `${summary.id} [${summary.status}] ${summary.title}${details.length === 0 ? "" : ` (${details.join("; ")})`}`;
}

function plainList(summaries: readonly TicketSummary[]): string {
  return summaries.length === 0 ? "No tickets.\n" : `${summaries.map(summaryLine).join("\n")}\n`;
}

function plainTicket(ticket: Ticket, revision: string, subtasks: readonly TicketSummary[]): string {
  const lines = [
    `${ticket.id} - ${ticket.title}`,
    `Status: ${ticket.status}`,
    `Priority: ${ticket.priority ?? "none"}`,
    `Labels: ${ticket.labels.length === 0 ? "none" : ticket.labels.join(", ")}`,
    `Parent: ${ticket.parent ?? "none"}`,
    `Dependencies: ${ticket.dependsOn.length === 0 ? "none" : ticket.dependsOn.join(", ")}`,
    `Created: ${ticket.created}`,
    `Updated: ${ticket.updated}`,
    `Revision: ${revision}`,
  ];
  const section = (heading: string, body: string) => {
    if (body !== "") lines.push("", `${heading}:`, body);
  };
  section("Description", ticket.description);
  section("Plan", ticket.plan);
  section(
    "Acceptance criteria",
    ticket.criteria.map((criterion) => `- [${criterion.checked ? "x" : " "}] #${criterion.index} ${criterion.text}`).join("\n"),
  );
  section("Notes", ticket.notes);
  section("Final summary", ticket.finalSummary);
  section("Subtasks", subtasks.map(summaryLine).join("\n"));
  return `${lines.join("\n")}\n`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// ---------------------------------------------------------------- verbs

interface VerbContext {
  store: TicketStore;
  trackerPath: string;
  io: CliIo;
  parsed: Parsed;
}

const LIST_OPTIONS: OptionTable = {
  "-s": { key: "status", value: true },
  "--status": { key: "status", value: true },
  "-l": { key: "label", value: true },
  "--label": { key: "label", value: true },
  "-p": { key: "parent", value: true },
  "--parent": { key: "parent", value: true },
};

const SEARCH_OPTIONS: OptionTable = {
  "-s": { key: "status", value: true },
  "--status": { key: "status", value: true },
};

const CREATE_OPTIONS: OptionTable = {
  "-d": { key: "description", value: true },
  "--description": { key: "description", value: true },
  "-l": { key: "label", value: true },
  "--label": { key: "label", value: true },
  "-p": { key: "parent", value: true },
  "--parent": { key: "parent", value: true },
  "--dep": { key: "dep", value: true },
  "--priority": { key: "priority", value: true },
  "-s": { key: "status", value: true },
  "--status": { key: "status", value: true },
};

const EDIT_OPTIONS: OptionTable = {
  "-s": { key: "status", value: true },
  "--status": { key: "status", value: true },
  "-t": { key: "title", value: true },
  "--title": { key: "title", value: true },
  "-d": { key: "description", value: true },
  "--description": { key: "description", value: true },
  "--plan": { key: "plan", value: true },
  "--final-summary": { key: "finalSummary", value: true },
  "--add-label": { key: "addLabel", value: true },
  "--remove-label": { key: "removeLabel", value: true },
  "--dep": { key: "dep", value: true },
  "--priority": { key: "priority", value: true },
  "--append-notes": { key: "appendNotes", value: true },
  "--check-ac": { key: "checkAc", value: true },
  "--uncheck-ac": { key: "uncheckAc", value: true },
  "--revision": { key: "revision", value: true },
};

function filterSummaries(summaries: readonly TicketSummary[], parsed: Parsed): TicketSummary[] {
  const status = single(parsed, "status");
  const labels = commaList(parsed, "label");
  const parent = single(parsed, "parent");
  return summaries.filter(
    (summary) =>
      (status === undefined || sameText(summary.status, status)) &&
      (labels === undefined || labels.every((label) => summary.labels.includes(label))) &&
      (parent === undefined || summary.parent === parent),
  );
}

async function listVerb({ store, io, parsed }: VerbContext): Promise<number> {
  expectPositionals(parsed, 0, "no arguments besides options");
  const { tickets } = await store.list();
  const shown = filterSummaries(tickets, parsed);
  io.stdout(has(parsed, "json") ? json({ tickets: shown }) : plainList(shown));
  return EXIT_OK;
}

async function viewVerb({ store, io, parsed }: VerbContext): Promise<number> {
  expectPositionals(parsed, 1, "one ticket id");
  const view = await store.view(parsed.positionals[0] as string);
  io.stdout(
    has(parsed, "json")
      ? json({ ticket: { ...view.ticket, revision: view.revision, file: view.file, subtasks: view.subtasks } })
      : plainTicket(view.ticket, view.revision, view.subtasks),
  );
  return EXIT_OK;
}

async function searchVerb({ store, io, parsed }: VerbContext): Promise<number> {
  expectPositionals(parsed, 1, "one search query");
  const found = filterSummaries(await store.search(parsed.positionals[0] as string), parsed);
  io.stdout(has(parsed, "json") ? json({ tickets: found }) : plainList(found));
  return EXIT_OK;
}

async function createVerb({ store, io, parsed }: VerbContext): Promise<number> {
  expectPositionals(parsed, 1, "one title");
  const priority = single(parsed, "priority");
  const status = single(parsed, "status");
  const ticket = await store.create({
    title: parsed.positionals[0] as string,
    ...(single(parsed, "description") === undefined ? {} : { description: single(parsed, "description") as string }),
    labels: commaList(parsed, "label") ?? [],
    parent: single(parsed, "parent") ?? null,
    dependsOn: commaList(parsed, "dep") ?? [],
    priority: priority === undefined ? null : priorityOf(priority),
    ...(status === undefined ? {} : { status: statusOf(status) }),
  });
  io.stdout(has(parsed, "json") ? json({ ticket }) : `Created ${ticket.id}\n`);
  return EXIT_OK;
}

function changesOf(parsed: Parsed): TicketChanges {
  const changes: TicketChanges = {};
  const status = single(parsed, "status");
  if (status !== undefined) changes.status = statusOf(status);
  const title = single(parsed, "title");
  if (title !== undefined) changes.title = title;
  const description = single(parsed, "description");
  if (description !== undefined) changes.description = description;
  const plan = single(parsed, "plan");
  if (plan !== undefined) changes.plan = plan;
  const finalSummary = single(parsed, "finalSummary");
  if (finalSummary !== undefined) changes.finalSummary = finalSummary;
  const priority = single(parsed, "priority");
  if (priority !== undefined) changes.priority = priorityOf(priority);
  const addLabels = commaList(parsed, "addLabel");
  if (addLabels !== undefined) changes.addLabels = addLabels;
  const removeLabels = commaList(parsed, "removeLabel");
  if (removeLabels !== undefined) changes.removeLabels = removeLabels;
  const dependencies = commaList(parsed, "dep");
  if (dependencies !== undefined) changes.addDependencies = dependencies;
  const notes = parsed.options.get("appendNotes");
  if (notes !== undefined) changes.appendNotes = notes;
  const checked = numberList(parsed, "checkAc", "--check-ac");
  if (checked !== undefined) changes.checkCriteria = checked;
  const unchecked = numberList(parsed, "uncheckAc", "--uncheck-ac");
  if (unchecked !== undefined) changes.uncheckCriteria = unchecked;
  return changes;
}

async function editVerb({ store, io, parsed }: VerbContext): Promise<number> {
  expectPositionals(parsed, 1, "one ticket id");
  const id = parsed.positionals[0] as string;
  const changes = changesOf(parsed);
  if (Object.keys(changes).length === 0) throw new UsageError("Nothing to change: give at least one edit option.");
  const revision = single(parsed, "revision");
  const ticket = await store.edit(id, changes, revision === undefined ? {} : { revision });
  if (has(parsed, "json")) {
    io.stdout(json({ ticket }));
  } else if (has(parsed, "plain")) {
    const view = await store.view(id);
    io.stdout(plainTicket(view.ticket, view.revision, view.subtasks));
  } else {
    io.stdout(`Updated ${ticket.id}\n`);
  }
  return EXIT_OK;
}

/** The line of a JSON.parse failure, from the "(line L column C)" V8 adds; 1 when it gives none. */
function jsonErrorLine(error: unknown): number {
  const match = /line (\d+)/.exec(error instanceof Error ? error.message : "");
  return match === null ? 1 : Number(match[1]);
}

async function trackerFileProblems(trackerPath: string): Promise<TicketProblem[]> {
  const file = "tracker.json";
  let text: string;
  try {
    text = await readFile(join(trackerPath, file), "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return [{ file, line: jsonErrorLine(error), message: "not valid JSON" }];
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [{ file, line: 1, message: "must be a JSON object" }];
  }
  const tracker = value as Record<string, unknown>;
  const problems: TicketProblem[] = [];
  if (typeof tracker.prefix !== "string" || tracker.prefix === "") problems.push({ file, line: 1, message: 'needs a non-empty "prefix" string' });
  if (typeof tracker.lastId !== "number") problems.push({ file, line: 1, message: 'needs a "lastId" number' });
  if (tracker.padding !== undefined && typeof tracker.padding !== "number") problems.push({ file, line: 1, message: '"padding" must be a number' });
  if (tracker.lastChild !== undefined && (typeof tracker.lastChild !== "object" || tracker.lastChild === null)) {
    problems.push({ file, line: 1, message: '"lastChild" must be an object' });
  }
  return problems;
}

async function checkVerb({ store, trackerPath, io, parsed }: VerbContext): Promise<number> {
  expectPositionals(parsed, 0, "no arguments besides options");
  const problems = [...(await trackerFileProblems(trackerPath)), ...(await store.list()).problems];
  if (has(parsed, "json")) {
    io.stdout(json({ problems }));
  } else {
    const count = `${problems.length} ${problems.length === 1 ? "problem" : "problems"}`;
    io.stdout(`${problems.map((problem) => `${problem.file}:${problem.line}: ${problem.message}`).join("\n")}${problems.length === 0 ? "" : "\n"}${count}\n`);
  }
  return problems.length === 0 ? EXIT_OK : EXIT_FAILURE;
}

interface Verb {
  options: OptionTable;
  run(context: VerbContext): Promise<number>;
}

const TICKET_VERBS: Record<string, Verb> = {
  list: { options: LIST_OPTIONS, run: listVerb },
  view: { options: {}, run: viewVerb },
  search: { options: SEARCH_OPTIONS, run: searchVerb },
  create: { options: CREATE_OPTIONS, run: createVerb },
  edit: { options: EDIT_OPTIONS, run: editVerb },
  check: { options: {}, run: checkVerb },
};

async function ticketCommand(args: readonly string[], io: CliIo): Promise<number> {
  const verbName = args[0];
  const verb = verbName === undefined ? undefined : TICKET_VERBS[verbName];
  if (verb === undefined || !Object.hasOwn(TICKET_VERBS, verbName as string)) {
    throw new UsageError(verbName === undefined ? "Missing ticket verb." : `Unknown ticket verb "${verbName}".`);
  }
  const parsed = parseArguments(args.slice(1), verb.options);
  const trackerPath = single(parsed, "tracker") ?? io.env.TARO_TRACKER;
  if (trackerPath === undefined || trackerPath === "") {
    throw new UsageError("No tracker: pass --tracker <path> or set TARO_TRACKER.");
  }
  const directory = await stat(trackerPath).catch(() => null);
  if (directory === null || !directory.isDirectory()) {
    io.stderr(`Tracker ${trackerPath} is not a directory.\n`);
    return EXIT_FAILURE;
  }
  return verb.run({ store: createTicketStore(trackerPath), trackerPath, io, parsed });
}

/** The first word of the command line picks the handler; `taro convert` is added here by TR-081.03. */
const commands: Record<string, (args: readonly string[], io: CliIo) => Promise<number>> = {
  ticket: ticketCommand,
};

function errorMessage(error: unknown): string {
  if (error instanceof TicketInvalid) {
    const [first, ...rest] = error.problems;
    if (first === undefined) return error.message;
    const more = rest.length === 0 ? "" : ` (and ${rest.length} more; run taro ticket check)`;
    return `${first.file}:${first.line}: ${first.message}${more}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] as string;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  try {
    const name = argv[0];
    if (name === "--help" || name === "-h" || name === "help") {
      io.stdout(`${USAGE}\n`);
      return EXIT_OK;
    }
    const command = name === undefined || !Object.hasOwn(commands, name) ? undefined : commands[name];
    if (command === undefined) throw new UsageError(name === undefined ? "Missing command." : `Unknown command "${name}".`);
    return await command(argv.slice(1), io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n${USAGE}\n`);
      return EXIT_USAGE;
    }
    if (error instanceof RevisionConflict) {
      io.stderr(`${errorMessage(error)}\n`);
      return EXIT_CONFLICT;
    }
    if (error instanceof TicketNotFound) {
      io.stderr(`${error.message}\n`);
      return EXIT_FAILURE;
    }
    io.stderr(`${errorMessage(error)}\n`);
    return EXIT_FAILURE;
  }
}

function runDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runDirectly()) {
  process.exitCode = await main(process.argv.slice(2), {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    env: process.env,
  });
}
