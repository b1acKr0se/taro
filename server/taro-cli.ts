/**
 * The `taro` command (TR-081 spec S7): `taro ticket list|view|search|create|edit|check` over the
 * ticket store, the buttons over the daemon, and the owner's mechanical steps (`taro agent`,
 * `taro check`, `taro deliver`, `taro daemon`, in `owner-commands.ts`). Run by `bin/taro` under plain Node type stripping: erasable TypeScript only, `.ts`
 * import extensions, Node builtins only, no npm packages.
 *
 * The first word picks the command from `commands`.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
import { acceptRefusal } from "../shared/accept-guard.ts";
import {
  agentStart,
  agentStop,
  checkCommand,
  CommandMisused,
  CommandRefused,
  daemonList,
  daemonStart,
  daemonStop,
  deliverCommand,
  type CommandIo,
} from "./owner-commands.ts";
import { statsCommand, StatsRefused, StatsUsage } from "./stats-command.ts";
import { boardCommand } from "./taro-board.ts";
import { cardsOf, type TrackerCard } from "../shared/tracker-cards.ts";
import { answerCard, askCard, currentCard, finishAgent, recordAgent, waitForCard, withdrawCard } from "./tracker-cards.ts";
import { DaemonUnreachable, invokePluginRpc, RpcRefused } from "./plugin-rpc.ts";
import {
  createTicketStore,
  ID_PATTERN,
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
  /** All of standard input, for `--note -`; absent where there is none. */
  readStdin?(): Promise<string>;
  /** Where git, gh and checks run; the process's own when absent. */
  cwd?: string;
}

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_CONFLICT = 3;
const EXIT_UNREACHABLE = 4;
/** `taro card show --wait`: the card was still open when the wait ran out. */
const EXIT_WAIT_TIMED_OUT = 5;
/** `taro card show --wait`: the card was withdrawn, not answered. */
const EXIT_WITHDRAWN = 6;

const USAGE = `Usage:
  taro ticket list [-s <status>] [-l <label>] [-p <parent>] [--plain|--json]
  taro ticket view <ID> [--plain|--json]
  taro ticket search <query> [-s <status>] [--plain|--json]
  taro ticket create <title> [-d <text>] [-l <label>]... [-p <parent>] [--dep <ID>]...
                     [--priority high|medium|low] [-s <status>]
  taro ticket edit <ID> [-s <status>] [-t <title>] [-d <text>] [--plan <text>] [--final-summary <text>]
                   [--add-label <l>]... [--remove-label <l>]... [--dep <ID>]... [--remove-dep <ID>]...
                   [--priority <p>]
                   [--append-notes <text>]... [--check-ac <n>]... [--uncheck-ac <n>]...
                   [--revision <rev>] [--plain]
  taro ticket check [--json]
The buttons, from a script (they call the running daemon, with the button's own checks; --project or $TARO_PROJECT,
--home or $PASEO_HOME, --json prints the daemon's answer; \`--note -\` and \`--text -\` read standard input):
  taro ticket accept|close-round|pause|resume|relaunch-owner <ID>
  taro ticket reopen <ID> --note <text>
  taro ticket request-changes|change-spec <ID> --text <text>
  taro decision answer <key> [--label <option>] [--text <words>]
  taro decision dismiss <key>
  taro stats <ID> | --project <name> [--since <date>] [--json]   a round's time to a result: Planning to first Awaiting acceptance, Needs you before and after approval, plugin corrections
  taro next <ID>      the page for the ticket's current step, as the plugin sends it when the step starts
The owner's mechanical steps (they need $TARO_PROJECT; threads are checked first, waiting up to --wait seconds above 85%):
  taro agent start implementer|reviewer|researcher <ID> --model <id> [--thinking <id>] --brief-file <path>
                   [--task <doing what>] [--worktree] [--mode <id>] [--wait <seconds>] [--json]
  taro agent stop <agent id> [--force]   also archives a --worktree child's workspace once its branch is merged into yours
  taro check [--ticket <ID>] [--timeout <minutes>] [--again] -- <command>...   runs it and logs exit code and summary line; a pass at this commit is not rerun
  taro deliver <ID> [--evidence-from-checks]   records review-head, PR and FINAL's revision line, then Awaiting acceptance
  taro daemon start <ID> [--plugin <path>] [--home /tmp/paseo-…] [--port <n>] [--wait <seconds>] [--json]
  taro daemon stop <ID> [--home <path>]    taro daemon list <ID>
Cards and agents kept in the ticket file, for any session (in Paseo or not; nothing here starts an agent or needs the daemon):
  taro card ask <ID> [--host <name>] --file <json|->   {id, question, why, options:[{label, prompt, consequence}], recommended, reason};
                   an open card with the same id is replaced; the host defaults to external
  taro card answer <ID> <cardId> [--label <option>] [--text <words>]   also adds the ANSWER note
  taro card withdraw <ID> <cardId>
  taro card show <ID> [<cardId>] [--json] [--wait <seconds>]   with --wait: exit 0 answered, 6 withdrawn, 5 still open
  taro agent record <ID> implementer|reviewer|researcher|other --name <name> [--task <doing what>] [--host <name>]
  taro agent finish <ID> <name> --state done|failed
  taro board [--project <name>] [--json] [--watch]   tickets by status with open cards (and the command answering each) and
                   agents, and what Paseo's plugin last stored (via paseo, as of <file time>); an open card or running agent
                   older than a day reads [stale]; --watch reprints on a change until Ctrl-C; --json prints
                   {tickets:[{id,title,status,cards:[],agents:[]}], paseo:{asOf,cards:[],agents:[]}|null}
Accept, reopen, request-changes, change-spec, close-round and the decision verbs are the user's: they refuse inside the ticket's own owner and subagents.
Every command that reads a tracker finds it by --tracker <path>, else --project <name>, else $TARO_TRACKER, else $TARO_PROJECT
(a project's tracker is $PASEO_HOME/plugin-data/taro/home/projects/<name>/tracker, ~/.paseo when PASEO_HOME is unset).
-l, --dep and --remove-dep accept comma-separated lists.`;

