export type PastAgentRole = "owner" | "helper" | "reviewer";

export interface PastAgent {
  id: string;
  role: PastAgentRole;
  archivedAt: string;
}

const PAST_ROLES: ReadonlySet<string> = new Set(["owner", "helper", "reviewer"]);

/** A ticket's archived owners, helpers and reviewers, newest first; the caller picks the owner it wants. */
export function pastTicketAgents(
  agents: readonly { id: string; role: string; archivedAt: string | null | undefined; updatedAt: string }[],
): PastAgent[] {
  return agents
    .flatMap((agent) =>
      agent.archivedAt !== null && agent.archivedAt !== undefined && PAST_ROLES.has(agent.role)
        ? [{ agent, role: agent.role as PastAgentRole, archivedAt: agent.archivedAt }]
        : [],
    )
    .sort((left, right) => right.agent.updatedAt.localeCompare(left.agent.updatedAt))
    .map(({ agent, role, archivedAt }) => ({ id: agent.id, role, archivedAt }));
}
