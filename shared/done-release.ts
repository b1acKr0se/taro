/**
 * Which agents and workspaces a Done ticket releases (TR-024). An owner usually sets Done and then
 * finishes its last message, so the tracker commit often finds it mid-turn: such an agent waits and
 * is released when its turn ends, instead of being skipped for good.
 */
import { TARO_LABELS } from "./project";

export interface ReleaseAgent {
  id: string;
  labels: Readonly<Record<string, string>>;
  workspaceId?: string | null | undefined;
}

export interface ReleasePlan<A extends ReleaseAgent> {
  /** Idle agents to archive now, each with the Done ticket that releases it. */
  archive: { agent: A; ticket: string }[];
  /** Agents of Done tickets still mid-turn; released when their turn ends. */
  waiting: A[];
  /** Workspaces to archive once `archive` is done. */
  workspaces: string[];
}

/** The outermost Done ticket an agent's ticket label belongs to (itself or a parent), or null. */
export function doneTicketOf(label: string | undefined, doneTickets: ReadonlySet<string>): string | null {
  if (label === undefined || label === "") return null;
  const parts = label.split(".");
  for (let length = 1; length <= parts.length; length++) {
    const candidate = parts.slice(0, length).join(".");
    if (doneTickets.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Splits a project's live agents by whether a Done ticket releases them now. A workspace is
 * archived only when it held an owner of a Done ticket (now or earlier: `archivedOwnerWorkspaces`),
 * is not the manager's, and no live agent stays in it.
 */
export function planRelease<A extends ReleaseAgent>(
  doneTickets: ReadonlySet<string>,
  agents: readonly A[],
  options: { isMidTurn: (agent: A) => boolean; managerWorkspaceId: string; archivedOwnerWorkspaces: ReadonlySet<string> },
): ReleasePlan<A> {
  const archive: { agent: A; ticket: string }[] = [];
  const waiting: A[] = [];
  for (const agent of agents) {
    const ticket = doneTicketOf(agent.labels[TARO_LABELS.ticket], doneTickets);
    if (ticket === null) continue;
    if (options.isMidTurn(agent)) waiting.push(agent);
    else archive.push({ agent, ticket });
  }
  const archived = new Set(archive.map((entry) => entry.agent.id));
  const staying = new Set(agents.filter((agent) => !archived.has(agent.id)).flatMap((agent) => (agent.workspaceId ? [agent.workspaceId] : [])));
  const workspaces = new Set<string>();
  for (const { agent } of archive) {
    const workspaceId = agent.workspaceId;
    if (!workspaceId || workspaceId === options.managerWorkspaceId || staying.has(workspaceId)) continue;
    if (agent.labels[TARO_LABELS.role] === "owner" || options.archivedOwnerWorkspaces.has(workspaceId)) workspaces.add(workspaceId);
  }
  return { archive, waiting, workspaces: [...workspaces] };
}