class UsageError extends Error {}

/** No tracker found by any lookup: a usage error (exit 2) naming what was tried. */
export class TrackerNotFound extends UsageError {}

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
  "--project": { key: "project", value: true },
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
  "--remove-dep": { key: "removeDep", value: true },
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
  const removedDependencies = commaList(parsed, "removeDep");
  if (removedDependencies !== undefined) changes.removeDependencies = removedDependencies;
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
  // The agent's command only; the plugin closes a ticket on Accept through the store itself (TR-237).
  const current = (await store.view(id)).ticket;
  const refusal = acceptRefusal(current, { status: changes.status, appendNotes: changes.appendNotes ?? [] });
  if (refusal !== null) throw new UsageError(refusal);
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

/** Dependencies that are not ticket ids or name no ticket, one problem each, on the file's depends_on line. */
async function dependencyProblems(trackerPath: string, tickets: readonly TicketSummary[]): Promise<TicketProblem[]> {
  // From the file names, so a ticket that fails to parse still counts as existing; case is forgiven as the queue does.
  const known = new Set((await readdir(join(trackerPath, "tickets")).catch(() => [] as string[])).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3).toLowerCase()));
  const problems: TicketProblem[] = [];
  for (const ticket of tickets) {
    const bad = ticket.dependsOn.filter((dependency) => !known.has(dependency.toLowerCase()));
    if (bad.length === 0) continue;
    const lines = (await readFile(join(trackerPath, ticket.file), "utf8")).split("\n");
    const found = lines.findIndex((line) => line.startsWith("depends_on:"));
    for (const dependency of bad) {
      const reason = ID_PATTERN.test(dependency) ? "names no existing ticket" : "is not a ticket id";
      problems.push({ file: ticket.file, line: found + 1 || 1, message: `depends on ${JSON.stringify(dependency)}, which ${reason}` });
    }
  }
  return problems;
}

