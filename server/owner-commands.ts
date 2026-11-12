/**
 * The owner's mechanical steps as `taro` commands: starting and archiving subagents
 * (`taro agent start|stop`), running a check into the ticket's check log (`taro check`), and the
 * delivery records (`taro deliver`). Owners wrote these by hand: a subagent started without its
 * labels was lost, and Accept refused deliveries missing a review head or a PR. Every command runs
 * through `process.ts`. Plain Node, erasable TypeScript, `.ts` imports: `bin/taro` reaches it.
 */
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { checkEvidenceLine, checkLogLine, checksAtHead, parseCheckLog, summaryLine, ticketFromBranch, type CheckEntry } from "../shared/check-log.ts";
import { isInvestigation, planDelivery, type DeliveryFacts } from "../shared/delivery-record.ts";
import { executionBranch, executionOwners } from "../shared/execution.ts";
import { commandError, runCommand, type CommandResult } from "./process.ts";
import { daemonRecordPath, startTestDaemon, stopTestDaemons, stoppedDaemonLine, readDaemonRecords } from "./test-daemons.ts";
import { waitForThreads } from "./thread-check.ts";
import type { TicketStore } from "./ticket-store.ts";

/** A refusal: its message goes to stderr and the command exits 1, having written nothing. */
export class CommandRefused extends Error {}

/** A misuse the command's usage explains: exit 2. */
export class CommandMisused extends Error {}

export interface CommandIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
  cwd: string;
}

const EXIT_OK = 0;
const EXIT_FAILURE = 1;

export const SUBAGENT_ROLES = ["implementer", "reviewer", "researcher"] as const;

/** The Paseo labels every Taro agent carries; the plugin lists, supervises and hears agents by them. */
const LABELS = { project: "taro.project", role: "taro.role", ticket: "taro.ticket" } as const;

/** Bypass mode by provider: subagents run with nobody to approve. */
const BYPASS_MODES: Record<string, string> = { claude: "bypassPermissions", codex: "full-access" };

