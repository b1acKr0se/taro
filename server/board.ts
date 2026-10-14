/**
 * The board, assembled on the daemon (spec §5): the tracker's tickets, the
 * project's live agents by label, and the plugin's own state, joined into cards.
 */
import { stat } from "node:fs/promises";
import { hostname } from "node:os";

import { boardColumn, complexityOf, ticketAgents } from "../shared/board";
import { parseEvidence, type ParsedEvidence } from "../shared/evidence";
import { acceptedRecord, executionMachine, pullRequestUrl, type AcceptedRecord } from "../shared/execution";
import type { Board, Card, TicketDetailView } from "../shared/contracts";
import { latestMilestone, type Milestone } from "../shared/milestones";
import { deliveredLine, permissionAsk, type PermissionAsk } from "../shared/needs-you";
import { pastTicketAgents } from "../shared/past-agents";
import { isSubagentRole, roleFromLabel, TARO_LABELS } from "../shared/project";
import { boardAlerts } from "../shared/recovery";
import { decisionsOfLiveAgents, type StoredDecision } from "../shared/state";
import { protectionAlert } from "../shared/tracker-guard";
import { currentSuggestions, parseSuggestions, suggestionKey, withoutFixedActions } from "../shared/suggestions";
import { projectAgents, projectArchivedAgents } from "./agents";
import { statePath } from "./data-dir";
import { judgeTicketEvidence, ticketEvidence } from "./evidence";
import { readHeadroom } from "./headroom";
import { readJsonIfPresent, readTextIfPresent, writeJsonAtomically } from "./files";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { projectPaths } from "./projects";
import { serialized } from "./serialize";
import type { PluginState } from "./state";
import { agentBrief } from "./summaries";
import { listTickets, viewTicket } from "./tickets";

const UNDER_WAY = new Set(["Planning", "In Progress", "Reviewing", "Awaiting acceptance", "Blocked"]);

/** What only the ticket's records say: the host an EXECUTION record names, when not this machine, its pull request, its latest MILESTONE and its EVIDENCE record. */
async function recordedFacts(
  trackerPath: string,
  ticketId: string,
): Promise<{
  hostElsewhere: string | null;
  pullRequest: string | null;
  latestMilestone: Milestone | null;
  evidenceRecord: ParsedEvidence | null;
  accepted: AcceptedRecord | null;
  finalSummary: string | null;
}> {
  try {
    const detail = await viewTicket(trackerPath, ticketId);
    const host = executionMachine(detail.implementationNotes);
    return {
      hostElsewhere: host !== null && host !== hostname() ? host : null,
      pullRequest: pullRequestUrl(detail.implementationNotes, detail.finalSummary),
      latestMilestone: latestMilestone(detail.implementationNotes),
      evidenceRecord: parseEvidence(detail.implementationNotes),
      accepted: acceptedRecord(detail.implementationNotes),
      finalSummary: detail.finalSummary ?? null,
    };
  } catch {
    return { hostElsewhere: null, pullRequest: null, latestMilestone: null, evidenceRecord: null, accepted: null, finalSummary: null };
  }
}

/**
 * Records change only when the ticket file does, so a read is reused while `updatedAt` holds.
 * The tracker stamps whole minutes, so a short age bound still catches two notes in one minute.
 */
const FACTS_CACHE_MS = 60_000;
const factsCache = new Map<string, { updatedAt: string; at: number; facts: Promise<Awaited<ReturnType<typeof recordedFacts>>> }>();

function cachedRecordedFacts(trackerPath: string, ticketId: string, updatedAt: string | null): ReturnType<typeof recordedFacts> {
  if (updatedAt === null) return recordedFacts(trackerPath, ticketId);
  const key = `${trackerPath}\n${ticketId}`;
  const cached = factsCache.get(key);
  if (cached !== undefined && cached.updatedAt === updatedAt && Date.now() - cached.at < FACTS_CACHE_MS) return cached.facts;
  const facts = recordedFacts(trackerPath, ticketId);
  factsCache.set(key, { updatedAt, at: Date.now(), facts });
  return facts;
}

/** Archived agents only feed the finished-agents chips and grow without end, so they are listed less often than live ones. */
const ARCHIVED_CACHE_MS = 30_000;
const archivedCache = new Map<string, { at: number; agents: Promise<PaseoAgent[]> }>();

function cachedArchivedAgents(paseo: PaseoApi, project: string): Promise<PaseoAgent[]> {
  const cached = archivedCache.get(project);
  if (cached !== undefined && Date.now() - cached.at < ARCHIVED_CACHE_MS) return cached.agents;
  const agents = projectArchivedAgents(paseo, project);
  archivedCache.set(project, { at: Date.now(), agents });
  agents.catch(() => archivedCache.delete(project));
  return agents;
}

/** One read serves every caller for a moment: the screen, the Inbox and the sidebar all poll. */
const BOARD_CACHE_MS = 2_000;
const boardCache = new Map<string, { at: number; board: Promise<Board> }>();

