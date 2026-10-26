/**
 * The board, assembled on the daemon (spec §5): the tracker's tickets, the
 * project's live agents by label, and the plugin's own state, joined into cards.
 */
import { stat } from "node:fs/promises";
import { hostname } from "node:os";

import { latestActivity, type Activity } from "../shared/activity";
import { ticketFileAlerts } from "../shared/alerts";
import { boardColumn, complexityOf, FIRST_PAGE, hasStarted, newestOwner, PAGED_COLUMNS, pageColumns, questionsForUser, ticketAgents } from "../shared/board";
import { offersCompact } from "../shared/compact";
import { parseEvidence, type ParsedEvidence } from "../shared/evidence";
import { acceptedRecord, executionMachine, notMergedRecord, pullRequestMerged, pullRequestUrl, type AcceptedRecord, type NotMergedRecord } from "../shared/execution";
import type { Board, BoardPaging, Card, EvidenceView, TicketDetailView } from "../shared/contracts";
import { latestMilestone, type Milestone } from "../shared/milestones";
import { deliveredLine, firstAsk } from "../shared/needs-you";
import { dependsOn } from "../shared/owner-cap";
import { pastTicketAgents } from "../shared/past-agents";
import { createPullRequestStates } from "./pull-request-states";
import { pauseRefusal, pauseView, type PauseView } from "../shared/pause";
import { holdReason, queuedTickets, recount, type Recount } from "../shared/queue-check";
import { queuedSlot, queuedWait } from "../shared/queued-wait";
import { offersRelaunch } from "../shared/relaunch";
import { closeRoundRefusal, reopenRefusal, reopenRound, roundFinalSummary } from "../shared/reopen";
import { offersSpecChange } from "../shared/spec-change";
import { isSubagentRole, roleFromLabel, TARO_LABELS } from "../shared/project";
import { boardAlerts, type BoardAlert } from "../shared/recovery";
import { decisionsOfLiveAgents, type StoredDecision } from "../shared/state";
import { currentSuggestions, parseSuggestions, suggestionKey, withoutFixedActions } from "../shared/suggestions";
import { isMidTurn, projectAgents, projectArchivedAgents } from "./agents";
import { statePath } from "./data-dir";
import { judgeTicketEvidence, ticketEvidence, ticketMockups } from "./evidence";
import { readHeadroom } from "./headroom";
import { readJsonIfPresent, readTextIfPresent, writeJsonAtomically } from "./files";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { projectPaths, readProjectConfig } from "./projects";
import { serialized } from "./serialize";
import { pastPlan, previousPlan } from "./plan-history";
import type { PluginState } from "./state";
import { agentBrief } from "./summaries";
import { childRecords, listTickets, ticketProblems, viewTicket } from "./tickets";

const UNDER_WAY = new Set(["Planning", "In Progress", "Reviewing", "Awaiting acceptance", "Blocked"]);

/** What only the ticket's records say: the host an EXECUTION record names, when not this machine, its pull request, its latest MILESTONE and its EVIDENCE record. */
async function recordedFacts(
  trackerPath: string,
  ticketId: string,
): Promise<{
  hostElsewhere: string | null;
  pullRequest: string | null;
  pullRequestMerged: boolean;
  latestMilestone: Milestone | null;
  evidenceRecord: ParsedEvidence | null;
  accepted: AcceptedRecord | null;
  notMerged: NotMergedRecord | null;
  finalSummary: string | null;
  notes: string | null;
}> {
  try {
    const detail = await viewTicket(trackerPath, ticketId);
    const host = executionMachine(detail.implementationNotes);
    return {
      hostElsewhere: host !== null && host !== hostname() ? host : null,
      pullRequest: pullRequestUrl(detail.implementationNotes, detail.finalSummary),
      pullRequestMerged: pullRequestMerged(detail.implementationNotes),
      latestMilestone: latestMilestone(detail.implementationNotes),
      evidenceRecord: parseEvidence(detail.implementationNotes),
      accepted: acceptedRecord(detail.implementationNotes),
      notMerged: notMergedRecord(detail.implementationNotes),
      finalSummary: detail.finalSummary ?? null,
      notes: detail.implementationNotes,
    };
  } catch {
    return { hostElsewhere: null, pullRequest: null, pullRequestMerged: false, latestMilestone: null, evidenceRecord: null, accepted: null, notMerged: null, finalSummary: null, notes: null };
  }
}

/**
 * Records change only when the ticket file does, so a read is reused while `updatedAt` holds.
 * Two writes within one second share a stamp, so a short age bound still catches the second.
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

/**
 * A running owner's latest tool call (TR-080), from a short tail of its timeline: one read per running
 * owner, reused for a few seconds, so the board's polling stays cheap (TR-069).
 */
