/**
 * Scoring a finished run: the hidden tests, the stats of the ticket, the records on it and the
 * decider's questions, all into `result.json`. The parsers are pure; `runHidden` runs the task's test
 * command in a copy of the merged repository. Runs under Node type stripping.
 */
import { createReadStream, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { firstRequestTokens as requestTokens } from "../shared/agent-trim.ts";
import { conformanceViolations, type ConformanceViolation } from "../shared/conformance.ts";
import { run } from "./process.ts";
import { SCRATCH_PREFIX, assertSafeHome } from "./safety.ts";

export interface HiddenScore {
  passed: number;
  total: number;
}

/** `node --test` output: the summary's `tests N` and `pass N`. Null when no summary is there (the runner did not start). */
export function parseNodeTest(output: string): HiddenScore | null {
  const total = /^[ℹ#]\s*tests\s+(\d+)/m.exec(output)?.[1];
  const passed = /^[ℹ#]\s*pass\s+(\d+)/m.exec(output)?.[1];
  if (total === undefined || passed === undefined) return null;
  return { passed: Number(passed), total: Number(total) };
}

/**
 * `python -m unittest` output (on stderr): `Ran N tests`, then `OK` or `FAILED (failures=F, errors=E)`.
 * Passed is the total less failures and errors (a task's tests must not use `subTest`: each failing sub-test counts again). Null when no summary is there or nothing ran.
 */
export function parseUnittest(output: string): HiddenScore | null {
  const total = /^Ran (\d+) tests? in /m.exec(output)?.[1];
  if (total === undefined || Number(total) === 0) return null;
  const count = (name: string): number => Number(new RegExp(`\\b${name}=(\\d+)`).exec(/^FAILED \(.*\)$/m.exec(output)?.[0] ?? "")?.[1] ?? 0);
  return { passed: Math.max(0, Number(total) - count("failures") - count("errors")), total: Number(total) };
}

/**
 * `python -m pytest` output: the last summary line, such as `8 failed, 177 passed, 2 skipped in 3.2s`
 * (quiet, or between `=` rules when verbose). Skipped tests count as run and not failed. Null when
 * only a traceback printed (pytest missing, a crash before collection) or nothing ran.
 */
export function parsePytest(output: string): HiddenScore | null {
  const summaries = output.split("\n").filter((line) => /^=*\s*(?:\d+ [a-z]+(?:, | ))+in [\d.]+s\b/.test(line));
  const summary = summaries[summaries.length - 1];
  if (summary === undefined) return null;
  const count = (name: string): number => Number(new RegExp(`(\\d+) ${name}\\b`).exec(summary)?.[1] ?? 0);
  const failed = count("failed") + count("errors?");
  const total = count("passed") + failed + count("skipped") + count("xfailed") + count("xpassed");
  return total === 0 ? null : { passed: total - failed, total };
}

/** The score of whichever runner's output this is. */
export function parseTestOutput(output: string): HiddenScore | null {
  return parseNodeTest(output) ?? parseUnittest(output) ?? parsePytest(output);
}

export const PLANTED_TOTAL = 8;

export interface PlantedScore {
  caught: number;
  total: number;
}

/**
 * Planted defects caught, from a verbose pytest run: a defect is caught when its `test_planted_N_*`
 * test PASSED on the owner's merged main. Null when the output names no planted test (the task has
 * none, the suite is missing, or the runner never got to run it).
 */
export function parsePlanted(output: string): PlantedScore | null {
  const outcomes = new Map<number, boolean>();
  output.split("\n").forEach((line) => {
    const match = /test_planted_(\d+)_\S*\s+(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\b/.exec(line);
    if (match === null) return;
    const number = Number(match[1]);
    if (number < 1 || number > PLANTED_TOTAL) return;
    outcomes.set(number, (outcomes.get(number) ?? true) && match[2] === "PASSED");
  });
  if (outcomes.size === 0) return null;
  return { caught: [...outcomes.values()].filter(Boolean).length, total: PLANTED_TOTAL };
}

/** The test-only packages a task lists in `hidden/requirements.txt` (one per line, `#` comments). */
export function hiddenRequirements(taskDirectory: string): string[] {
  const file = join(taskDirectory, "hidden", "requirements.txt");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")) : [];
}

export interface ScoreTools {
  run: typeof run;
  makeDirectory: () => string;
  remove: (path: string) => void;
}

const defaultTools: ScoreTools = {
  run,
  makeDirectory: () => mkdtempSync(join(tmpdir(), `${SCRATCH_PREFIX}pytest.`)),
  remove: (path) => rmSync(path, { recursive: true, force: true }),
};

/**
 * Runs a task's test command in `cwd`. A command that uses `$PYTEST_PATH` gets a pytest installed
 * into a folder of its own for the call (`pip install --target`, as this host has neither uv nor
 * venv), and the folder is removed afterwards, whatever happened. `extraPackages` go into the same install.
 */
export async function runTestCommand(command: string, cwd: string, tools: ScoreTools = defaultTools, extraPackages: readonly string[] = []): Promise<{ output: string }> {
  if (!command.includes("PYTEST_PATH")) {
    const result = await tools.run("sh", ["-c", command], { cwd, timeoutMs: 300_000 });
    return { output: `${result.stdout}\n${result.stderr}` };
  }
  const target = tools.makeDirectory();
  assertSafeHome(target);
  try {
    const installed = await tools.run("python3", ["-m", "pip", "install", "-q", "--target", target, "pytest", ...extraPackages], { timeoutMs: 300_000 });
    if (installed.code !== 0) return { output: `pytest install failed (exit ${installed.code}): ${installed.stderr}` };
    const result = await tools.run("sh", ["-c", command], { cwd, env: { PYTEST_PATH: target }, timeoutMs: 300_000 });
    return { output: `${result.stdout}\n${result.stderr}` };
  } finally {
    tools.remove(target);
  }
}

export interface AgentStatsLike {
  agentId: string;
  role: string;
  model: string | null;
  turns: number;
  activeMs: number;
  costUsd: number | null;
  contextTokens: number | null;
  startingContextTokens?: number | null;
}

export interface TicketStatsLike {
  transitions: { from: string | null; to: string; at: string }[];
  agents: Record<string, AgentStatsLike>;
  nudges: number;
  decisions: number;
  recoveries: number;
}

export interface RoleScore {
  agents: number;
  models: string[];
  costUsd: number;
  /** The largest context any agent of the role reached. */
  peakContextTokens: number;
  turns: number;
  activeMs: number;
}

export interface StatsScore {
  costUsd: number;
  byRole: Record<string, RoleScore>;
  timePerStatusMs: Record<string, number>;
  decisions: number;
  nudges: number;
  recoveries: number;
}

/** A ticket's stats as the result reports them. A child's agents count with the parent's, so the sum is the run's cost. */
export function scoreStats(stats: TicketStatsLike, now: Date): StatsScore {
  const byRole: Record<string, RoleScore> = {};
  let costUsd = 0;
  Object.values(stats.agents).forEach((agent) => {
    const role = byRole[agent.role] ?? { agents: 0, models: [], costUsd: 0, peakContextTokens: 0, turns: 0, activeMs: 0 };
    role.agents += 1;
    if (agent.model !== null && !role.models.includes(agent.model)) role.models.push(agent.model);
    role.costUsd += agent.costUsd ?? 0;
    role.peakContextTokens = Math.max(role.peakContextTokens, agent.contextTokens ?? 0);
    role.turns += agent.turns;
    role.activeMs += agent.activeMs;
    costUsd += agent.costUsd ?? 0;
    byRole[agent.role] = role;
  });
  const timePerStatusMs: Record<string, number> = {};
  stats.transitions.forEach((transition, index) => {
    const end = stats.transitions[index + 1]?.at ?? now.toISOString();
    const span = Date.parse(end) - Date.parse(transition.at);
    if (Number.isFinite(span) && span >= 0) timePerStatusMs[transition.to] = (timePerStatusMs[transition.to] ?? 0) + span;
  });
  return { costUsd, byRole, timePerStatusMs, decisions: stats.decisions, nudges: stats.nudges, recoveries: stats.recoveries };
}

export interface RecordCounts {
  RISKS: number;
  RULING: number;
  EVIDENCE: number;
  FINAL: number;
}

/** How many of the records the workflow cares about the ticket holds (RISKS and RULING arrive with the branch; main has none). */
export function countRecords(ticketText: string): RecordCounts {
  const counts: RecordCounts = { RISKS: 0, RULING: 0, EVIDENCE: 0, FINAL: 0 };
  const notes = /<!-- taro:notes -->\n([\s\S]*?)\n<!-- \/taro:notes -->/.exec(ticketText)?.[1] ?? "";
  notes.split(/\n(?=[A-Z][A-Z-]{2,}\b)/).forEach((record) => {
    const name = /^([A-Z][A-Z-]{2,})\b/.exec(record.trim())?.[1];
    if (name === "RISKS" || name === "RULING" || name === "EVIDENCE") counts[name] += 1;
  });
  const final = /<!-- taro:final-summary -->\n([\s\S]*?)<!-- \/taro:final-summary -->/.exec(ticketText)?.[1] ?? "";
  if (final.trim() !== "") counts.FINAL = 1;
  return counts;
}

export type DeciderEvent =
  | { type: "prompt"; at: string; kind: string; id: string; text: string }
  | { type: "answer"; at: string; kind: string; id: string; via: "ui" | "rpc"; choice: string; text: string; preference: string; briefAnswered: boolean }
  | { type: "violation"; at: string; kind: string; detail: string }
  | { type: "permission"; at: string; tool: string; detail: string; decision: "allow" | "deny"; via: "ui" };

export interface QuestionScore {
  asked: number;
  preferenceHits: number;
  redundant: number;
}

/** The decider's log (one JSON object per line): questions are the answers to question cards, not plan or acceptance cards. */
export function scoreQuestions(log: string): QuestionScore {
  const score: QuestionScore = { asked: 0, preferenceHits: 0, redundant: 0 };
  log.split("\n").forEach((line) => {
    if (line.trim() === "") return;
    let event: DeciderEvent;
    try {
      event = JSON.parse(line) as DeciderEvent;
    } catch {
      return;
    }
    if (event.type !== "answer" || event.kind !== "question") return;
    score.asked += 1;
    if (/^P\d+/i.test(event.preference.trim())) score.preferenceHits += 1;
    if (event.briefAnswered) score.redundant += 1;
  });
  return score;
}

export const DEFAULT_USER_MINUTES_PER_CARD = 30;

export interface CardScore {
  /** Cards other than the plan and Accept the user answered after the first Approve of the round. */
  cardsAfterApproval: number;
  /** Every card answered (the plan each time, each question card once, Accept), at the minutes each takes the user. */
  userMinutesModelled: number;
  /** Hidden preferences the decider's answers touched, each counted once, on the side of its first answer. */
  preferences: { beforeApproval: number; afterApproval: number };
}

const isApprove = (choice: string): boolean => /^\W*approve\b/i.test(choice.trim());

/**
 * What the cards cost the user, from the decider's log. The approval is the first plan answer that
 * approves (a Request changes before it leaves the round open); when the log holds none, the ticket's
 * first APPROVAL record stands in. With no approval at all every answer counts as before it.
 * An answer with no usable time counts as before the approval.
 */
export function scoreCards(log: string, ticketText: string, userMinutesPerCard: number = DEFAULT_USER_MINUTES_PER_CARD): CardScore {
  const answers: Extract<DeciderEvent, { type: "answer" }>[] = [];
  log.split("\n").forEach((line) => {
    if (line.trim() === "") return;
    try {
      const event = JSON.parse(line) as DeciderEvent;
      if (event.type === "answer") answers.push(event);
    } catch {
      // not a record line
    }
  });
  const loggedApproval = answers.find((answer) => answer.kind === "plan" && isApprove(answer.choice))?.at;
  const notes = /<!-- taro:notes -->\n([\s\S]*?)\n<!-- \/taro:notes -->/.exec(ticketText)?.[1] ?? "";
  const approvalAt = loggedApproval ?? /^APPROVAL (\S+) — /m.exec(notes)?.[1];
  const approvedMs = approvalAt === undefined ? Number.NaN : Date.parse(approvalAt);
  const after = (answer: { at: string }): boolean => Number.isFinite(approvedMs) && Date.parse(answer.at) > approvedMs;

  const afterCards = new Set<string>();
  const questionCards = new Set<string>();
  let otherCards = 0;
  const seenPreferences = new Set<string>();
  const preferences = { beforeApproval: 0, afterApproval: 0 };
  answers.forEach((answer) => {
    const card = answer.id.split("#")[0] ?? answer.id;
    if (answer.kind === "question") {
      questionCards.add(card);
      if (after(answer)) afterCards.add(card);
    } else {
      otherCards += 1;
    }
    (answer.preference.match(/\bP\d+\b/gi) ?? []).forEach((tag) => {
      const key = tag.toUpperCase();
      if (seenPreferences.has(key)) return;
      seenPreferences.add(key);
      preferences[after(answer) ? "afterApproval" : "beforeApproval"] += 1;
    });
  });
  return { cardsAfterApproval: afterCards.size, userMinutesModelled: (questionCards.size + otherCards) * userMinutesPerCard, preferences };
}

/** The permission asks the decider answered as the user: how many, and how many it denied. */
export function countPermissions(log: string): { asked: number; denied: number } {
  const counts = { asked: 0, denied: 0 };
  log.split("\n").forEach((line) => {
    try {
      const event = JSON.parse(line) as DeciderEvent;
      if (event.type !== "permission") return;
      counts.asked += 1;
      if (event.decision === "deny") counts.denied += 1;
    } catch {
      // not a record line
    }
  });
  return counts;
}

/** The violations the decider logged: a card it could not find, text on a card that is wrong. */
export function loggedViolations(log: string): ConformanceViolation[] {
  const found: ConformanceViolation[] = [];
  log.split("\n").forEach((line) => {
    try {
      const event = JSON.parse(line) as DeciderEvent;
      if (event.type === "violation") found.push({ kind: event.kind, detail: event.detail });
    } catch {
      // not a record line
    }
  });
  return found;
}

export function conformanceOf(ticketText: string, nudges: number, transitions: TicketStatsLike["transitions"]): ConformanceViolation[] {
  return conformanceViolations(ticketText, { nudges, transitions });
}

/** The largest request in a Claude transcript (sidechains skipped), or null when it holds none: the context the agent really reached. */
export function peakContextOf(transcript: string): number | null {
  let peak: number | null = null;
  transcript.split("\n").forEach((line) => {
    const tokens = requestTokens(line);
    if (tokens !== null && (peak === null || tokens > peak)) peak = tokens;
  });
  return peak;
}

/** The Claude session id in an agent record the daemon stores (`persistence.sessionId`), or null; `paseo inspect` does not carry it. */
export function storedSessionIdOf(agentRecord: string): string | null {
  try {
    const persistence = (JSON.parse(agentRecord) as { persistence?: { provider?: unknown; sessionId?: unknown } | null }).persistence;
    return persistence?.provider === "claude" && typeof persistence.sessionId === "string" && persistence.sessionId !== "" ? persistence.sessionId : null;
  } catch {
    return null;
  }
}

/** The stored record of an agent in a daemon home: `<home>/agents/<cwd slug>/<agentId>.json`. Only the throwaway home is ever passed. */
export function storedAgentRecord(daemonHome: string, agentId: string): string | null {
  if (!/^[A-Za-z0-9-]+$/.test(agentId)) return null;
  const agents = join(daemonHome, "agents");
  if (!existsSync(agents)) return null;
  const folder = readdirSync(agents).find((name) => existsSync(join(agents, name, `${agentId}.json`)));
  return folder === undefined ? null : readFileSync(join(agents, folder, `${agentId}.json`), "utf8");
}

/** The peak context of a Claude session from its transcript under Claude Code's config folder (the one the daemon's agents write to: it and the daemon both inherit this process's environment); null when the transcript is not found. */
export async function peakContextOfSession(sessionId: string, configDirectory = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")): Promise<number | null> {
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return null;
  const projects = join(configDirectory, "projects");
  const folder = existsSync(projects) ? readdirSync(projects).find((name) => existsSync(join(projects, name, `${sessionId}.jsonl`))) : undefined;
  if (folder === undefined) return null;
  // Streamed: an owner's transcript can pass a hundred megabytes.
  const lines = createInterface({ input: createReadStream(join(projects, folder, `${sessionId}.jsonl`), { encoding: "utf8" }), crlfDelay: Infinity });
  let peak: number | null = null;
  for await (const line of lines) {
    const tokens = requestTokens(line);
    if (tokens !== null && (peak === null || tokens > peak)) peak = tokens;
  }
  return peak;
}

/** Copies the merged repository, adds the task's hidden tests and runs its test command there. `planted` is set only when the output names the planted-defect tests. */
export async function runHidden(mergedRepository: string, taskDirectory: string): Promise<{ score: HiddenScore | null; planted: PlantedScore | null; output: string }> {
  const copy = mkdtempSync(join(tmpdir(), `${SCRATCH_PREFIX}hidden.`));
  assertSafeHome(copy);
  try {
    // main as merged, not the working tree: a git archive of it.
    const archived = await run("sh", ["-c", 'git -C "$1" archive main | tar -x -C "$2"', "sh", mergedRepository, copy]);
    if (archived.code !== 0) return { score: null, planted: null, output: `git archive failed: ${archived.stderr}` };
    // The hidden tests go where the task says (`hiddenInto` in task.json), else into `hidden/`.
    const hiddenInto = (JSON.parse(readFileSync(join(taskDirectory, "task.json"), "utf8")) as { hiddenInto?: string }).hiddenInto ?? "hidden";
    const hidden = join(taskDirectory, "hidden");
    if (existsSync(hidden)) cpSync(hidden, join(copy, hiddenInto), { recursive: true });
    const { output } = await runTestCommand(readFileSync(join(taskDirectory, "test-command"), "utf8").trim(), copy, undefined, hiddenRequirements(taskDirectory));
    return { score: parseTestOutput(output), planted: parsePlanted(output), output };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