export function loadBoard(paseo: PaseoApi, state: PluginState, project: string): Promise<Board> {
  const cached = boardCache.get(project);
  if (cached !== undefined && Date.now() - cached.at < BOARD_CACHE_MS) return cached.board;
  const board = readBoard(paseo, state, project);
  boardCache.set(project, { at: Date.now(), board });
  board.catch(() => boardCache.delete(project));
  return board;
}

/** Forgets cached boards after an action, so the next read shows its effect. */
export function invalidateBoards(): void {
  boardCache.clear();
  factsCache.clear();
  archivedCache.clear();
}

/** What the owner's first pending permission asks, for its card. */
function firstPermission(owner: PaseoAgent | null): (PermissionAsk & { id: string }) | null {
  const request = owner?.pendingPermissions[0];
  // The request's id tells a second ask from the first, for its notification (TR-059).
  return request === undefined ? null : { ...permissionAsk({ ...request, input: request.input ?? undefined }), id: request.id };
}

function groupByTicket(agents: readonly PaseoAgent[]): Map<string, PaseoAgent[]> {
  const byTicket = new Map<string, PaseoAgent[]>();
  for (const agent of agents) {
    const ticket = agent.labels[TARO_LABELS.ticket];
    if (ticket !== undefined) byTicket.set(ticket, [...(byTicket.get(ticket) ?? []), agent]);
  }
  return byTicket;
}

async function readBoard(paseo: PaseoApi, state: PluginState, project: string): Promise<Board> {
  const paths = await projectPaths(project);
  // Live agents come from their own list, so a long archive can never push a live owner past its page limit.
  const [tickets, agents, archived, decisions, agentStates, headroom] = await Promise.all([
    listTickets(paths.tracker),
    projectAgents(paseo, project),
    cachedArchivedAgents(paseo, project).catch(() => []),
    state.allDecisions(),
    state.allAgents(),
    readHeadroom(),
  ]);

  const byTicket = groupByTicket(agents);
  const archivedByTicket = groupByTicket(archived);
  // Only questions a live agent asked: one archived outside the plugin may not be withdrawn yet.
  const openDecisions = decisionsOfLiveAgents(
    decisions.filter((decision) => decision.project === project),
    new Set(agents.map((agent) => agent.id)),
  );

  const cards: Card[] = await Promise.all(
    tickets.map(async (ticket) => {
      const { owner, subagents: liveSubagents, columnAgent } = ticketAgents(ticket.id, ticket.parentTaskId, byTicket);
      const subagents = liveSubagents.flatMap((agent) => {
        const role = roleFromLabel(agent.labels[TARO_LABELS.role]);
        return role !== null && isSubagentRole(role) ? [{ ...agentBrief(agent), role }] : [];
      });
      const ownerState = owner === null ? null : agentStates[owner.id] ?? null;
      const finished = ticket.status === "Done" || ticket.status === "Cancelled";
      const ticketDecisions = finished ? [] : openDecisions.filter((decision) => decision.ticket === ticket.id);
      const needsHost = owner === null && UNDER_WAY.has(ticket.status);
      // Reading a ticket spawns the Backlog CLI: only under-way cards show what it holds, and only once per change.
      const facts = UNDER_WAY.has(ticket.status) ? await cachedRecordedFacts(paths.tracker, ticket.id, ticket.updatedAt) : null;
      const investigation = ticket.labels.includes("investigation");
      // The record is cached with the other facts; whether its screenshot files exist is read each time.
      const accepted = ticket.status === "Awaiting acceptance" ? facts?.accepted ?? null : null;
      const evidence = ticket.status === "Awaiting acceptance" && facts !== null ? await judgeTicketEvidence(project, ticket.id, facts.evidenceRecord, investigation) : null;
      const elsewhere = needsHost ? facts?.hostElsewhere ?? null : null;
      const archivedAgents = archivedByTicket.get(ticket.id) ?? [];
      const pastById = new Map(archivedAgents.map((agent) => [agent.id, agent]));
      const past = pastTicketAgents(
        archivedAgents.map((agent) => ({ id: agent.id, role: agent.labels[TARO_LABELS.role] ?? "", archivedAt: agent.archivedAt, updatedAt: agent.updatedAt })),
      ).flatMap((entry) => {
        const agent = pastById.get(entry.id);
        return agent === undefined ? [] : [{ ...agentBrief(agent), role: entry.role, archivedAt: entry.archivedAt }];
      });
      const children = tickets
        .filter((candidate) => candidate.parentTaskId === ticket.id)
        .map((child) => ({ id: child.id, title: child.title, status: child.status }));
      return {
        id: ticket.id,
        title: ticket.title,
        status: ticket.status,
        column: boardColumn({
          status: ticket.status,
          ownerElsewhere: elsewhere !== null,
          agent: columnAgent === null ? null : { status: columnAgent.status, pendingPermissions: columnAgent.pendingPermissions.length },
          lastStatus: ownerState?.lastStatus?.state ?? null,
          openBlockingDecisions: ticketDecisions.filter((decision) => decision.blocking).length,
          stalledAfterNudge: ownerState?.stalled ?? false,
          crashedOut: ownerState?.stalled === true && ownerState.stalledReason !== null,
          accepted: accepted !== null,
        }),
        labels: ticket.labels,
        complexity: complexityOf(ticket.labels),
        investigation,
        parent: ticket.parentTaskId,
        children,
        acceptanceDone: ticket.acceptanceCriteriaCompleted,
        acceptanceTotal: ticket.acceptanceCriteriaCount,
        updatedAt: ticket.updatedAt,
        owner: owner === null ? null : agentBrief(owner),
        ownerElsewhere: elsewhere,
        pullRequest: facts?.pullRequest ?? null,
        lastStatus: ownerState?.lastStatus ?? null,
        stalled: ownerState?.stalled ?? false,
        stalledReason: ownerState?.stalled === true ? ownerState.stalledReason : null,
        decisions: ticketDecisions,
        subagents,
        pastAgents: past,
        latestMilestone: UNDER_WAY.has(ticket.status) ? facts?.latestMilestone ?? null : null,
        evidence,
        accepted,
        permission: firstPermission(owner),
        delivered: ticket.status === "Awaiting acceptance" ? deliveredLine(facts?.finalSummary ?? null) : null,
      };
    }),
  );

  const manager = agents.find((agent) => agent.labels[TARO_LABELS.role] === "manager" && agentStates[agent.id]?.stalled === true);
  const managerState = manager === undefined ? null : agentStates[manager.id] ?? null;
  const protection = await state.trackerProtection(project);
  const now = Date.now();
  return {
    project,
    cards,
    managerDecisions: openDecisions.filter((decision) => decision.ticket === null),
    suggestions: await readSuggestions(project, tickets),
    headroom,
    alerts: [...boardAlerts(headroom, managerState?.stalledReason ?? null, now), ...[protectionAlert(protection, now)].filter((alert) => alert !== null)],
    loadedAt: new Date().toISOString(),
  };
}