async function checkVerb({ store, trackerPath, io, parsed }: VerbContext): Promise<number> {
  expectPositionals(parsed, 0, "no arguments besides options");
  const listed = await store.list();
  const problems = [...(await trackerFileProblems(trackerPath)), ...listed.problems, ...(await dependencyProblems(trackerPath, listed.tickets))];
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


// ---------------------------------------------------------------- the buttons (TR-258)

interface ActionOptionSpec {
  /** The option holding the user's words, if the action takes any. */
  words?: "note" | "text";
  /** Whether the words are required, as the contract's `min(1)` makes them. */
  wordsRequired?: boolean;
}

interface Action {
  method: string;
  /** What the button's user alone decides (TR-237): refused to the ticket's own workers, by the daemon. */
  userOnly: boolean;
  /** `ticket` verbs name a ticket; `decision` verbs a question key. */
  subject: "ticket" | "decision";
  words?: ActionOptionSpec["words"];
  label?: boolean;
}

const ACTIONS: Record<string, Action> = {
  "ticket accept": { method: "taro.ticket.accept", userOnly: true, subject: "ticket" },
  "ticket reopen": { method: "taro.ticket.reopen", userOnly: true, subject: "ticket", words: "note" },
  "ticket request-changes": { method: "taro.ticket.request-changes", userOnly: true, subject: "ticket", words: "text" },
  "ticket change-spec": { method: "taro.ticket.change-spec", userOnly: true, subject: "ticket", words: "text" },
  "ticket close-round": { method: "taro.ticket.close-round", userOnly: true, subject: "ticket" },
  "ticket pause": { method: "taro.ticket.pause", userOnly: false, subject: "ticket" },
  "ticket resume": { method: "taro.ticket.resume", userOnly: false, subject: "ticket" },
  "ticket relaunch-owner": { method: "taro.owner.relaunch", userOnly: false, subject: "ticket" },
  "decision answer": { method: "taro.decision.answer", userOnly: true, subject: "decision", words: "text", label: true },
  "decision dismiss": { method: "taro.decision.dismiss", userOnly: true, subject: "decision" },
};

const ACTION_OPTIONS: OptionTable = {
  "--project": { key: "project", value: true },
  "--home": { key: "home", value: true },
  "--note": { key: "note", value: true },
  "--text": { key: "text", value: true },
  "--label": { key: "label", value: true },
};

/** The option's value; `-` reads standard input. */
async function wordsOf(parsed: Parsed, key: string, io: CliIo): Promise<string | undefined> {
  const value = single(parsed, key);
  if (value !== "-") return value;
  if (io.readStdin === undefined) throw new UsageError(`--${key} - needs standard input.`);
  return (await io.readStdin()).trim();
}

async function runAction(group: string, verbName: string, args: readonly string[], io: CliIo): Promise<number> {
  const action = ACTIONS[`${group} ${verbName}`] as Action;
  const parsed = parseArguments(args, ACTION_OPTIONS);
  expectPositionals(parsed, 1, action.subject === "ticket" ? "one ticket id" : "one question key");
  // The daemon refuses the ticket's own workers (it reads labels); any other session may act for the user.
  const agent = io.env.PASEO_AGENT_ID;
  const caller = action.userOnly && agent !== undefined && agent !== "" ? { caller: agent } : {};
  const subject = parsed.positionals[0] as string;
  const words = action.words === undefined ? undefined : await wordsOf(parsed, action.words, io);
  const label = action.label === true ? single(parsed, "label") : undefined;
  if (action.words !== undefined && (words === undefined || words === "") && !(action.label === true && label !== undefined)) {
    throw new UsageError(action.label === true ? "Give --label <option>, --text <words>, or both." : `${verbName} needs --${action.words} <text>.`);
  }
  const project = single(parsed, "project") ?? io.env.TARO_PROJECT;
  if (action.subject === "ticket" || action.words === undefined) {
    if (project === undefined || project === "") throw new UsageError("No project: pass --project <name> or set TARO_PROJECT.");
  }
  let input: Record<string, unknown>;
  if (action.subject === "decision" && action.label === true) input = { key: subject, label: label ?? null, text: words ?? "", ...caller };
  else if (action.subject === "decision") input = { project, key: subject, ...caller };
  else input = { project, ticket: subject, ...(action.words === undefined ? {} : { [action.words]: words }), ...caller };
  const home = single(parsed, "home") ?? io.env.PASEO_HOME ?? join(homedir(), ".paseo");
  const output = await invokePluginRpc(action.method, input, { home });
  if (has(parsed, "json")) {
    io.stdout(json(output ?? {}));
  } else {
    const message = typeof output === "object" && output !== null ? Reflect.get(output, "message") : undefined;
    io.stdout(`${typeof message === "string" && message !== "" ? message : `${verbName} done for ${subject}.`}\n`);
  }
  return EXIT_OK;
}

async function ticketCommand(args: readonly string[], io: CliIo): Promise<number> {
  const verbName = args[0];
  if (verbName !== undefined && Object.hasOwn(ACTIONS, `ticket ${verbName}`)) return runAction("ticket", verbName, args.slice(1), io);
  const verb = verbName === undefined ? undefined : TICKET_VERBS[verbName];
  if (verb === undefined || !Object.hasOwn(TICKET_VERBS, verbName as string)) {
    throw new UsageError(verbName === undefined ? "Missing ticket verb." : `Unknown ticket verb "${verbName}".`);
  }
  const parsed = parseArguments(args.slice(1), verb.options);
  const { store, trackerPath } = await openTracker(trackerArguments(parsed), io.env);
  return verb.run({ store, trackerPath, io, parsed });
}

async function decisionCommand(args: readonly string[], io: CliIo): Promise<number> {
  const verbName = args[0];
  if (verbName === undefined || !Object.hasOwn(ACTIONS, `decision ${verbName}`)) {
    throw new UsageError(verbName === undefined ? "Missing decision verb." : `Unknown decision verb "${verbName}".`);
  }
  return runAction("decision", verbName, args.slice(1), io);
}

/** The daemon's RPC for `taro next`: it reads the ticket's facts (evidence, project settings) as the plugin does. */
export const NEXT_STEP_METHOD = "taro.ticket.next-step";

/** `taro next <ID>`: the step page the plugin sends at the step's start, for an owner that missed it. */
async function nextCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArguments(args, ACTION_OPTIONS);
  expectPositionals(parsed, 1, "one ticket id");
  const project = single(parsed, "project") ?? io.env.TARO_PROJECT;
  if (project === undefined || project === "") throw new UsageError("No project: pass --project <name> or set TARO_PROJECT.");
  const ticket = parsed.positionals[0] as string;
  const home = single(parsed, "home") ?? io.env.PASEO_HOME ?? join(homedir(), ".paseo");
  const output = await invokePluginRpc(NEXT_STEP_METHOD, { project, ticket }, { home, answerTimeoutMs: 60_000 });
  if (has(parsed, "json")) {
    io.stdout(json(output ?? {}));
    return EXIT_OK;
  }
  const text = typeof output === "object" && output !== null ? Reflect.get(output, "message") : undefined;
  io.stdout(`${typeof text === "string" && text !== "" ? text : `${ticket} has no step to print.`}\n`);
  return EXIT_OK;
}

