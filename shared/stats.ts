/**
 * What the plugin measures per ticket, so the workflow can be judged and sped
 * up: status transitions with times, every agent turn's duration, and each
 * agent's cost when the ticket finishes. Pure summary logic lives here too.
 */
import { z } from "zod";

export const TransitionSchema = z.object({ from: z.string().nullable(), to: z.string(), at: z.string() });

export const AgentStatsSchema = z.object({
  agentId: z.string(),
  role: z.string(),
  model: z.string().nullable(),
  title: z.string().nullable(),
  turns: z.number().int().default(0),
  activeMs: z.number().default(0),
  costUsd: z.number().nullable().default(null),
  contextTokens: z.number().nullable().default(null),
});
export type AgentStats = z.infer<typeof AgentStatsSchema>;

export const TicketStatsSchema = z.object({
  project: z.string(),
  ticket: z.string(),
  title: z.string().default(""),
  transitions: z.array(TransitionSchema).default([]),
  agents: z.record(z.string(), AgentStatsSchema).default({}),
  nudges: z.number().int().default(0),
  decisions: z.number().int().default(0),
  /** Automatic recoveries of this ticket's agents from a crash (TR-012). */
  recoveries: z.number().int().default(0),
});
export type TicketStats = z.infer<typeof TicketStatsSchema>;

export interface TicketSummary {
  project: string;
  ticket: string;
  title: string;
  status: string;
  /** First seen → Done (or now). */
  wallMs: number;
  /** Time spent in each status. */
  byStatus: Record<string, number>;
  /** Time the user held things up: Awaiting acceptance plus Planning while a decision waited. */
  waitingOnUserMs: number;
  /** Sum of all agents' turn durations. */
  agentActiveMs: number;
  turns: number;
  agents: number;
  costUsd: number | null;
  nudges: number;
  decisions: number;
  recoveries: number;
}

export function summarize(stats: TicketStats, now: number = Date.now()): TicketSummary {
  const byStatus: Record<string, number> = {};
  const transitions = stats.transitions;
  for (let i = 0; i < transitions.length; i++) {
    const current = transitions[i];
    if (current === undefined) continue;
    const next = transitions[i + 1];
    const end = next === undefined ? (current.to === "Done" || current.to === "Cancelled" ? Date.parse(current.at) : now) : Date.parse(next.at);
    byStatus[current.to] = (byStatus[current.to] ?? 0) + Math.max(0, end - Date.parse(current.at));
  }
  const first = transitions[0];
  const last = transitions[transitions.length - 1];
  const finished = last !== undefined && (last.to === "Done" || last.to === "Cancelled");
  const wallMs = first === undefined ? 0 : (finished ? Date.parse(last.at) : now) - Date.parse(first.at);
  const agents = Object.values(stats.agents);
  const costs = agents.map((agent) => agent.costUsd).filter((cost): cost is number => cost !== null);
  return {
    project: stats.project,
    ticket: stats.ticket,
    title: stats.title,
    status: last?.to ?? "?",
    wallMs,
    byStatus,
    waitingOnUserMs: byStatus["Awaiting acceptance"] ?? 0,
    agentActiveMs: agents.reduce((total, agent) => total + agent.activeMs, 0),
    turns: agents.reduce((total, agent) => total + agent.turns, 0),
    agents: agents.length,
    costUsd: costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0),
    nudges: stats.nudges,
    decisions: stats.decisions,
    recoveries: stats.recoveries,
  };
}

export interface ProjectTotals {
  tickets: number;
  wallMs: number;
  waitingOnUserMs: number;
  agentActiveMs: number;
  turns: number;
  agents: number;
  costUsd: number | null;
  nudges: number;
  decisions: number;
  recoveries: number;
}

/** A child ticket (`TR-3.1`) whose parent is `TR-3`, or null. */
export function parentOf(ticket: string): string | null {
  return /^(.*)\.\d+$/.exec(ticket)?.[1] ?? null;
}

/**
 * A project's totals. A child's agents, turns and cost are recorded on its
 * parent too (see `server/stats.ts`), and its time falls inside the parent's,
 * so those add up top-level tickets only; nudges, decisions and recoveries are recorded on
 * one ticket each, so they add up every ticket.
 */
export function projectTotals(summaries: readonly TicketSummary[]): ProjectTotals {
  const topLevel = summaries.filter((summary) => parentOf(summary.ticket) === null);
  const costs = topLevel.map((summary) => summary.costUsd).filter((cost): cost is number => cost !== null);
  const sum = (list: readonly TicketSummary[], pick: (summary: TicketSummary) => number) => list.reduce((total, summary) => total + pick(summary), 0);
  return {
    tickets: summaries.length,
    wallMs: sum(topLevel, (summary) => summary.wallMs),
    waitingOnUserMs: sum(topLevel, (summary) => summary.waitingOnUserMs),
    agentActiveMs: sum(topLevel, (summary) => summary.agentActiveMs),
    turns: sum(topLevel, (summary) => summary.turns),
    agents: sum(topLevel, (summary) => summary.agents),
    costUsd: costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0),
    nudges: sum(summaries, (summary) => summary.nudges),
    decisions: sum(summaries, (summary) => summary.decisions),
    recoveries: sum(summaries, (summary) => summary.recoveries),
  };
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