/** Open decisions across one project (or all), from live agents only, for the Inbox and the ticket panel. */
export async function liveOpenDecisions(paseo: PaseoApi, state: PluginState, project: string | null): Promise<StoredDecision[]> {
  const open = (await state.allDecisions()).filter((decision) => decision.status === "open" && (project === null || decision.project === project));
  const projects = [...new Set(open.map((decision) => decision.project))];
  const live = new Set((await Promise.all(projects.map((name) => projectAgents(paseo, name)))).flat().map((agent) => agent.id));
  return decisionsOfLiveAgents(open, live);
}

export async function loadTicketDetail(project: string, ticketId: string): Promise<TicketDetailView> {
  const detail = await viewTicket((await projectPaths(project)).tracker, ticketId);
  const hasRecord = parseEvidence(detail.implementationNotes) !== null;
  return {
    id: detail.id,
    title: detail.title,
    status: detail.status,
    labels: detail.labels,
    description: detail.description,
    acceptanceCriteria: detail.acceptanceCriteria.map((criterion) => ({ index: criterion.index, text: criterion.text, checked: criterion.checked })),
    plan: detail.implementationPlan,
    notes: detail.implementationNotes,
    finalSummary: detail.finalSummary,
    dependencies: detail.dependencies,
    children: detail.subtasks.map((child) => ({ id: child.id, title: child.title, status: child.status ?? null })),
    evidence: hasRecord || detail.status === "Awaiting acceptance" ? await ticketEvidence(project, detail.id, detail.implementationNotes, detail.labels) : null,
  };
}

function dismissedPath(): string {
  return statePath("suggestions-dismissed.json");
}

async function readDismissed(): Promise<Record<string, string[]>> {
  const raw = await readJsonIfPresent(dismissedPath()).catch(() => null);
  return typeof raw === "object" && raw !== null ? (raw as Record<string, string[]>) : {};
}

/** The manager's suggestions the user has not dismissed, the tickets they name have not outdated and no fixed button repeats. */
export async function readSuggestions(project: string, tickets: readonly { id: string; updatedAt: string | null }[]): Promise<{ label: string; prompt: string }[]> {
  const path = (await projectPaths(project)).suggestions;
  const text = (await readTextIfPresent(path)) ?? "";
  if (text === "") return [];
  const written = await stat(path).catch(() => null);
  if (written === null) return [];
  const dismissed = new Set((await readDismissed())[project] ?? []);
  const kept = parseSuggestions(text).filter((suggestion) => !dismissed.has(suggestionKey(suggestion)));
  return currentSuggestions(withoutFixedActions(kept), written.mtimeMs, tickets);
}

export function dismissSuggestion(project: string, label: string, prompt: string): Promise<void> {
  return serialized("suggestions-dismissed", async () => {
    const all = await readDismissed();
    all[project] = [...new Set([...(all[project] ?? []), suggestionKey({ label, prompt })])].slice(-200);
    await writeJsonAtomically(dismissedPath(), all);
  });
}
