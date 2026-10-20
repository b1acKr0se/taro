/**
 * Which agents a ticket's pane can show: the owner, its live subagents, then the
 * ticket's archived agents, so a finished ticket still shows the work its agents
 * did rather than "no owner".
 */
import type { AgentBrief, Card } from "../shared/contracts";
import type { SubagentRole } from "../shared/project";
import { formatDuration } from "./format";

export type PaneAgentRole = "owner" | SubagentRole;

export interface PaneAgent {
  id: string;
  label: string;
  role: PaneAgentRole;
  live: boolean;
  brief: AgentBrief;
  /** When it was archived; null while it is live. */
  archivedAt: string | null;
}

const SHORT_ID_LENGTH = 8;

/** What an agent is called on screen: by its job (TR-017). */
/**
 * The shown agent's status for the pane's header (TR-201): what its chat follows, which sees a turn
 * start or end before the board's next poll; the board's for an agent whose chat has not said yet.
 */
export function paneStatus(shown: { id: string; live: boolean; brief: { status: string } }, chatStatus: { agentId: string; status: string } | null): string {
  if (!shown.live) return "archived";
  return chatStatus?.agentId === shown.id ? chatStatus.status : shown.brief.status;
}

export function paneAgentJob(role: PaneAgentRole): string {
  return role;
}

/** The Lucide icon for an agent's job; an archived owner is no longer the one in charge. */
export function roleIcon(agent: Pick<PaneAgent, "role" | "live">): string {
  if (agent.role === "owner") return agent.live ? "Crown" : "UserRound";
  if (agent.role === "implementer") return "Wrench";
  return agent.role === "researcher" ? "Search" : "ShieldCheck";
}

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** "Implementer building the board columns": the job, then the task in the words of its title. */
function doingText(role: PaneAgentRole, task: string): string {
  return `${capitalised(paneAgentJob(role))} ${task.charAt(0).toLowerCase()}${task.slice(1)}`;
}

/** The task part of a title like `TR-016 · implementer: board panels`, without the ticket and the role (titles from before TR-017 say `helper`). */
export function taskOfTitle(title: string | null): string {
  return (title ?? "")
    .trim()
    .replace(/^[A-Z][A-Z0-9]*-\d+(?:\.\d+)*\s*·\s*/, "")
    .replace(/^(?:implementer|reviewer|researcher|subagent|helper)\s*:\s*/i, "")
    .trim();
}

/** A replaced owner's name: "Previous owner", numbered by start when the ticket had several (TR-162). */
function previousOwnerLabel(number: number, count: number): string {
  return count === 1 ? "Previous owner" : `Previous owner ${number}`;
}

function subagentLabel(role: PaneAgentRole, brief: AgentBrief): string {
  const task = taskOfTitle(brief.title);
  return task === "" ? `${capitalised(paneAgentJob(role))} · ${brief.id.slice(0, SHORT_ID_LENGTH)}` : doingText(role, task);
}

/** When an agent started, for numbering previous owners; an unknown start counts as its archive time. */
function startedAt(agent: { brief: AgentBrief; archivedAt?: string }): string {
  return agent.brief.createdAt ?? agent.archivedAt ?? "";
}

/**
 * The owner first (live, else the newest archived) on every ticket (TR-162): a live reviewer or a
 * subagent archived after the owner came before it once no owner was live. Then the live subagents,
 * then the other archived agents newest first, replaced owners among them.
 */
export function paneAgents(card: Pick<Card, "owner" | "subagents" | "pastAgents">): PaneAgent[] {
  const listed: { role: PaneAgentRole; live: boolean; brief: AgentBrief; archivedAt?: string }[] = [
    ...(card.owner === null ? [] : [{ role: "owner" as const, live: true, brief: card.owner }]),
    ...card.subagents.map(({ role, ...brief }) => ({ role, live: true, brief })),
    ...card.pastAgents.map(({ role, archivedAt, ...brief }) => ({ role, live: false, brief, archivedAt })),
  ];
  // The board can list a just-archived agent both live and archived; the first (live) entry wins.
  const seen = new Set<string>();
  const candidates = listed.filter((candidate) => {
    if (seen.has(candidate.brief.id)) return false;
    seen.add(candidate.brief.id);
    return true;
  });
  const owner = candidates.find((candidate) => candidate.role === "owner");
  const previousOwners = candidates
    .filter((candidate) => candidate.role === "owner" && candidate !== owner)
    .map((candidate, archiveIndex) => ({ candidate, archiveIndex }))
    // Oldest start first; archived agents come newest first, so a tie falls back to the archive order reversed.
    .sort((left, right) => startedAt(left.candidate).localeCompare(startedAt(right.candidate)) || right.archiveIndex - left.archiveIndex)
    .map(({ candidate }) => candidate);
  const ordered = owner === undefined ? candidates : [owner, ...candidates.filter((candidate) => candidate !== owner)];
  return ordered.map((candidate) => ({
    id: candidate.brief.id,
    label:
      candidate === owner
        ? "Owner"
        : candidate.role === "owner"
          ? previousOwnerLabel(previousOwners.indexOf(candidate) + 1, previousOwners.length)
          : subagentLabel(candidate.role, candidate.brief),
    role: candidate.role,
    live: candidate.live,
    brief: candidate.brief,
    archivedAt: candidate.archivedAt ?? null,
  }));
}

