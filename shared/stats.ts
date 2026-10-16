/**
 * What the plugin measures per ticket, so the workflow can be judged and sped
 * up: status transitions with times, every agent turn's duration, and each
 * agent's cost as of its latest turn end (TR-097). Pure summary logic lives here too.
 */
import { z } from "zod";

export const TransitionSchema = z.object({ from: z.string().nullable(), to: z.string(), at: z.string() });
export type Transition = z.infer<typeof TransitionSchema>;

/**
 * A stretch of time the ticket's card sat in Needs you (TR-100), as the Needs-you check saw it:
 * `end` is the last check that still found it there.
 */
export const WaitingSchema = z.object({ start: z.string(), end: z.string() });
export type Waiting = z.infer<typeof WaitingSchema>;

export const AgentStatsSchema = z.object({
  agentId: z.string(),
  role: z.string(),
  model: z.string().nullable(),
  title: z.string().nullable(),
  turns: z.number().int().default(0),
  activeMs: z.number().default(0),
  costUsd: z.number().nullable().default(null),
  contextTokens: z.number().nullable().default(null),
  /** The context window `contextTokens` was out of (TR-156): an archived agent's chat draws its meter from the pair. */
  contextMaxTokens: z.number().nullable().default(null),
  /** A trimmed agent's first request, from its transcript (TR-139): what it started with. */
  startingContextTokens: z.number().nullable().default(null),
});
export type AgentStats = z.infer<typeof AgentStatsSchema>;

export const TicketStatsSchema = z.object({
  project: z.string(),
  ticket: z.string(),
  title: z.string().default(""),
  transitions: z.array(TransitionSchema).default([]),
  /** Recorded from TR-100 on; earlier tickets' waiting is their Awaiting acceptance time only. */
  waiting: z.array(WaitingSchema).default([]),
  agents: z.record(z.string(), AgentStatsSchema).default({}),
  nudges: z.number().int().default(0),
  decisions: z.number().int().default(0),
  /** Automatic recoveries of this ticket's agents from a crash (TR-012). */
  recoveries: z.number().int().default(0),
  /** Owners compacted after an hour idle (TR-015). */
  idleCompactions: z.number().int().default(0),
  /** Shell permission asks the plugin denied by its rules (TR-143): commands that broke shell.md. */
  permissionDenials: z.number().int().default(0),
});
export type TicketStats = z.infer<typeof TicketStatsSchema>;

/** What the plugin counts per project rather than per ticket: the manager has no ticket. */
export const ProjectStatsSchema = z.object({
  /** The manager compacted after an hour idle (TR-015). */
  idleCompactions: z.number().int().default(0),
});
export type ProjectStats = z.infer<typeof ProjectStatsSchema>;

export interface TicketSummary {
  project: string;
  ticket: string;
  title: string;
  status: string;
  /** First seen → Done (or now). */
  wallMs: number;
  /** When the ticket was first seen, and when it finished (null while open): the project's span is built from these. */
  startedAt: number | null;
  finishedAt: number | null;
  /** Time spent in each status. */
  byStatus: Record<string, number>;
  /** Time the card waited on the user: Awaiting acceptance, and Needs you (a blocking decision, a permission, Blocked), counted once. */
  waitingOnUserMs: number;
  /** Sum of all agents' turn durations. */
  agentActiveMs: number;
  turns: number;
  agents: number;
  costUsd: number | null;
  /** Agents whose cost is unknown: their session ended without saving one, so `costUsd` is short of theirs. */
  agentsWithoutCost: number;
  nudges: number;
  decisions: number;
  recoveries: number;
  idleCompactions: number;
  permissionDenials: number;
}

/**
 * Transitions without those into the status the ticket already had: a status announced again (a
 * tracker conversion, a retried wake-up) is not a change and must not move the ticket's end (TR-100).
 */
export function withoutRepeats(transitions: readonly Transition[]): Transition[] {
  const kept: Transition[] = [];
  for (const transition of transitions) {
    if (kept[kept.length - 1]?.to !== transition.to) kept.push(transition);
  }
  return kept;
}

/** The tickets whose cards wait on the user: the board's Needs you column (TR-100). */
export function waitingTickets(cards: ReadonlyArray<{ id: string; column: string }>): string[] {
  return cards.filter((card) => card.column === "needs-you").map((card) => card.id);
}

