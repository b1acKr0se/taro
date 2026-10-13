/**
 * Which agents a ticket's pane can show: the live owner, its live subagents, then
 * the ticket's archived agents, so a finished ticket still shows the work its
 * agents did rather than "no owner".
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

/** The first owner listed (live, else the newest archived) is the owner; any other was replaced by it. */
function labelFor(role: PaneAgentRole, firstOwner: boolean, brief: AgentBrief): string {
  if (role === "owner") return firstOwner ? "Owner" : "Owner (earlier)";
  const task = taskOfTitle(brief.title);
  return task === "" ? `${capitalised(paneAgentJob(role))} · ${brief.id.slice(0, SHORT_ID_LENGTH)}` : doingText(role, task);
}

export function paneAgents(card: Pick<Card, "owner" | "subagents" | "pastAgents">): PaneAgent[] {
  const candidates: { role: PaneAgentRole; live: boolean; brief: AgentBrief; archivedAt?: string }[] = [
    ...(card.owner === null ? [] : [{ role: "owner" as const, live: true, brief: card.owner }]),
    ...card.subagents.map(({ role, ...brief }) => ({ role, live: true, brief })),
    ...card.pastAgents.map(({ role, archivedAt, ...brief }) => ({ role, live: false, brief, archivedAt })),
  ];
  // The board can list a just-archived agent both live and archived; the first (live) entry wins.
  const seen = new Set<string>();
  let ownerLabelled = false;
  return candidates.flatMap((candidate) => {
    if (seen.has(candidate.brief.id)) return [];
    seen.add(candidate.brief.id);
    const firstOwner = candidate.role === "owner" && !ownerLabelled;
    if (firstOwner) ownerLabelled = true;
    return [
      {
        id: candidate.brief.id,
        label: labelFor(candidate.role, firstOwner, candidate.brief),
        role: candidate.role,
        live: candidate.live,
        brief: candidate.brief,
        archivedAt: candidate.archivedAt ?? null,
      },
    ];
  });
}

/** The live owner, else the newest archived owner (archived agents come newest first), else null. */
export function defaultPaneAgent(list: readonly PaneAgent[]): PaneAgent | null {
  return list.find((agent) => agent.role === "owner" && agent.live) ?? list.find((agent) => agent.role === "owner") ?? null;
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
 * "Implementer building the board columns · 26m" for a ticket whose live subagents are running — what
 * the owner waits on, in the words of the subagent's title: the one started last, and how many more
 * run beside it.
 */
/** The newest running subagent: what it does, how long it has run, and how many others run beside it. */
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

export function waitingOnText(card: Pick<Card, "subagents">, now: number): string | null {
  const waiting = waitingOn(card, now);
  if (waiting === null) return null;
  return `${[waiting.text, waiting.running].filter((part) => part !== null).join(" · ")}${waiting.more > 0 ? ` (+${waiting.more} more)` : ""}`;
}