const ACTIVITY_CACHE_MS = 10_000;
const activityCache = new Map<string, { at: number; activity: Promise<Activity | null> }>();

function cachedActivity(paseo: PaseoApi, agent: PaseoAgent | null): Promise<Activity | null> {
  if (agent === null || (agent.status !== "running" && agent.status !== "initializing")) return Promise.resolve(null);
  const cached = activityCache.get(agent.id);
  if (cached !== undefined && Date.now() - cached.at < ACTIVITY_CACHE_MS) return cached.activity;
  const activity = paseo.agents
    .ref(agent.id)
    .timeline.refetch({ direction: "tail", limit: 12, projection: "projected" })
    .then((page) => latestActivity(page.entries))
    .catch(() => null);
  activityCache.set(agent.id, { at: Date.now(), activity });
  for (const [id, entry] of activityCache) if (Date.now() - entry.at > ACTIVITY_CACHE_MS) activityCache.delete(id);
  return activity;
}

/** Not forgotten after an action: a merge at Accept shows from its record at once. */
const pullRequestStates = createPullRequestStates();

/** One read serves every caller for a moment: the screen, the Inbox and the sidebar all poll. */
const BOARD_CACHE_MS = 2_000;
const boardCache = new Map<string, { at: number; board: Promise<Board> }>();

/** Readers asking for the same pages share one read: the limits as the first page fills them in, and the included ids in order. */
function boardCacheKey(project: string, paging: BoardPaging): string {
  const limits = PAGED_COLUMNS.map((column) => paging.limits?.[column] ?? FIRST_PAGE);
  return JSON.stringify([project, limits, [...new Set(paging.include ?? [])].sort()]);
}

/** The board with each paged column's newest page (TR-082); callers that leave `paging` out get the first page. */
export function loadBoard(paseo: PaseoApi, state: PluginState, project: string, queueAlerts: readonly BoardAlert[] = [], paging: BoardPaging = {}): Promise<Board> {
  const key = boardCacheKey(project, paging);
  const cached = boardCache.get(key);
  // The queue check's alerts (TR-062) live in memory and are added fresh on every read.
  const withQueue = (board: Board): Board => (queueAlerts.length === 0 ? board : { ...board, alerts: [...board.alerts, ...queueAlerts] });
  if (cached !== undefined && Date.now() - cached.at < BOARD_CACHE_MS) return cached.board.then(withQueue);
  const board = readBoard(paseo, state, project, paging);
  for (const [other, entry] of boardCache) if (Date.now() - entry.at >= BOARD_CACHE_MS) boardCache.delete(other);
  boardCache.set(key, { at: Date.now(), board });
  board.catch(() => boardCache.delete(key));
  return board.then(withQueue);
}

/** Forgets cached boards after an action, so the next read shows its effect. */
export function invalidateBoards(): void {
  boardCache.clear();
  factsCache.clear();
  archivedCache.clear();
  activityCache.clear();
}

/** The manager and its own subagents, which carry no ticket, asking permission: the manager first, then the newest (TR-096). */
function managerAskers(agents: readonly PaseoAgent[]): PaseoAgent[] {
  const ofManager = agents.filter((agent) => {
    const role = roleFromLabel(agent.labels[TARO_LABELS.role]);
    return agent.pendingPermissions.length > 0 && (role === "manager" || (role !== null && isSubagentRole(role) && agent.labels[TARO_LABELS.ticket] === undefined));
  });
  const rank = (agent: PaseoAgent) => (agent.labels[TARO_LABELS.role] === "manager" ? 0 : 1);
  return ofManager.sort((left, right) => rank(left) - rank(right) || right.updatedAt.localeCompare(left.updatedAt));
}

function groupByTicket(agents: readonly PaseoAgent[]): Map<string, PaseoAgent[]> {
  const byTicket = new Map<string, PaseoAgent[]>();
  for (const agent of agents) {
    const ticket = agent.labels[TARO_LABELS.ticket];
    if (ticket !== undefined) byTicket.set(ticket, [...(byTicket.get(ticket) ?? []), agent]);
  }
  return byTicket;
}

