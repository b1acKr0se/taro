import { roleFromLabel, type SubagentRole } from "./project";

export type PastAgentRole = "owner" | SubagentRole;

export interface PastAgent {
  id: string;
  role: PastAgentRole;
  archivedAt: string;
}

function pastRole(label: string): PastAgentRole | null {
  const role = roleFromLabel(label);
  return role === null || role === "manager" ? null : role;
}

/** A ticket's archived owner and subagents, newest first; the caller picks the owner it wants. */
export function pastTicketAgents(
  agents: readonly { id: string; role: string; archivedAt: string | null | undefined; updatedAt: string }[],
): PastAgent[] {
  return agents
    .flatMap((agent) => {
      const role = pastRole(agent.role);
      return agent.archivedAt !== null && agent.archivedAt !== undefined && role !== null ? [{ agent, role, archivedAt: agent.archivedAt }] : [];
    })
    .sort((left, right) => right.agent.updatedAt.localeCompare(left.agent.updatedAt))
    .map(({ agent, role, archivedAt }) => ({ id: agent.id, role, archivedAt }));
}
