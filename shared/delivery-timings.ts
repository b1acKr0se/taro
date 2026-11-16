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
  /** When each nudge was sent; nudges recorded before times were kept have none. */
  nudgedAt?: readonly string[] | undefined;
  /** Permission asks no rule answered, each from asked to ended, in any order. */
  permissionWaits?: readonly { start: string; end: string }[] | undefined;
}

/** What the plugin did to hold an owner to the plan-and-approval order, counted from the round's records. */
export interface PluginCorrections {
  noPlan: number;
  noApproval: number;
  /** A question or a plan approval the plugin did not show (asked again after approval, several on one card, blocking with no default). */
  held: number;
  /** A blocking question shown not blocking after approval. */
  madeNonBlocking: number;
  /** Nudges sent within the round, plus those recorded before nudge times were kept (`untimedNudges`), which cannot be placed. */
  nudges: number;
  untimedNudges: number;
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
  /**
   * Cards the user answered (the plugin's ANSWER records) after the round's first approval and before
   * its first Awaiting acceptance (or now); a scope approval answered again counts, as the user was needed.
   */
  cardsAnsweredAfterApproval: number;
  corrections: PluginCorrections;
  /** Time permission asks no rule answered stayed open within the round, overlapping asks (a child's on its parent) once. */
  permissionWaitMs: number;
}

/** The plugin's record of a card the user answered; an owner's own ANSWER copy does not end this way. */
const ANSWERED_CARD = /^ANSWER (\S+) — [^:\n]+:[\s\S]*\(the user, from [^)\n]*\)$/;
const NO_PLAN = /^NO-PLAN \S+ —/;
const NO_APPROVAL = /^NO-APPROVAL \S+ —/;
const APPROVAL_REPEATED = /^APPROVAL-REPEATED \S+ —/;
const BLOCKING_AFTER_APPROVAL = /^BLOCKING-AFTER-APPROVAL \S+ —/;

/** The notes split into timestamped records, so a user's multi-line answer stays one record even where a line of it starts with a capitalised word. */
function timedRecords(notes: string | null): string[] {
  return (notes ?? "").split(/\n(?=[A-Z][A-Z-]{2,} \d{4}-\d{2}-\d{2}T)/).map((record) => record.trim()).filter((record) => record !== "");
}

function roundLines(notes: string | null): string[] {
  return (notes ?? "").split("\n").map((line) => line.trim());
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

  // The round's first Planning, and the first Awaiting acceptance after it (after the reopen, for a ticket that never planned).
  const planning = facts.transitions.find((transition) => transition.to === "Planning" && (reopenedAt === null || Date.parse(transition.at) >= reopenedAt));
  const planningMs = planning === undefined ? null : Date.parse(planning.at);
  const roundStart = planningMs ?? reopenedAt ?? -Infinity;
  const awaiting = facts.transitions.find((transition) => transition.to === "Awaiting acceptance" && Date.parse(transition.at) >= roundStart);
  const awaitingMs = awaiting === undefined ? null : Date.parse(awaiting.at);
  const roundEnd = awaitingMs ?? now;

  const approved = planAnswerRecords(rounds).find((record) => record.kind === "approved");
  const approvedMs = approved === undefined ? null : Date.parse(approved.at);
  const stretchesOf = (list: readonly { start: string; end: string }[]): [number, number][] =>
    list.map((stretch): [number, number] => [Date.parse(stretch.start), Date.parse(stretch.end)]).filter(([start, end]) => !Number.isNaN(start) && !Number.isNaN(end));
  const clipped = (stretches: readonly (readonly [number, number])[], from: number, to: number) => unionLength(stretches.map(([start, end]): [number, number] => [Math.max(start, from), Math.min(end, to)]));

  let before = 0;
  let after = 0;
  if (planningMs !== null) {
    const split = approvedMs === null || Number.isNaN(approvedMs) ? roundEnd : Math.min(Math.max(approvedMs, planningMs), roundEnd);
    const stretches = stretchesOf(facts.waiting);
    before = clipped(stretches, planningMs, split);
    after = clipped(stretches, split, roundEnd);
  }

  const cards = approvedMs === null || Number.isNaN(approvedMs) ? 0 : timedRecords(rounds).filter((record) => {
    const answer = ANSWERED_CARD.exec(record);
    const at = Date.parse(answer?.[1] ?? "");
    return answer !== null && at > approvedMs && at < roundEnd;
  }).length;

  const inRound = (at: string): boolean => {
    const time = Date.parse(at);
    return time >= roundStart && time <= roundEnd;
  };
  const nudgedAt = facts.nudgedAt ?? [];
  const untimedNudges = Math.max(0, (facts.nudges ?? 0) - nudgedAt.length);

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
      nudges: nudgedAt.filter(inRound).length + untimedNudges,
      untimedNudges,
    },
    permissionWaitMs: clipped(stretchesOf(facts.permissionWaits ?? []), roundStart, roundEnd),
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
