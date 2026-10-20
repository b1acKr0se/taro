/**
 * Scoring a finished run: the hidden tests, the stats of the ticket, the records on it and the
 * decider's questions, all into `result.json`. The parsers are pure; `runHidden` runs the task's test
 * command in a copy of the merged repository. Runs under Node type stripping.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** The score of whichever runner's output this is. */
export function parseTestOutput(output: string): HiddenScore | null {
  return parseNodeTest(output) ?? parseUnittest(output);
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

export function conformanceOf(ticketText: string, nudges: number, handsOff: boolean, transitions: TicketStatsLike["transitions"]): ConformanceViolation[] {
  return conformanceViolations(ticketText, { nudges, handsOff, transitions });
}

/** Copies the merged repository, adds the task's hidden tests and runs its test command there. */
export async function runHidden(mergedRepository: string, taskDirectory: string): Promise<{ score: HiddenScore | null; output: string }> {
  const copy = mkdtempSync(join(tmpdir(), `${SCRATCH_PREFIX}hidden.`));
  assertSafeHome(copy);
  try {
    // main as merged, not the working tree: a git archive of it.
    const archived = await run("sh", ["-c", 'git -C "$1" archive main | tar -x -C "$2"', "sh", mergedRepository, copy]);
    if (archived.code !== 0) return { score: null, output: `git archive failed: ${archived.stderr}` };
    // The hidden tests go where the task says (`hiddenInto` in task.json), else into `hidden/`.
    const hiddenInto = (JSON.parse(readFileSync(join(taskDirectory, "task.json"), "utf8")) as { hiddenInto?: string }).hiddenInto ?? "hidden";
    const hidden = join(taskDirectory, "hidden");
    if (existsSync(hidden)) cpSync(hidden, join(copy, hiddenInto), { recursive: true });
    const command = readFileSync(join(taskDirectory, "test-command"), "utf8").trim();
    const result = await run("sh", ["-c", command], { cwd: copy, timeoutMs: 300_000 });
    const output = `${result.stdout}\n${result.stderr}`;
    return { score: parseTestOutput(output), output };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