// ---------------------------------------------------------------- the owner's mechanical steps (TR-263)

function commandIo(io: CliIo): CommandIo {
  return { stdout: io.stdout, stderr: io.stderr, env: io.env, cwd: io.cwd ?? process.cwd() };
}

function nonNegativeNumber(parsed: Parsed, key: string, flag: string, fallback: number): number {
  const value = single(parsed, key);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new UsageError(`${flag} needs a whole number, not "${value}".`);
  return Number(value);
}

export interface TrackerArguments {
  tracker?: string | undefined;
  project?: string | undefined;
}

export interface OpenedTracker {
  store: TicketStore;
  trackerPath: string;
  /** The project given (--project, $TARO_PROJECT), else the one a tracker path of the plugin's layout names, else null. */
  project: string | null;
}

function given(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** The plugin's home for projects, by the rule of `server/data-dir.ts`: `$PASEO_HOME`, `~/.paseo` when unset. */
export function projectTrackerPath(project: string, env: CliIo["env"]): string {
  return join(given(env.PASEO_HOME) ?? join(homedir(), ".paseo"), "plugin-data", "taro", "home", "projects", project, "tracker");
}

/** The project a tracker kept where the plugin keeps them names (`…/projects/<name>/tracker`), else null. */
export function projectOfTrackerPath(trackerPath: string): string | null {
  const match = /(?:^|[/\\])projects[/\\]([^/\\]+)[/\\]tracker[/\\]?$/.exec(resolve(trackerPath));
  return match === null ? null : (match[1] as string);
}

function trackerArguments(parsed: Parsed): TrackerArguments {
  return { tracker: single(parsed, "tracker"), project: single(parsed, "project") };
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() === true;
}

/**
 * The one tracker lookup of every `taro` command that reads a tracker: --tracker, else --project, else
 * $TARO_TRACKER, else $TARO_PROJECT, a project's being its tracker under the plugin's home. The first one
 * given decides: a tracker path that is no directory refuses (exit 1); a project with no tracker, or nothing
 * given at all, is a usage error (exit 2) naming what was tried.
 */
export async function openTracker(args: TrackerArguments, env: CliIo["env"]): Promise<OpenedTracker> {
  const project = given(args.project) ?? given(env.TARO_PROJECT) ?? null;
  const sources: Array<{ name: string; tracker?: string | undefined; project?: string | undefined }> = [
    { name: "--tracker", tracker: given(args.tracker) },
    { name: "--project", project: given(args.project) },
    { name: "$TARO_TRACKER", tracker: given(env.TARO_TRACKER) },
    { name: "$TARO_PROJECT", project: given(env.TARO_PROJECT) },
  ];
  const chosen = sources.find((source) => source.tracker !== undefined || source.project !== undefined);
  if (chosen === undefined) {
    throw new TrackerNotFound(`No tracker: tried --tracker, --project, $TARO_TRACKER and $TARO_PROJECT, and none was given. Pass --tracker <path> or --project <name>.`);
  }
  if (chosen.tracker !== undefined) {
    if (!(await isDirectory(chosen.tracker))) throw new CommandRefused(`Tracker ${chosen.tracker} is not a directory.`);
    return { store: createTicketStore(chosen.tracker), trackerPath: chosen.tracker, project: project ?? projectOfTrackerPath(chosen.tracker) };
  }
  const trackerPath = projectTrackerPath(chosen.project as string, env);
  if (!(await isDirectory(trackerPath))) {
    throw new TrackerNotFound(`No tracker: ${chosen.name} ${chosen.project} has none at ${trackerPath}. Pass --tracker <path>, or a project the plugin has (with $PASEO_HOME if it is not ~/.paseo).`);
  }
  return { store: createTicketStore(trackerPath), trackerPath, project: chosen.project as string };
}

/** The project `taro check` and `taro deliver` keep their check log under; refused (exit 2) when there is none. */
function requiredProject(opened: OpenedTracker | null, command: string): string {
  if (opened?.project === null || opened === null) {
    throw new UsageError(`No project: taro ${command} keeps its check log per project; pass --project <name> or set TARO_PROJECT.`);
  }
  return opened.project;
}

const AGENT_OPTIONS: OptionTable = {
  "--model": { key: "model", value: true },
  "--thinking": { key: "thinking", value: true },
  "--brief-file": { key: "briefFile", value: true },
  "--task": { key: "task", value: true },
  "--mode": { key: "mode", value: true },
  "--worktree": { key: "worktree", value: false },
  "--wait": { key: "wait", value: true },
  "--force": { key: "force", value: false },
  "--name": { key: "name", value: true },
  "--host": { key: "host", value: true },
  "--state": { key: "state", value: true },
};

/** Up to ten minutes for threads to come back before starting an agent or a daemon. */
const DEFAULT_THREAD_WAIT_SECONDS = 600;

async function agentCommand(args: readonly string[], io: CliIo): Promise<number> {
  const verbName = args[0];
  const parsed = parseArguments(args.slice(1), AGENT_OPTIONS);
  if (verbName === "start") {
    expectPositionals(parsed, 2, "a job (implementer, reviewer or researcher) and a ticket id");
    const model = single(parsed, "model");
    const briefFile = single(parsed, "briefFile");
    if (model === undefined || model === "") throw new UsageError("agent start needs --model <id>.");
    if (briefFile === undefined || briefFile === "") throw new UsageError("agent start needs --brief-file <path>.");
    const { store, trackerPath } = await openTracker(trackerArguments(parsed), io.env);
    return agentStart(
      {
        role: parsed.positionals[0] as string,
        ticket: parsed.positionals[1] as string,
        model,
        thinking: single(parsed, "thinking"),
        briefFile,
        task: single(parsed, "task"),
        mode: single(parsed, "mode"),
        worktree: has(parsed, "worktree"),
        waitSeconds: nonNegativeNumber(parsed, "wait", "--wait", DEFAULT_THREAD_WAIT_SECONDS),
        json: has(parsed, "json"),
        store,
        trackerPath,
      },
      commandIo(io),
    );
  }
  if (verbName === "stop") {
    expectPositionals(parsed, 1, "one agent id");
    // The tracker shows whether `--worktree` made the agent's workspace; without one the workspace is kept.
    const tracker = await openTracker(trackerArguments(parsed), io.env).catch(() => null);
    return agentStop(parsed.positionals[0] as string, has(parsed, "force"), commandIo(io), tracker?.store ?? null);
  }
  if (verbName === "record") {
    expectPositionals(parsed, 2, "a ticket id and a job (implementer, reviewer, researcher or other)");
    const name = single(parsed, "name");
    if (name === undefined || name.trim() === "") throw new UsageError("agent record needs --name <name>, unique on the ticket.");
    const { store } = await openTracker(trackerArguments(parsed), io.env);
    const ticket = parsed.positionals[0] as string;
    const { agent } = await recordAgent(store, ticket, { name, job: parsed.positionals[1] as string, task: single(parsed, "task"), host: single(parsed, "host") });
    io.stdout(has(parsed, "json") ? json({ agent }) : `Recorded ${agent.job} ${agent.name} on ${ticket}; finish it with: taro agent finish ${ticket} ${agent.name} --state done|failed\n`);
    return EXIT_OK;
  }
  if (verbName === "finish") {
    expectPositionals(parsed, 2, "a ticket id and an agent's name");
    const state = single(parsed, "state");
    if (state === undefined || state === "") throw new UsageError("agent finish needs --state done|failed.");
    const { store } = await openTracker(trackerArguments(parsed), io.env);
    const ticket = parsed.positionals[0] as string;
    const { agent } = await finishAgent(store, ticket, { name: parsed.positionals[1] as string, state });
    io.stdout(has(parsed, "json") ? json({ agent }) : `${agent.name} on ${ticket} is ${agent.state}.\n`);
    return EXIT_OK;
  }
  throw new UsageError(verbName === undefined ? "Missing agent verb (start, stop, record, finish)." : `Unknown agent verb "${verbName}".`);
}

const CHECK_OPTIONS: OptionTable = {
  "--ticket": { key: "ticket", value: true },
  "--timeout": { key: "timeout", value: true },
  "--again": { key: "again", value: false },
};

/** A check may run long (a full test suite under load); two hours is past any the projects have. */
const DEFAULT_CHECK_TIMEOUT_MINUTES = 120;

async function checkVerbCommand(args: readonly string[], io: CliIo): Promise<number> {
  // Everything after `--` is the check, untouched; before it, only taro's options.
  const separator = args.indexOf("--");
  const own = separator === -1 ? args : args.slice(0, separator);
  const parsed = parseArguments(own, CHECK_OPTIONS);
  const words = [...parsed.positionals, ...(separator === -1 ? [] : args.slice(separator + 1))];
  const timeout = nonNegativeNumber(parsed, "timeout", "--timeout", DEFAULT_CHECK_TIMEOUT_MINUTES);
  // A check needs no tracker, only a project: given, or named by the tracker's path.
  const named = given(single(parsed, "project")) ?? given(io.env.TARO_PROJECT);
  const opened = named !== undefined ? null : await openTracker(trackerArguments(parsed), io.env).catch(() => null);
  const project = named ?? requiredProject(opened, "check");
  const projectIo = { ...commandIo(io), env: { ...io.env, TARO_PROJECT: project } };
  return checkCommand(words, { ticket: single(parsed, "ticket"), timeoutMinutes: timeout === 0 ? DEFAULT_CHECK_TIMEOUT_MINUTES : timeout, again: has(parsed, "again") }, projectIo);
}

const DELIVER_OPTIONS: OptionTable = {
  "--evidence-from-checks": { key: "evidenceFromChecks", value: false },
};

async function deliverVerbCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArguments(args, DELIVER_OPTIONS);
  expectPositionals(parsed, 1, "one ticket id");
  const opened = await openTracker(trackerArguments(parsed), io.env);
  const project = requiredProject(opened, "deliver");
  const projectIo = { ...commandIo(io), env: { ...io.env, TARO_PROJECT: project } };
  return deliverCommand({ ticket: parsed.positionals[0] as string, evidenceFromChecks: has(parsed, "evidenceFromChecks"), store: opened.store, trackerPath: opened.trackerPath }, projectIo);
}

