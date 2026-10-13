/**
 * Which agents a ticket's pane can show: the live owner, its live subagents, then
 * the ticket's archived agents, so a finished ticket still shows the work its
 * agents did rather than "no owner".
 */
import type { AgentBrief, Card } from "../shared/contracts";

export type PaneAgentRole = "owner" | "helper" | "reviewer";

export interface PaneAgent {
  id: string;
  label: string;
  role: PaneAgentRole;
  live: boolean;
  brief: AgentBrief;
}

const SHORT_ID_LENGTH = 8;

/** What an agent is called on screen: by its job, never "helper" (the user's wording). */
export function paneAgentJob(role: PaneAgentRole): string {
  return role === "owner" ? "owner" : role === "helper" ? "implementer" : "reviewer";
}

/** The task part of a title like `TR-016 · helper: board panels`, without the ticket and the role. */
export function taskOfTitle(title: string | null): string {
  return (title ?? "")
    .trim()
    .replace(/^[A-Z][A-Z0-9]*-\d+(?:\.\d+)*\s*·\s*/, "")
    .replace(/^(?:helper|reviewer|implementer|subagent)\s*:\s*/i, "")
    .trim();
}

/** The first owner listed (live, else the newest archived) is the owner; any other was replaced by it. */
function labelFor(role: PaneAgentRole, firstOwner: boolean, brief: AgentBrief): string {
  if (role === "owner") return firstOwner ? "Owner" : "Owner (earlier)";
  const job = paneAgentJob(role);
  const task = taskOfTitle(brief.title);
  return `${job.charAt(0).toUpperCase()}${job.slice(1)} · ${task === "" ? brief.id.slice(0, SHORT_ID_LENGTH) : task}`;
}

export function paneAgents(card: Pick<Card, "owner" | "helpers" | "pastAgents">): PaneAgent[] {
  const candidates: { role: PaneAgentRole; live: boolean; brief: AgentBrief }[] = [
    ...(card.owner === null ? [] : [{ role: "owner" as const, live: true, brief: card.owner }]),
    ...card.helpers.map((brief) => ({ role: "helper" as const, live: true, brief })),
    ...card.pastAgents.map(({ role, archivedAt: _archivedAt, ...brief }) => ({ role, live: false, brief })),
  ];
  // The board can list a just-archived agent both live and archived; the first (live) entry wins.
  const seen = new Set<string>();
  let ownerLabelled = false;
  return candidates.flatMap((candidate) => {
    if (seen.has(candidate.brief.id)) return [];
    seen.add(candidate.brief.id);
    const firstOwner = candidate.role === "owner" && !ownerLabelled;
    if (firstOwner) ownerLabelled = true;
    return [{ id: candidate.brief.id, label: labelFor(candidate.role, firstOwner, candidate.brief), ...candidate }];
  });
}

/** The live owner, else the newest archived owner (archived agents come newest first), else null. */
export function defaultPaneAgent(list: readonly PaneAgent[]): PaneAgent | null {
  return list.find((agent) => agent.role === "owner" && agent.live) ?? list.find((agent) => agent.role === "owner") ?? null;
}
