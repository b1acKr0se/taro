/** Finding Taro's agents in Paseo, by label or id. */
import { TARO_LABELS, type Role } from "../shared/project";
import type { PaseoAgent, PaseoApi } from "./host-types";

export async function listTaroAgents(paseo: PaseoApi, labels: Readonly<Record<string, string>>): Promise<PaseoAgent[]> {
  const agents: PaseoAgent[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const result: Awaited<ReturnType<PaseoApi["agents"]["list"]>> = await paseo.agents.list({
      filter: { labels: { ...labels } },
      page: cursor === null ? { limit: 200 } : { limit: 200, cursor },
    });
    for (const entry of result.entries) agents.push(entry.agent);
    if (!result.pageInfo.hasMore || result.pageInfo.nextCursor === null) break;
    cursor = result.pageInfo.nextCursor;
  }
  return agents.filter((agent) => agent.archivedAt === null || agent.archivedAt === undefined);
}

export async function projectAgents(paseo: PaseoApi, project: string, role?: Role): Promise<PaseoAgent[]> {
  return listTaroAgents(paseo, { [TARO_LABELS.project]: project, ...(role === undefined ? {} : { [TARO_LABELS.role]: role }) });
}

/** The live agent with this id, or null when Paseo has none (or it is archived). */
export async function fetchLiveAgent(paseo: PaseoApi, agentId: string): Promise<PaseoAgent | null> {
  if (agentId === "") return null;
  try {
    const refreshed = await paseo.agents.ref(agentId).refresh();
    if (refreshed === null) return null;
    const agent = refreshed.agent;
    if (agent.archivedAt !== null && agent.archivedAt !== undefined) return null;
    return agent;
  } catch {
    return null;
  }
}

export function isMidTurn(agent: { status: string }): boolean {
  return agent.status === "running" || agent.status === "initializing";
}
