/** Recording agents' cost beyond the turn end (TR-097): at archive, and the one-time backfill of past agents. */
import { TARO_LABELS } from "../shared/project";
import { listTaroAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { sessionCost } from "./session-cost";
import { usageReading, type CostBackfill, type Stats } from "./stats";

/** An archived agent's last usage, in case its last turn end missed it; Paseo may still hold it in memory. */
export async function recordArchivedUsage(paseo: PaseoApi, stats: Stats, agentId: string): Promise<void> {
  const refreshed = await paseo.agents.ref(agentId).refresh();
  const agent = refreshed?.agent;
  const project = agent?.labels[TARO_LABELS.project];
  const ticket = agent?.labels[TARO_LABELS.ticket];
  if (agent === undefined || project === undefined || ticket === undefined) return;
  await stats.agentUsage(project, ticket, agent.id, usageReading(agent.lastUsage));
}

/** Fills past agents' missing costs from their transcripts, once; null when it had already run. */
export async function backfillCosts(paseo: PaseoApi, stats: Stats, projects: readonly string[]): Promise<CostBackfill | null> {
  const agents = new Map<string, PaseoAgent>();
  for (const project of projects) {
    for (const agent of await listTaroAgents(paseo, { [TARO_LABELS.project]: project }, { includeArchived: true })) agents.set(agent.id, agent);
  }
  return stats.backfillCosts(async (agentId) => {
    const agent = agents.get(agentId);
    return agent === undefined ? null : sessionCost(agent);
  });
}