// ---------------------------------------------------------------- cards kept in the ticket file (TR-280)

const CARD_OPTIONS: OptionTable = {
  "--host": { key: "host", value: true },
  "--file": { key: "file", value: true },
  "--label": { key: "label", value: true },
  "--text": { key: "text", value: true },
  "--wait": { key: "wait", value: true },
};

/** Who answered a tracker card from this command, in the words of a Paseo answer's note. */
const COMMAND_LINE_ANSWERER = "the user, from the command line";

function answerCommandOf(ticket: string, card: TrackerCard): string {
  return `taro card answer ${ticket} ${card.id} ${card.options.length === 0 ? "--text <words>" : "--label <option> [--text <words>]"}`;
}

function plainCard(ticket: string, card: TrackerCard): string {
  const lines = [`${card.id} [${card.status}] ${card.question}`, `  asked ${card.askedAt} from ${card.host}`];
  if (card.why !== "") lines.push(`  why: ${card.why}`);
  for (const option of card.options) {
    const details = [option.prompt === option.label ? "" : option.prompt, option.consequence].filter((part) => part !== "").join(" — ");
    lines.push(`  - ${option.label}${option.label === card.recommended ? " (recommended)" : ""}${details === "" ? "" : `: ${details}`}`);
  }
  if (card.reason !== "") lines.push(`  reason: ${card.reason}`);
  const answer = card.answer;
  if (answer !== null) {
    const given = [answer.label ?? "", answer.text === "" ? "" : `"${answer.text}"`].filter((part) => part !== "").join(" — ");
    lines.push(`  answer: ${given} (${answer.by}, ${answer.at})`);
  }
  if (card.status === "open") lines.push(`  answer with: ${answerCommandOf(ticket, card)}`);
  return `${lines.join("\n")}\n`;
}