/** A record's time as `date -u +%Y-%m-%dT%H:%MZ` prints it. */
export function recordTime(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 16)}Z`;
}

function paseoCommand(env: CommandIo["env"]): string {
  const shipped = env.PASEO_CLI?.trim();
  return shipped === undefined || shipped === "" ? "paseo" : shipped;
}

/** The plugin's data folder: `TARO_EVIDENCE` is its `evidence/<project>`; else the default home's. */
export function taroDataDirectory(env: CommandIo["env"]): string {
  const evidence = env.TARO_EVIDENCE;
  if (evidence !== undefined && evidence !== "") return resolve(evidence, "..", "..");
  return join(env.PASEO_HOME ?? join(homedir(), ".paseo"), "plugin-data", "taro");
}

function requireProject(env: CommandIo["env"]): string {
  const project = env.TARO_PROJECT;
  if (project === undefined || project === "") throw new CommandMisused("No project: set TARO_PROJECT (every Taro agent has it).");
  return project;
}

export interface ProjectSettings {
  delivery: string;
  acceptAlsoMerges: boolean;
  /** The models a subagent may run on; empty when the project names none. */
  subagentModels: string[];
}

/** The project's `taro.json`, beside its tracker; the plugin's defaults where it is missing or says nothing. */
export async function projectSettings(trackerPath: string): Promise<ProjectSettings> {
  let raw: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(await readFile(join(trackerPath, "..", "taro.json"), "utf8"));
    if (typeof value === "object" && value !== null) raw = value as Record<string, unknown>;
  } catch {
    // No settings file: the defaults.
  }
  return {
    delivery: raw.delivery === "local" ? "local" : "pull-request",
    acceptAlsoMerges: raw.acceptAlsoMerges !== false,
    subagentModels: Array.isArray(raw.subagentModels) ? raw.subagentModels.filter((model): model is string => typeof model === "string") : [],
  };
}

function git(cwd: string, args: readonly string[]): Promise<CommandResult> {
  return runCommand("git", ["-C", cwd, ...args], { timeoutMs: 30_000 }).catch((error: unknown) => ({ code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }));
}

async function gitText(cwd: string, args: readonly string[]): Promise<string | null> {
  const result = await git(cwd, args);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function currentBranch(cwd: string): Promise<string | null> {
  const branch = await gitText(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch === null || branch === "" || branch === "HEAD" ? null : branch;
}

async function threadRoom(io: CommandIo, waitSeconds: number, what: string): Promise<void> {
  const refusal = await waitForThreads({
    cgroupDirectory: io.env.TARO_CGROUP_DIRECTORY ?? "/sys/fs/cgroup",
    waitSeconds,
    pollMs: 10_000,
    what,
    log: io.stderr,
  });
  if (refusal !== null) throw new CommandRefused(refusal);
}

// ---------------------------------------------------------------- taro agent

export interface AgentStartOptions {
  role: string;
  ticket: string;
  model: string;
  thinking: string | undefined;
  briefFile: string;
  task: string | undefined;
  mode: string | undefined;
  worktree: boolean;
  waitSeconds: number;
  json: boolean;
  store: TicketStore;
  trackerPath: string;
}

/** The `paseo run` arguments for a subagent: always the three labels and the Taro environment. */
export function subagentRunArguments(options: {
  project: string;
  role: string;
  ticket: string;
  model: string;
  thinking: string | undefined;
  mode: string;
  title: string;
  env: Record<string, string>;
  worktree: { base: string } | null;
  brief: string;
}): string[] {
  const slug = options.ticket.toLowerCase();
  return [
    "run",
    "--no-wait",
    "--provider",
    options.model,
    ...(options.thinking === undefined ? [] : ["--thinking", options.thinking]),
    "--mode",
    options.mode,
    "--title",
    options.title,
    "--label",
    `${LABELS.project}=${options.project}`,
    "--label",
    `${LABELS.role}=${options.role}`,
    "--label",
    `${LABELS.ticket}=${options.ticket}`,
    ...Object.entries(options.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    ...(options.worktree === null
      ? []
      : ["--new-workspace", "worktree", "--worktree-mode", "branch-off", "--new-branch", `taro/${slug}`, "--base", options.worktree.base, "--worktree-slug", slug]),
    "--json",
    "--",
    options.brief,
  ];
}

export async function agentStart(options: AgentStartOptions, io: CommandIo): Promise<number> {
  const project = requireProject(io.env);
  if (!(SUBAGENT_ROLES as readonly string[]).includes(options.role)) throw new CommandMisused(`"${options.role}" is not a subagent's job: ${SUBAGENT_ROLES.join(", ")}.`);
  const ticket = (await options.store.read(options.ticket.toUpperCase())).id;
  const settings = await projectSettings(options.trackerPath);
  if (settings.subagentModels.length > 0 && !settings.subagentModels.includes(options.model)) {
    throw new CommandRefused(`${options.model} is not one of the project's subagent models: ${settings.subagentModels.join(", ")}.`);
  }
  const provider = options.model.split("/")[0] ?? "";
  const mode = options.mode ?? BYPASS_MODES[provider];
  if (mode === undefined) throw new CommandMisused(`No bypass mode known for provider "${provider}": pass --mode <id>.`);
  const brief = (await readFile(options.briefFile, "utf8").catch(() => {
    throw new CommandRefused(`Cannot read the brief file ${options.briefFile}.`);
  })).trim();
  if (brief === "") throw new CommandRefused(`The brief file ${options.briefFile} is empty.`);
  let worktree: { base: string } | null = null;
  if (options.worktree) {
    const base = await currentBranch(io.cwd);
    if (base === null) throw new CommandRefused(`--worktree branches from your current branch, and ${io.cwd} is on none.`);
    worktree = { base };
  }
  const environment: Record<string, string> = {};
  for (const key of ["TARO_TRACKER", "TARO_PROJECT", "TARO_SKILL"]) {
    const value = key === "TARO_TRACKER" ? options.trackerPath : io.env[key];
    if (value !== undefined && value !== "") environment[key] = value;
  }
  const title = `${ticket} · ${options.role}${options.task === undefined || options.task.trim() === "" ? "" : `: ${options.task.trim()}`}`;
  await threadRoom(io, options.waitSeconds, `the ${options.role}`);
  const args = subagentRunArguments({ project, role: options.role, ticket, model: options.model, thinking: options.thinking, mode, title, env: environment, worktree, brief });
  const result = await runCommand(paseoCommand(io.env), args, { cwd: io.cwd, timeoutMs: 180_000 });
  if (result.code !== 0) throw new CommandRefused(`paseo run failed: ${commandError(result)}`);
  let started: { agentId?: unknown; cwd?: unknown };
  try {
    started = JSON.parse(result.stdout) as { agentId?: unknown; cwd?: unknown };
  } catch {
    throw new CommandRefused(`paseo run answered something other than JSON: ${result.stdout.trim().slice(0, 200)}`);
  }
  if (typeof started.agentId !== "string" || started.agentId === "") throw new CommandRefused("paseo run named no agent id.");
  const agentId = started.agentId;
  const where = worktree !== null && typeof started.cwd === "string" ? `; own worktree ${started.cwd}` : "";
  const record = `EXECUTION ${recordTime()} — ${options.role} ${agentId} started with taro agent start: ${options.model}${options.thinking === undefined ? "" : `, thinking ${options.thinking}`}${options.task === undefined ? "" : `; ${options.task.trim()}`}${where}`;
  await options.store.edit(ticket, { appendNotes: [record] });
  io.stdout(options.json ? `${JSON.stringify({ agentId, ticket, role: options.role, title, cwd: started.cwd ?? null })}\n` : `Started ${options.role} ${agentId} on ${ticket} (${title}); recorded in EXECUTION.\n`);
  return EXIT_OK;
}

