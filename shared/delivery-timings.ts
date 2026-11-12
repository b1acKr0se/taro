/**
 * How long a ticket's round took to a result, and what held it up (TR-263): derived from what is
 * recorded, the status transitions and Needs-you stretches in the stats and the records in the
 * ticket's notes. Time to a finished result is the measure, so the wall clock runs from Planning to
 * the round's first Awaiting acceptance, and the time the user was asked something is split at the
 * round's approval. Pure and free of packages, with `.ts` import extensions, so the `taro` command
 * (plain `node`) can run it; `shared/stats.ts` re-exports it.
 */
import { planAnswerRecords } from "./approval-gate.ts";
import { currentRound, roundNotes } from "./reopen.ts";

export interface TimingTransition {
  to: string;
  at: string;
}

/** What a ticket's timings are read from; every count may be absent in a stats file written before it was recorded. */
export interface TimingFacts {
  notes: string | null;
  transitions: readonly TimingTransition[];
  /** Needs-you stretches (`start`, `end`), in any order. */
  waiting: readonly { start: string; end: string }[];
  nudges?: number | undefined;
  /** Time permission asks nobody's rules answered stayed open. */
  permissionWaitMs?: number | undefined;
}

/** What the plugin did to hold an owner to the plan-and-approval order, counted from the round's records. */
export interface PluginCorrections {
  noPlan: number;
  noApproval: number;
  /** A question or a plan approval the plugin did not show (asked again after approval, several on one card, blocking with no default). */
  held: number;
  /** A blocking question shown not blocking after approval. */
  madeNonBlocking: number;
  nudges: number;
}

export interface DeliveryTimings {
  /** The round's first Planning; null for a ticket that never planned (a trivial or low one) or is not yet there. */
  planningAt: string | null;
  /** Planning to the first Awaiting acceptance after it; null while the round has not reached it. */
  planningToAwaitingMs: number | null;
  /** The round's approval (an Approve answer or an APPROVAL record); null with none. */
  approvedAt: string | null;
  /** Time on Needs you from Planning to the first Awaiting acceptance (or now), before and after the approval; with no approval all of it is before. */
  needsYouBeforeApprovalMs: number;
  needsYouAfterApprovalMs: number;
  /** Cards other than the scope approval answered after the round's approval. */
  cardsAnsweredAfterApproval: number;
  corrections: PluginCorrections;
  permissionWaitMs: number;
}

const ANSWERED_CARD = /^ANSWER (\S+) — ([^:]+):/;
const NO_PLAN = /^NO-PLAN \S+ —/;
const NO_APPROVAL = /^NO-APPROVAL \S+ —/;
const APPROVAL_REPEATED = /^APPROVAL-REPEATED \S+ —/;
const BLOCKING_AFTER_APPROVAL = /^BLOCKING-AFTER-APPROVAL \S+ —/;

function roundLines(notes: string | null): string[] {
  return (notes ?? "").split("\n").map((line) => line.trim());
}

/** The length of the part of [start, end] that lies within [from, to]. */
function overlapMs(start: number, end: number, from: number, to: number): number {
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}

/** The length of the union of intervals, so overlapping stretches (a child's repeated on its parent) count once. */
function unionLength(intervals: ReadonlyArray<readonly [number, number]>): number {
  const sorted = intervals.filter(([start, end]) => end > start).sort((left, right) => left[0] - right[0]);
  let total = 0;
  let reach = -Infinity;
  for (const [start, end] of sorted) {
    if (end <= reach) continue;
    total += end - Math.max(start, reach);
    reach = end;
  }
  return total;
}

export function deliveryTimings(facts: TimingFacts, now: number = Date.now()): DeliveryTimings {
  const rounds = roundNotes(facts.notes);
  const reopenedAt = reopenTime(facts.notes);
  const lines = roundLines(rounds);

  // The round's first Planning, and the first Awaiting acceptance after it.
  const planning = facts.transitions.find((transition) => transition.to === "Planning" && (reopenedAt === null || Date.parse(transition.at) >= reopenedAt));
  const planningMs = planning === undefined ? null : Date.parse(planning.at);
  const awaiting = planningMs === null ? undefined : facts.transitions.find((transition) => transition.to === "Awaiting acceptance" && Date.parse(transition.at) >= planningMs);
  const awaitingMs = awaiting === undefined ? null : Date.parse(awaiting.at);

  const approved = planAnswerRecords(rounds).find((record) => record.kind === "approved");
  const approvedMs = approved === undefined ? null : Date.parse(approved.at);

  let before = 0;
  let after = 0;
  if (planningMs !== null) {
    const windowEnd = awaitingMs ?? now;
    const split = approvedMs === null || Number.isNaN(approvedMs) ? windowEnd : Math.min(Math.max(approvedMs, planningMs), windowEnd);
    const stretches = facts.waiting.map((stretch): [number, number] => [Date.parse(stretch.start), Date.parse(stretch.end)]).filter(([start, end]) => !Number.isNaN(start) && !Number.isNaN(end));
    before = unionLength(stretches.map(([start, end]): [number, number] => [Math.max(start, planningMs), Math.min(end, split)]));
    after = unionLength(stretches.map(([start, end]): [number, number] => [Math.max(start, split), Math.min(end, windowEnd)]));
  }

  const cards = approvedMs === null ? 0 : lines.filter((line) => {
    const answer = ANSWERED_CARD.exec(line);
    return answer !== null && answer[2] !== "scope-approval" && Date.parse(answer[1] ?? "") > approvedMs;
  }).length;

  const count = (pattern: RegExp, keep: (line: string) => boolean = () => true) => lines.filter((line) => pattern.test(line) && keep(line)).length;
  return {
    planningAt: planning?.at ?? null,
    planningToAwaitingMs: planningMs === null || awaitingMs === null ? null : Math.max(0, awaitingMs - planningMs),
    approvedAt: approved?.at ?? null,
    needsYouBeforeApprovalMs: before,
    needsYouAfterApprovalMs: after,
    cardsAnsweredAfterApproval: cards,
    corrections: {
      noPlan: count(NO_PLAN),
      noApproval: count(NO_APPROVAL),
      held: count(APPROVAL_REPEATED) + count(BLOCKING_AFTER_APPROVAL, (line) => !line.includes("shown not blocking")),
      madeNonBlocking: count(BLOCKING_AFTER_APPROVAL, (line) => line.includes("shown not blocking")),
      nudges: facts.nudges ?? 0,
    },
    permissionWaitMs: facts.permissionWaitMs ?? 0,
  };
}

/** When the latest REOPENED record was written; null with none. */
function reopenTime(notes: string | null): number | null {
  const round = currentRound(notes);
  const match = /^REOPENED (\S+)/.exec(round ?? "");
  if (match === null) return null;
  const at = Date.parse(match[1] ?? "");
  return Number.isNaN(at) ? null : at;
}

export interface Spread {
  count: number;
  median: number;
  p90: number;
}

/** Median and 90th percentile (nearest rank) of the values; null with none. */
export function spreadOf(values: readonly number[]): Spread | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] as number;
  const middle = sorted.length / 2;
  const median = sorted.length % 2 === 1 ? (sorted[Math.floor(middle)] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return { count: sorted.length, median, p90: at(0.9) };
}