async function cardInput(parsed: Parsed, io: CliIo): Promise<unknown> {
  const file = single(parsed, "file");
  if (file === undefined || file === "") throw new UsageError("card ask needs --file <path> (or --file - for standard input) holding the card's JSON.");
  let text: string;
  if (file === "-") {
    if (io.readStdin === undefined) throw new UsageError("--file - needs standard input.");
    text = await io.readStdin();
  } else {
    text = await readFile(file, "utf8");
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CommandRefused(`The card in ${file === "-" ? "standard input" : file} is not JSON: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

async function cardCommand(args: readonly string[], io: CliIo): Promise<number> {
  const verbName = args[0];
  const parsed = parseArguments(args.slice(1), CARD_OPTIONS);
  if (verbName === "ask") {
    expectPositionals(parsed, 1, "one ticket id");
    const card = await cardInput(parsed, io);
    const { store } = await openTracker(trackerArguments(parsed), io.env);
    const ticket = parsed.positionals[0] as string;
    const asked = await askCard(store, ticket, { card, host: given(single(parsed, "host")) });
    io.stdout(has(parsed, "json") ? json({ card: asked.card }) : `Asked ${asked.card.id} on ${ticket}; answer with: ${answerCommandOf(ticket, asked.card)}\n`);
    return EXIT_OK;
  }
  if (verbName === "answer") {
    expectPositionals(parsed, 2, "a ticket id and a card id");
    const label = single(parsed, "label") ?? null;
    const text = (await wordsOf(parsed, "text", io)) ?? "";
    if (label === null && text.trim() === "") throw new UsageError("Give --label <option>, --text <words>, or both.");
    const { store } = await openTracker(trackerArguments(parsed), io.env);
    const [ticket, cardId] = parsed.positionals as [string, string];
    const { card } = await answerCard(store, ticket, cardId, { label, text, by: COMMAND_LINE_ANSWERER });
    io.stdout(has(parsed, "json") ? json({ card }) : `Answered ${card.id} on ${ticket}.\n`);
    return EXIT_OK;
  }
  if (verbName === "withdraw") {
    expectPositionals(parsed, 2, "a ticket id and a card id");
    const { store } = await openTracker(trackerArguments(parsed), io.env);
    const [ticket, cardId] = parsed.positionals as [string, string];
    const { card } = await withdrawCard(store, ticket, cardId);
    io.stdout(has(parsed, "json") ? json({ card }) : `Withdrew ${card.id} on ${ticket}.\n`);
    return EXIT_OK;
  }
  if (verbName === "show") {
    if (parsed.positionals.length !== 1 && parsed.positionals.length !== 2) throw new UsageError("Expected a ticket id and, optionally, a card id.");
    const [ticket, cardId] = parsed.positionals as [string, string | undefined];
    const wait = single(parsed, "wait");
    if (wait !== undefined && cardId === undefined) throw new UsageError("--wait needs the card id to wait on.");
    if (wait !== undefined && !/^\d+$/.test(wait)) throw new UsageError(`--wait needs a whole number of seconds, not "${wait}".`);
    const { store } = await openTracker(trackerArguments(parsed), io.env);
    if (cardId === undefined) {
      const read = cardsOf((await store.read(ticket)).cards);
      if (has(parsed, "json")) io.stdout(json({ cards: read.items, problems: read.problems }));
      else io.stdout(read.items.length === 0 ? `${ticket} has no cards.\n` : read.items.map((card) => plainCard(ticket, card)).join("\n"));
      for (const problem of read.problems) io.stderr(`cards line ${problem.line}: ${problem.message}\n`);
      return EXIT_OK;
    }
    let card: TrackerCard;
    let timedOut = false;
    if (wait === undefined) {
      const found = await currentCard(store, ticket, cardId);
      if (found === null) throw new CommandRefused(`${ticket} has no card "${cardId}".`);
      card = found;
    } else {
      ({ card, timedOut } = await waitForCard(store, ticket, cardId, Number(wait)));
    }
    io.stdout(has(parsed, "json") ? json({ card }) : plainCard(ticket, card));
    if (wait === undefined) return EXIT_OK;
    if (timedOut) {
      io.stderr(`${card.id} on ${ticket} is still open after ${wait} s.\n`);
      return EXIT_WAIT_TIMED_OUT;
    }
    return card.status === "withdrawn" ? EXIT_WITHDRAWN : EXIT_OK;
  }
  throw new UsageError(verbName === undefined ? "Missing card verb (ask, answer, withdraw, show)." : `Unknown card verb "${verbName}".`);
}

const BOARD_OPTIONS: OptionTable = {
  "--watch": { key: "watch", value: false },
};

async function boardVerbCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArguments(args, BOARD_OPTIONS);
  expectPositionals(parsed, 0, "no arguments besides options");
  const opened = await openTracker(trackerArguments(parsed), io.env);
  const watch = has(parsed, "watch");
  const stop = new AbortController();
  const onInterrupt = () => stop.abort();
  if (watch) process.once("SIGINT", onInterrupt);
  try {
    return await boardCommand(
      { store: opened.store, trackerPath: opened.trackerPath, project: opened.project, json: has(parsed, "json"), watch, clear: watch && process.stdout.isTTY === true, signal: stop.signal },
      io,
    );
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

const DAEMON_OPTIONS: OptionTable = {
  "--home": { key: "home", value: true },
  "--port": { key: "port", value: true },
  "--plugin": { key: "plugin", value: true },
  "--wait": { key: "wait", value: true },
};

async function daemonCommand(args: readonly string[], io: CliIo): Promise<number> {
  const verbName = args[0];
  const parsed = parseArguments(args.slice(1), DAEMON_OPTIONS);
  if (verbName !== "start" && verbName !== "stop" && verbName !== "list") {
    throw new UsageError(verbName === undefined ? "Missing daemon verb (start, stop, list)." : `Unknown daemon verb "${verbName}".`);
  }
  expectPositionals(parsed, 1, "one ticket id");
  const ticket = parsed.positionals[0] as string;
  if (!ID_PATTERN.test(ticket)) throw new UsageError(`"${ticket}" is not a ticket id.`);
  if (verbName === "list") return daemonList(ticket, commandIo(io));
  if (verbName === "stop") return daemonStop({ ticket, home: single(parsed, "home") }, commandIo(io));
  const port = single(parsed, "port");
  if (port !== undefined && !/^\d+$/.test(port)) throw new UsageError(`--port needs a number, not "${port}".`);
  return daemonStart(
    {
      ticket,
      home: single(parsed, "home"),
      port: port === undefined ? undefined : Number(port),
      plugin: single(parsed, "plugin"),
      waitSeconds: nonNegativeNumber(parsed, "wait", "--wait", DEFAULT_THREAD_WAIT_SECONDS),
      json: has(parsed, "json"),
    },
    commandIo(io),
  );
}

/** The first word of the command line picks the handler. */
const commands: Record<string, (args: readonly string[], io: CliIo) => Promise<number>> = {
  ticket: ticketCommand,
  decision: decisionCommand,
  next: nextCommand,
  agent: agentCommand,
  card: cardCommand,
  board: boardVerbCommand,
  check: checkVerbCommand,
  deliver: deliverVerbCommand,
  daemon: daemonCommand,
  stats: async (args, io) => {
    try {
      return await statsCommand(args, io);
    } catch (error) {
      if (error instanceof StatsUsage) throw new UsageError(error.message);
      if (error instanceof StatsRefused) throw new CommandRefused(error.message);
      throw error;
    }
  },
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
    if (error instanceof UsageError || error instanceof CommandMisused) {
      io.stderr(`${error.message}\n${USAGE}\n`);
      return EXIT_USAGE;
    }
    if (error instanceof CommandRefused) {
      io.stderr(`${error.message}\n`);
      return EXIT_FAILURE;
    }
    if (error instanceof RevisionConflict) {
      io.stderr(`${errorMessage(error)}\n`);
      return EXIT_CONFLICT;
    }
    if (error instanceof DaemonUnreachable) {
      io.stderr(`${error.message}\n`);
      return EXIT_UNREACHABLE;
    }
    if (error instanceof RpcRefused) {
      io.stderr(`${error.message}\n`);
      return EXIT_FAILURE;
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
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
  });
}