export async function agentStop(agentId: string, force: boolean, io: CommandIo): Promise<number> {
  const result = await runCommand(paseoCommand(io.env), ["archive", agentId, ...(force ? ["--force"] : [])], { timeoutMs: 60_000 });
  if (result.code !== 0) throw new CommandRefused(`paseo archive failed: ${commandError(result)}${force ? "" : " (an agent mid-turn needs --force)"}`);
  io.stdout(`Archived ${agentId}.\n`);
  return EXIT_OK;
}

// ---------------------------------------------------------------- taro check

export function checkLogPath(dataDirectory: string, project: string, ticket: string): string {
  return join(dataDirectory, "state", "check-logs", project, `${ticket.toUpperCase()}.jsonl`);
}

export async function readCheckLog(path: string): Promise<CheckEntry[]> {
  return parseCheckLog(await readFile(path, "utf8").catch(() => null));
}

export async function checkCommand(words: readonly string[], options: { ticket: string | undefined; timeoutMinutes: number }, io: CommandIo): Promise<number> {
  if (words.length === 0) throw new CommandMisused("Give the check to run after --: taro check -- npm test.");
  const project = requireProject(io.env);
  const branch = await currentBranch(io.cwd);
  const ticket = options.ticket?.toUpperCase() ?? (branch === null ? null : ticketFromBranch(branch));
  if (ticket === null) throw new CommandMisused(`Cannot tell the ticket from ${branch === null ? "a checkout on no branch" : `branch ${branch}`}: pass --ticket <ID>.`);
  const head = await gitText(io.cwd, ["rev-parse", "HEAD"]);
  const dirty = head !== null && ((await gitText(io.cwd, ["status", "--porcelain", "--untracked-files=no"])) ?? "") !== "";
  // One word with spaces is a shell line (`taro check -- "npm run a && npm test"`); several are the argv.
  const [program, args] = words.length === 1 && /\s/.test(words[0] ?? "") ? ["sh", ["-c", words[0] as string]] : [words[0] as string, words.slice(1)];
  const command = words.join(" ");
  const at = new Date().toISOString();
  let result: CommandResult;
  let exitCode: number | null;
  try {
    result = await runCommand(program, args, { cwd: io.cwd, timeoutMs: options.timeoutMinutes * 60_000 });
    exitCode = result.code;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    result = { code: null, stdout: "", stderr: `${reason}\n` };
    exitCode = /ENOENT/.test(reason) ? 127 : null;
  }
  io.stdout(result.stdout);
  io.stderr(result.stderr);
  const entry: CheckEntry = { at, command, exitCode, summary: summaryLine(result.stdout, result.stderr), head, dirty };
  const path = checkLogPath(taroDataDirectory(io.env), project, ticket);
  await mkdir(join(path, ".."), { recursive: true });
  await appendFile(path, checkLogLine(entry));
  io.stderr(`[taro] logged for ${ticket}${head === null ? "" : ` at ${head.slice(0, 10)}${dirty ? " (uncommitted changes: not offered as evidence)" : ""}`}: ${checkEvidenceLine(entry)}\n`);
  return exitCode ?? EXIT_FAILURE;
}

