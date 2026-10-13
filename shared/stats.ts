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
  };
}