/** The live owner, else the newest archived owner (archived agents come newest first), else null. */
export function defaultPaneAgent(list: readonly PaneAgent[]): PaneAgent | null {
  return list.find((agent) => agent.role === "owner" && agent.live) ?? list.find((agent) => agent.role === "owner") ?? null;
}

/** The agent a ticket's pane opens on: the one asking permission, where Allow and Deny are (TR-096), else the owner. */
export function openingPaneAgent(list: readonly PaneAgent[], askerId: string | null): PaneAgent | null {
  return list.find((agent) => agent.live && agent.id === askerId) ?? defaultPaneAgent(list);
}

/** One opening of a ticket's pane (its card or Review tapped) and the agent asking permission then. */
export interface PaneOpening {
  key: string;
  asker: string | null;
}

/**
 * The opening the pane keeps (TR-096): a new one at each tap, even on the ticket already open, takes
 * the agent asking at that moment; within one, answering does not move the chat away from it.
 */
export function paneOpening(previous: PaneOpening | null, key: string, askerId: string | null): PaneOpening {
  return previous !== null && previous.key === key ? previous : { key, asker: askerId };
}

/**
 * What another of the ticket's agents asks while one is shown, to open it from the chat: its
 * permission first, which holds it up (TR-096), else its question.
 */
export function askedElsewhere(
  card: Pick<Card, "permission" | "decisions">,
  shownId: string | null,
  list: readonly PaneAgent[],
): { agent: PaneAgent; text: string; permission: boolean; blocking: boolean } | null {
  const permission = card.permission;
  const asking = permission === null ? undefined : list.find((agent) => agent.live && agent.id === permission.agentId && agent.id !== shownId);
  if (permission !== null && asking !== undefined) return { agent: asking, text: permission.title, permission: true, blocking: true };
  const decision = card.decisions.find((candidate) => candidate.agentId !== shownId && list.some((agent) => agent.id === candidate.agentId));
  const by = decision === undefined ? undefined : list.find((agent) => agent.id === decision.agentId);
  return decision === undefined || by === undefined ? null : { agent: by, text: decision.question, permission: false, blocking: decision.blocking };
}

export type PaneAgentState = "running" | "idle" | "error" | "done";

/**
 * What an agent is doing, from Paseo's status and archive time only (never its words), and how long
 * it has run: until now while live, until it was archived once done. Null when the start is unknown.
 */
export function paneAgentState(agent: PaneAgent, now: number): { state: PaneAgentState; elapsedMs: number | null } {
  const started = Date.parse(agent.brief.createdAt ?? "");
  const until = agent.archivedAt === null ? now : Date.parse(agent.archivedAt);
  const elapsedMs = Number.isFinite(started) && Number.isFinite(until) && until >= started ? until - started : null;
  if (!agent.live) return { state: "done", elapsedMs };
  const status = agent.brief.status;
  const state: PaneAgentState = status === "running" || status === "initializing" ? "running" : status === "error" ? "error" : "idle";
  return { state, elapsedMs };
}

/** A chip's second line: running or done, the model, the time. */
export function paneAgentDetail(agent: PaneAgent, now: number): string {
  const { state, elapsedMs } = paneAgentState(agent, now);
  const model = agent.brief.model ?? agent.brief.provider;
  return [state, model, elapsedMs === null ? null : formatDuration(elapsedMs)].filter((part) => part !== null && part !== "").join(" · ");
}

/**
 * What the owner waits on while its subagents run, in the words of the subagent's title: the one
 * started last ("Implementer building the board columns"), how long it has run, and how many more run
 * beside it.
 */
export function waitingOn(card: Pick<Card, "subagents">, now: number): { text: string; running: string | null; more: number } | null {
  const running = card.subagents
    .filter((subagent) => subagent.status === "running" || subagent.status === "initializing")
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
  const newest = running[0];
  if (newest === undefined) return null;
  const started = Date.parse(newest.createdAt ?? "");
  const task = taskOfTitle(newest.title);
  return {
    text: task === "" ? capitalised(paneAgentJob(newest.role)) : doingText(newest.role, task),
    running: Number.isFinite(started) ? formatDuration(Math.max(0, now - started)) : null,
    more: running.length - 1,
  };
}