// ---------------------------------------------------------------- taro deliver

/** The ticket and its parents: an owner of a parent owns its children. */
function lineage(id: string): string[] {
  const ids = [id];
  let current = id;
  while (/\.\d+$/.test(current)) {
    current = current.replace(/\.\d+$/, "");
    ids.push(current);
  }
  return ids;
}

async function isOwner(store: TicketStore, ticket: string, agent: string): Promise<boolean> {
  for (const id of lineage(ticket)) {
    const notes = await store.read(id).then((found) => found.notes, () => "");
    if (executionOwners(notes).includes(agent.toLowerCase())) return true;
  }
  return false;
}

/** Reads the branch's head and, for pull-request delivery, its pull request; problems are what Accept would trip on. */
async function deliveryFacts(notes: string, delivery: string, cwd: string): Promise<{ facts: DeliveryFacts | null; problems: string[] }> {
  const problems: string[] = [];
  const checkedOut = await currentBranch(cwd);
  const branch = executionBranch(notes) ?? checkedOut;
  if (branch === null) return { facts: null, problems: [`a branch: the ticket's EXECUTION names none and ${cwd} is on none`] };
  const head = await gitText(cwd, ["rev-parse", "--verify", "--quiet", `${branch}^{commit}`]);
  if (head === null) return { facts: null, problems: [`branch ${branch} in ${cwd}: git cannot find it`] };
  if (checkedOut === branch && ((await gitText(cwd, ["status", "--porcelain", "--untracked-files=no"])) ?? "") !== "") {
    problems.push(`a clean ${branch}: ${cwd} has uncommitted changes (commit them, then deliver again)`);
  }
  if (delivery !== "pull-request") return { facts: { head, branch, pullRequest: null }, problems };
  const viewed = await runCommand("gh", ["pr", "view", branch, "--json", "url,headRefOid,state"], { cwd, timeoutMs: 60_000 }).catch((error: unknown) => ({
    code: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));
  if (viewed.code !== 0) {
    const reason = commandError(viewed);
    if (/no (?:open )?pull requests? found/i.test(reason)) {
      problems.push(`a pull request for ${branch}: push it and open one (phases/delivery.md, The branch)`);
      return { facts: { head, branch, pullRequest: null }, problems };
    }
    throw new CommandRefused(`Cannot read ${branch}'s pull request with gh (nothing was written): ${reason}`);
  }
  let pull: { url?: unknown; headRefOid?: unknown; state?: unknown };
  try {
    pull = JSON.parse(viewed.stdout) as typeof pull;
  } catch {
    throw new CommandRefused(`gh pr view answered something other than JSON (nothing was written): ${viewed.stdout.trim().slice(0, 200)}`);
  }
  const url = typeof pull.url === "string" ? pull.url : null;
  const remoteHead = typeof pull.headRefOid === "string" ? pull.headRefOid.toLowerCase() : null;
  if (url === null || remoteHead === null) throw new CommandRefused("gh pr view gave no url or headRefOid (nothing was written).");
  if (pull.state === "CLOSED") problems.push(`an open pull request: ${url} is closed`);
  if (remoteHead !== head) problems.push(`the pushed head: ${url} is at ${remoteHead.slice(0, 10)}, ${branch} at ${head.slice(0, 10)} (push, then deliver again)`);
  return { facts: { head: remoteHead, branch, pullRequest: url }, problems };
}

async function evidenceFiles(env: CommandIo["env"], project: string, ticket: string): Promise<Set<string>> {
  const folder = join(env.TARO_EVIDENCE ?? join(taroDataDirectory(env), "evidence", project), ticket);
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
}

export async function deliverCommand(options: { ticket: string; evidenceFromChecks: boolean; store: TicketStore; trackerPath: string }, io: CommandIo): Promise<number> {
  const project = requireProject(io.env);
  const agent = io.env.PASEO_AGENT_ID ?? "";
  if (agent === "") throw new CommandRefused("taro deliver is the ticket owner's: run it from the owner's session.");
  const view = await options.store.view(options.ticket.toUpperCase());
  const ticket = view.ticket;
  if (ticket.status === "Done" || ticket.status === "Cancelled") throw new CommandRefused(`${ticket.id} is ${ticket.status}: there is nothing to deliver.`);
  if (!(await isOwner(options.store, ticket.id, agent))) {
    throw new CommandRefused(`taro deliver is the owner's, and no EXECUTION record of ${ticket.id} or its parent names ${agent} as owner.`);
  }
  const settings = await projectSettings(options.trackerPath);
  const investigation = isInvestigation(ticket.labels);
  const { facts, problems } = investigation ? { facts: null, problems: [] as string[] } : await deliveryFacts(ticket.notes, settings.delivery, io.cwd);
  const head = facts?.head ?? null;
  const { offered, others } = checksAtHead(await readCheckLog(checkLogPath(taroDataDirectory(io.env), project, ticket.id)), head);
  const offeredLines = offered.map(checkEvidenceLine);
  const allProblems = [...problems];
  if (options.evidenceFromChecks && offered.length === 0) {
    allProblems.push(`a logged check${head === null ? "" : ` at ${head.slice(0, 10)}`}: run each with taro check -- <command>, then deliver again`);
  }
  const plan = planDelivery({
    ticket: { id: ticket.id, status: ticket.status, labels: ticket.labels, notes: ticket.notes, finalSummary: ticket.finalSummary },
    config: settings,
    facts,
    problems: allProblems,
    checkLines: options.evidenceFromChecks ? offeredLines : null,
    evidenceFiles: await evidenceFiles(io.env, project, ticket.id),
    at: recordTime(),
  });
  const offer =
    options.evidenceFromChecks || offeredLines.length === 0
      ? ""
      : `\nThe check log has these for ${head === null ? "the ticket" : head.slice(0, 10)}; pass --evidence-from-checks to record them as EVIDENCE check: lines:\n${offeredLines.map((line) => `  ${line}`).join("\n")}\n`;
  const stale = others === 0 ? "" : `(${others} logged run${others === 1 ? "" : "s"} at another commit or with uncommitted changes left out.)\n`;
  if (plan.missing.length > 0) {
    io.stderr(`${ticket.id} is not delivered; nothing was written. Accept would refuse it without:\n${plan.missing.map((item) => `- ${item}`).join("\n")}\n${offer}${offer === "" ? "" : stale}`);
    return EXIT_FAILURE;
  }
  if (plan.appendNotes.length === 0 && plan.finalSummary === null && !plan.setStatus) {
    io.stdout(`${ticket.id} is already delivered${head === null ? "" : ` at ${head}`}: nothing to write.\n${offer}`);
    return EXIT_OK;
  }
  await options.store.edit(
    ticket.id,
    {
      ...(plan.appendNotes.length === 0 ? {} : { appendNotes: plan.appendNotes }),
      ...(plan.finalSummary === null ? {} : { finalSummary: plan.finalSummary }),
      ...(plan.setStatus ? { status: "Awaiting acceptance" as const } : {}),
    },
    { revision: view.revision },
  );
  const wrote = [
    ...plan.appendNotes.map((record) => (record.split("\n")[0] ?? "").replace(/^(\S+)\s+\S+\s+—\s*/, "$1: ")),
    ...(plan.finalSummary === null ? [] : ["FINAL's revision line"]),
    ...(plan.setStatus ? ["status Awaiting acceptance"] : []),
  ];
  io.stdout(`Delivered ${ticket.id}${head === null ? "" : ` at ${head}`}. Wrote:\n${wrote.map((item) => `- ${item}`).join("\n")}\n${offer}`);
  return EXIT_OK;
}

// ---------------------------------------------------------------- taro daemon

function realDaemon(env: CommandIo["env"]): { userHome: string; paseoHome: string | null } {
  return { userHome: homedir(), paseoHome: env.PASEO_HOME === undefined || env.PASEO_HOME === "" ? null : resolve(env.PASEO_HOME) };
}

export async function daemonStart(options: { ticket: string; home: string | undefined; port: number | undefined; plugin: string | undefined; waitSeconds: number; json: boolean }, io: CommandIo): Promise<number> {
  const project = requireProject(io.env);
  const ticket = options.ticket.toUpperCase();
  await threadRoom(io, options.waitSeconds, "a test daemon");
  const recordPath = daemonRecordPath(taroDataDirectory(io.env), project, ticket);
  const record = await startTestDaemon({
    paseo: paseoCommand(io.env),
    recordPath,
    ticket,
    real: realDaemon(io.env),
    ...(options.home === undefined ? {} : { home: resolve(io.cwd, options.home) }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.plugin === undefined ? {} : { plugin: resolve(io.cwd, options.plugin) }),
    startedBy: io.env.PASEO_AGENT_ID ?? null,
  }).catch((error: unknown) => {
    throw new CommandRefused(error instanceof Error ? error.message : String(error));
  });
  if (options.json) {
    io.stdout(`${JSON.stringify(record)}\n`);
    return EXIT_OK;
  }
  io.stdout(
    [
      `Started a test daemon for ${ticket} (pid ${record.pid ?? "unknown"}): home ${record.home}, port ${record.port}.`,
      `  web app:  http://127.0.0.1:${record.port}/`,
      `  commands: --home ${record.home}   RPCs: TARO_DAEMON_URL=ws://127.0.0.1:${record.port}/ws`,
      `Stop it with taro daemon stop ${ticket}; the plugin stops it anyway when ${ticket} is Done or its owner is archived.`,
      ...(record.pid !== null && record.startTime === null
        ? [`Its start time could not be read (ps -o lstart= -p ${record.pid}): neither command nor plugin can tell it from a later process with that pid, so they keep it until pid ${record.pid} exits. Stop it with paseo daemon stop --home ${record.home}.`]
        : []),
      "",
    ].join("\n"),
  );
  return EXIT_OK;
}

export async function daemonStop(options: { ticket: string; home: string | undefined }, io: CommandIo): Promise<number> {
  const project = requireProject(io.env);
  const ticket = options.ticket.toUpperCase();
  const recordPath = daemonRecordPath(taroDataDirectory(io.env), project, ticket);
  const stopped = await stopTestDaemons({ paseo: paseoCommand(io.env), recordPath, ...(options.home === undefined ? {} : { home: resolve(io.cwd, options.home) }) });
  if (stopped.length === 0) {
    io.stdout(`${ticket} has no recorded test daemon${options.home === undefined ? "" : ` at ${options.home}`}.\n`);
    return EXIT_OK;
  }
  for (const each of stopped) {
    const line = stoppedDaemonLine(ticket, each);
    io.stdout(`${line.charAt(0).toUpperCase()}${line.slice(1)}.\n`);
  }
  return EXIT_OK;
}

export async function daemonList(ticket: string, io: CommandIo): Promise<number> {
  const project = requireProject(io.env);
  const records = await readDaemonRecords(daemonRecordPath(taroDataDirectory(io.env), project, ticket.toUpperCase()));
  io.stdout(records.length === 0 ? `${ticket.toUpperCase()} has no recorded test daemon.\n` : `${records.map((record) => `${record.home} port ${record.port} pid ${record.pid ?? "unknown"} since ${record.startedAt}`).join("\n")}\n`);
  return EXIT_OK;
}