async function readBoard(paseo: PaseoApi, state: PluginState, project: string, paging: BoardPaging): Promise<Board> {
  const paths = await projectPaths(project);
  // Live agents come from their own list, so a long archive can never push a live owner past its page limit.
  const [tickets, problems, agents, archived, decisions, agentStates, headroom] = await Promise.all([
    listTickets(paths.tracker),
    ticketProblems(paths.tracker),
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

  const childrenOf = new Map<string, { id: string; title: string; status: string }[]>();
  for (const ticket of tickets) {
    if (ticket.parentTaskId !== null) childrenOf.set(ticket.parentTaskId, [...(childrenOf.get(ticket.parentTaskId) ?? []), { id: ticket.id, title: ticket.title, status: ticket.status }]);
  }

  // Placing a ticket needs only the list, live agents and under-way records; a full card is built only for the page (TR-082).
  const placed = await Promise.all(
    tickets.map(async (ticket) => {
      const { owner, subagents: ownSubagents, childSubagents, columnAgent, askers } = ticketAgents(ticket.id, ticket.parentTaskId, byTicket, ticket.status, (childrenOf.get(ticket.id) ?? []).map((child) => child.id));
      // A parent's detail also lists its children's live subagents (TR-212).
      const liveSubagents = [...ownSubagents, ...childSubagents];
      // A child not started has no status of its own: its parent owner's line is about other work (TR-080).
      const ownLine = ticket.parentTaskId === null || hasStarted(ticket.status);
      const ownerState = owner === null ? null : agentStates[owner.id] ?? null;
      const finished = ticket.status === "Done" || ticket.status === "Cancelled";
      const ticketDecisions = finished ? [] : openDecisions.filter((decision) => decision.ticket === ticket.id);
      const needsHost = owner === null && UNDER_WAY.has(ticket.status);
      // Reading a ticket reads its whole file: only under-way cards show what it holds, and only once per change.
      // A Ready or Queued ticket is read too, as it may be parked (TR-088, TR-166).
      const facts = UNDER_WAY.has(ticket.status) || ticket.status === "Ready" || ticket.status === "Queued" ? await cachedRecordedFacts(paths.tracker, ticket.id, ticket.updatedAt) : null;
      // The record is cached with the other facts; whether its screenshot files exist is read each time.
      const accepted = ticket.status === "Awaiting acceptance" ? facts?.accepted ?? null : null;
      const elsewhere = needsHost ? facts?.hostElsewhere ?? null : null;
      const pausing = ticketPause(ticket, owner, facts);
      const column = boardColumn({
        status: ticket.status,
        ownerElsewhere: elsewhere !== null,
        agent: columnAgent === null ? null : { status: columnAgent.status, pendingPermissions: columnAgent.pendingPermissions.length },
        lastStatus: ownLine ? ownerState?.lastStatus?.state ?? null : null,
        openQuestions: questionsForUser(ticketDecisions),
        stalledAfterNudge: ownerState?.stalled ?? false,
        crashedOut: ownLine && ownerState?.stalled === true && ownerState.stalledReason !== null,
        accepted: accepted !== null,
        parked: pausing.pause?.state === "paused",
        queuedToResume: pausing.pause?.state === "queued-to-resume",
      });
      return { id: ticket.id, updatedAt: ticket.updatedAt, column, ticket, owner, liveSubagents, askers, ownLine, ownerState, ticketDecisions, facts, accepted, elsewhere, pausing };
    }),
  );
  const page = pageColumns(placed, paging.limits, paging.include);
  const queue = page.kept.some((entry) => entry.column === "queued") ? await queueRecount(project, paths.tracker, tickets, agents, headroom) : null;

  const cards: Card[] = await Promise.all(
    page.kept.map(async ({ ticket, column, owner, liveSubagents, askers, ownLine, ownerState, ticketDecisions, facts, accepted, elsewhere, pausing }) => {
      const subagents = liveSubagents.flatMap((agent) => {
        const role = roleFromLabel(agent.labels[TARO_LABELS.role]);
        return role !== null && isSubagentRole(role) ? [{ ...agentBrief(agent), role }] : [];
      });
      const investigation = ticket.labels.includes("investigation");
      // A Done card shows its PR (TR-114), a Queued one what it waits on (TR-138): read only for the cards on the page.
      const pageFacts = column === "done" || column === "queued" ? await cachedRecordedFacts(paths.tracker, ticket.id, ticket.updatedAt) : facts;
      const pullRequestFacts = column === "done" ? pageFacts : facts;
      const pullRequest = pullRequestFacts?.pullRequest ?? null;
      const waits =
        column === "queued"
          ? queuedWait({
              id: ticket.id,
              dependencies: ticket.dependencies,
              holdReason: holdReason(pageFacts?.notes ?? null),
              tickets,
              slot: queue === null ? null : queuedSlot(queue.count, ticket.id, queue.managerRunning),
            })
          : null;
      const evidence = ticket.status === "Awaiting acceptance" && facts !== null ? await judgeTicketEvidence(project, ticket.id, facts.evidenceRecord, investigation) : null;
      const archivedAgents = archivedByTicket.get(ticket.id) ?? [];
      const pastById = new Map(archivedAgents.map((agent) => [agent.id, agent]));
      const past = pastTicketAgents(
        archivedAgents.map((agent) => ({ id: agent.id, role: agent.labels[TARO_LABELS.role] ?? "", archivedAt: agent.archivedAt, updatedAt: agent.updatedAt })),
      ).flatMap((entry) => {
        const agent = pastById.get(entry.id);
        return agent === undefined ? [] : [{ ...agentBrief(agent), role: entry.role, archivedAt: entry.archivedAt }];
      });
      return {
        id: ticket.id,
        title: ticket.title,
        status: ticket.status,
        column,
        labels: ticket.labels,
        complexity: complexityOf(ticket.labels),
        investigation,
        parent: ticket.parentTaskId,
        children: childrenOf.get(ticket.id) ?? [],
        acceptanceDone: ticket.acceptanceCriteriaCompleted,
        acceptanceTotal: ticket.acceptanceCriteriaCount,
        updatedAt: ticket.updatedAt,
        owner: owner === null ? null : agentBrief(owner),
        ownerElsewhere: elsewhere,
        pullRequest,
        pullRequestMerged: pullRequestFacts?.pullRequestMerged ?? false,
        pullRequestState: pullRequest === null ? null : pullRequestStates.current(pullRequest),
        lastStatus: ownLine ? ownerState?.lastStatus ?? null : null,
        stalled: ownerState?.stalled ?? false,
        stalledReason: ownerState?.stalled === true ? ownerState.stalledReason : null,
        decisions: ticketDecisions,
        subagents,
        pastAgents: past,
        latestMilestone: UNDER_WAY.has(ticket.status) ? facts?.latestMilestone ?? null : null,
        activity: UNDER_WAY.has(ticket.status) ? await cachedActivity(paseo, owner) : null,
        evidence,
        accepted,
        notMerged: ticket.status === "Awaiting acceptance" ? facts?.notMerged ?? null : null,
        // A finished ticket waits on nobody, whatever its agents still ask.
        permission: column === "done" ? null : firstAsk(askers),
        delivered: ticket.status === "Awaiting acceptance" ? deliveredLine(roundFinalSummary(facts?.notes ?? null, facts?.finalSummary ?? null)) : null,
        pause: pausing.pause,
        pausable: pausing.pausable,
        queuedWait: waits,
      };
    }),
  );

  const manager = agents.find((agent) => agent.labels[TARO_LABELS.role] === "manager" && agentStates[agent.id]?.stalled === true);
  const managerState = manager === undefined ? null : agentStates[manager.id] ?? null;
  const now = Date.now();
  return {
    project,
    cards,
    managerDecisions: openDecisions.filter((decision) => decision.ticket === null && decision.dismissedFromBoard !== true),
    dismissedManagerDecisions: openDecisions.filter((decision) => decision.ticket === null && decision.dismissedFromBoard === true),
    ticketQuestions: openDecisions.filter((decision) => decision.ticket !== null).length,
    managerPermission: firstAsk(managerAskers(agents)),
    suggestions: await readSuggestions(project, tickets),
    headroom,
    alerts: [...boardAlerts(headroom, managerState?.stalledReason ?? null, now), ...ticketFileAlerts(problems)],
    loadedAt: new Date().toISOString(),
    totals: page.totals,
    offPage: page.offPage,
  };
}

/**
 * The plugin's recount of the queue (TR-062), as the manager's wake-ups give it, for the slot a startable
 * Queued card waits for (TR-142), and whether the project's manager, the agent the wake-ups go to, is
 * live to fill a free slot. Null for a project without a config.
 */
async function queueRecount(
  project: string,
  trackerPath: string,
  tickets: readonly { id: string; status: string; parentTaskId: string | null; dependencies: readonly string[]; updatedAt: string | null }[],
  agents: readonly PaseoAgent[],
  headroom: { current: number; max: number } | null,
): Promise<{ count: Recount; managerRunning: boolean } | null> {
  const config = await readProjectConfig(project).catch(() => null);
  if (config === null) return null;
  const queued = await Promise.all(
    queuedTickets(tickets).map(async (ticket) => ({ id: ticket.id, dependencies: ticket.dependencies, notes: (await cachedRecordedFacts(trackerPath, ticket.id, ticket.updatedAt)).notes })),
  );
  const count = recount({ owners: agents, tickets, queued, cap: config.maxParallelOwners, threads: headroom === null ? null : { current: headroom.current, max: headroom.max } });
  const managerRunning = config.managerAgentId !== "" && agents.some((agent) => agent.id === config.managerAgentId && agent.status !== "closed");
  return { count, managerRunning };
}

/** A ticket's pause (TR-088) and whether Pause is offered, from its recorded facts and whether its owner is alive. */
function ticketPause(
  ticket: { id: string; status: string; parentTaskId: string | null },
  owner: { status: string } | null,
  facts: { notes: string | null; accepted: AcceptedRecord | null } | null,
): { pause: PauseView | null; pausable: boolean } {
  if (facts === null || ticket.parentTaskId !== null) return { pause: null, pausable: false };
  const ownerAlive = owner !== null && owner.status !== "closed";
  return {
    pause: pauseView(facts.notes, ownerAlive),
    pausable: pauseRefusal({ id: ticket.id, status: ticket.status, parentTaskId: ticket.parentTaskId, notes: facts.notes }, facts.accepted !== null) === null,
  };
}

/** Open decisions across one project (or all), from live agents only, for the Inbox and the ticket panel. */
export async function liveOpenDecisions(paseo: PaseoApi, state: PluginState, project: string | null): Promise<StoredDecision[]> {
  const open = (await state.allDecisions()).filter((decision) => decision.status === "open" && (project === null || decision.project === project));
  const projects = [...new Set(open.map((decision) => decision.project))];
  const live = new Set((await Promise.all(projects.map((name) => projectAgents(paseo, name)))).flat().map((agent) => agent.id));
  return decisionsOfLiveAgents(open, live);
}

/** A finished plan card's plan (TR-157), from the ticket's tracker history. */
export async function loadTicketPastPlan(project: string, ticketId: string, card: { answeredAt: string | null; askedAt: string | null }): Promise<string | null> {
  const tracker = (await projectPaths(project)).tracker;
  const detail = await viewTicket(tracker, ticketId);
  return pastPlan(tracker, detail.id, detail.implementationNotes, card);
}

/** A child's EVIDENCE record, read from its own ticket file each time (TR-187): the parent never keeps a copy. Null when it has none or cannot be read. */
async function childEvidence(project: string, tracker: string, childId: string): Promise<EvidenceView | null> {
  const child = await childRecords(tracker, childId).catch(() => null);
  if (child === null || parseEvidence(child.notes) === null) return null;
  return ticketEvidence(project, child.id, child.notes, child.labels, child.status);
}

export async function loadTicketDetail(paseo: PaseoApi, project: string, ticketId: string): Promise<TicketDetailView> {
  const tracker = (await projectPaths(project)).tracker;
  const detail = await viewTicket(tracker, ticketId);
  const owners = (await projectAgents(paseo, project, "owner").catch(() => [])).filter((agent) => dependsOn([agent.labels[TARO_LABELS.ticket] ?? ""], detail.id));
  const owner = newestOwner(owners);
  const pausing = ticketPause(detail, owner, {
    notes: detail.implementationNotes,
    accepted: detail.status === "Awaiting acceptance" ? acceptedRecord(detail.implementationNotes) : null,
  });
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
    children: await Promise.all(detail.subtasks.map(async (child) => ({ id: child.id, title: child.title, status: child.status, evidence: await childEvidence(project, tracker, child.id) }))),
    evidence: hasRecord || detail.status === "Awaiting acceptance" ? await ticketEvidence(project, detail.id, detail.implementationNotes, detail.labels, detail.status) : null,
    mockups: await ticketMockups(project, detail.id, detail.implementationPlan),
    pause: pausing.pause,
    pausable: pausing.pausable,
    compactOwner:
      owner !== null && offersCompact({ parent: detail.parentTaskId, owner: { status: owner.status, contextUsedTokens: owner.lastUsage?.contextWindowUsedTokens ?? null } }) ? owner.id : null,
    specChangeable: offersSpecChange({ status: detail.status, parent: detail.parentTaskId, ownerRunning: owner !== null, paused: pausing.pause !== null }),
    closable: closeRoundRefusal(detail.id, { status: detail.status, parent: detail.parentTaskId, round: reopenRound(detail.implementationNotes) }) === null,
    reopenable: reopenRefusal(detail.id, { status: detail.status, parent: detail.parentTaskId, note: "reopen" }) === null,
    relaunchable: offersRelaunch({ status: detail.status, parent: detail.parentTaskId, paused: pausing.pause !== null, ownerRunning: owner !== null && isMidTurn(owner) }),
    previousPlan: detail.implementationPlan === null ? null : await previousPlan(tracker, detail.id, detail.implementationNotes),
    ownerRunning: owner !== null && isMidTurn(owner),
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