/** The length of the union of intervals, so overlapping ones count once. */
export function unionMs(intervals: ReadonlyArray<readonly [number, number]>): number {
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

function finishes(status: string): boolean {
  return status === "Done" || status === "Cancelled";
}

export function summarize(stats: TicketStats, now: number = Date.now()): TicketSummary {
  const byStatus: Record<string, number> = {};
  const awaiting: [number, number][] = [];
  const transitions = withoutRepeats(stats.transitions);
  for (let i = 0; i < transitions.length; i++) {
    const current = transitions[i];
    if (current === undefined) continue;
    const next = transitions[i + 1];
    const start = Date.parse(current.at);
    const end = next === undefined ? (finishes(current.to) ? start : now) : Date.parse(next.at);
    byStatus[current.to] = (byStatus[current.to] ?? 0) + Math.max(0, end - start);
    if (current.to === "Awaiting acceptance") awaiting.push([start, end]);
  }
  const first = transitions[0];
  const last = transitions[transitions.length - 1];
  const startedAt = first === undefined ? null : Date.parse(first.at);
  const finishedAt = last !== undefined && finishes(last.to) ? Date.parse(last.at) : null;
  const wallMs = startedAt === null ? 0 : (finishedAt ?? now) - startedAt;
  const waiting = stats.waiting.map((stretch): [number, number] => [Date.parse(stretch.start), Date.parse(stretch.end)]);
  const agents = Object.values(stats.agents);
  const costs = agents.map((agent) => agent.costUsd).filter((cost): cost is number => cost !== null);
  return {
    project: stats.project,
    ticket: stats.ticket,
    title: stats.title,
    status: last?.to ?? "?",
    wallMs,
    startedAt,
    finishedAt,
    byStatus,
    waitingOnUserMs: unionMs([...awaiting, ...waiting]),
    agentActiveMs: agents.reduce((total, agent) => total + agent.activeMs, 0),
    turns: agents.reduce((total, agent) => total + agent.turns, 0),
    agents: agents.length,
    costUsd: costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0),
    agentsWithoutCost: agents.length - costs.length,
    nudges: stats.nudges,
    decisions: stats.decisions,
    recoveries: stats.recoveries,
    idleCompactions: stats.idleCompactions,
    permissionDenials: stats.permissionDenials,
  };
}

export interface ProjectTotals {
  tickets: number;
  /** The project's elapsed time: the first ticket seen to the last finished, or now while one is open. */
  wallMs: number;
  waitingOnUserMs: number;
  agentActiveMs: number;
  turns: number;
  agents: number;
  costUsd: number | null;
  agentsWithoutCost: number;
  nudges: number;
  decisions: number;
  recoveries: number;
  idleCompactions: number;
  permissionDenials: number;
}

/** A child ticket (`TR-3.1`) whose parent is `TR-3`, or null. */
export function parentOf(ticket: string): string | null {
  return /^(.*)\.\d+$/.exec(ticket)?.[1] ?? null;
}

/**
 * A project's totals. Wall is the project's span, not a sum: tickets run side by side (TR-100).
 * A child's agents, turns, cost and waiting are recorded on its
 * parent too (see `server/stats.ts`), and its time falls inside the parent's,
 * so those add up top-level tickets only; nudges, decisions, recoveries and idle compactions are
 * recorded on one ticket each, so they add up every ticket, plus the manager's idle compactions.
 */
export function projectTotals(summaries: readonly TicketSummary[], managerIdleCompactions: number = 0, now: number = Date.now()): ProjectTotals {
  const topLevel = summaries.filter((summary) => parentOf(summary.ticket) === null);
  const costs = topLevel.map((summary) => summary.costUsd).filter((cost): cost is number => cost !== null);
  const sum = (list: readonly TicketSummary[], pick: (summary: TicketSummary) => number) => list.reduce((total, summary) => total + pick(summary), 0);
  return {
    tickets: summaries.length,
    wallMs: projectSpanMs(summaries, now),
    waitingOnUserMs: sum(topLevel, (summary) => summary.waitingOnUserMs),
    agentActiveMs: sum(topLevel, (summary) => summary.agentActiveMs),
    turns: sum(topLevel, (summary) => summary.turns),
    agents: sum(topLevel, (summary) => summary.agents),
    costUsd: costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0),
    agentsWithoutCost: sum(topLevel, (summary) => summary.agentsWithoutCost),
    nudges: sum(summaries, (summary) => summary.nudges),
    decisions: sum(summaries, (summary) => summary.decisions),
    recoveries: sum(summaries, (summary) => summary.recoveries),
    idleCompactions: managerIdleCompactions + sum(summaries, (summary) => summary.idleCompactions),
    permissionDenials: sum(summaries, (summary) => summary.permissionDenials),
  };
}

/** First ticket seen → last finished, or now while any ticket is open; 0 with no ticket seen. */
export function projectSpanMs(summaries: readonly TicketSummary[], now: number = Date.now()): number {
  const seen = summaries.filter((summary) => summary.startedAt !== null);
  if (seen.length === 0) return 0;
  const start = Math.min(...seen.map((summary) => summary.startedAt ?? now));
  const end = seen.some((summary) => summary.finishedAt === null) ? now : Math.max(...seen.map((summary) => summary.finishedAt ?? now));
  return Math.max(0, end - start);
}

/** Tickets by id, newest first, children after their parent: `TR-10`, `TR-9`, `TR-9.1`, `TR-9.2`. */
export function compareTickets(left: string, right: string): number {
  const parts = (id: string) => (id.match(/\d+/g) ?? []).map(Number);
  const leftParts = parts(left);
  const rightParts = parts(right);
  const top = (rightParts[0] ?? 0) - (leftParts[0] ?? 0);
  if (top !== 0) return top;
  for (let i = 1; i < Math.max(leftParts.length, rightParts.length); i++) {
    const difference = (leftParts[i] ?? -1) - (rightParts[i] ?? -1);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}
