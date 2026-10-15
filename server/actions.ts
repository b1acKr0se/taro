/**
 * What the user does from the Taro screen: answer a decision, accept or
 * request changes, nudge, compact or relaunch an owner (decisions 28, 30, 34).
 * Plus releasing a Done ticket's agents and workspaces (TR-024), the manager's wake-up for
 * tickets whose dependencies cleared, and the queue check (TR-062): the plugin's own recount in
 * every wake-up, a wake-up for a ticket filed while a slot is free or an idle manager with a
 * startable ticket, and the escalation ladder when the manager still does not dispatch.
 */
import { randomUUID } from "node:crypto";

import { doneTicketOf, planRelease } from "../shared/done-release";
import { acceptedRecord, acceptedRecordText, executionWorkspace, localMergeInstruction, pullRequestMergeInstruction, pullRequestUrl, reviewHead } from "../shared/execution";
import { dependsOn, holdsSlot, shouldWakeManager, statusChanges, withRecordedStatuses, type StatusChange } from "../shared/owner-cap";
import {
  handoffSincePauseRequest,
  PAUSE_HANDOFF_TIMEOUT_MS,
  pausedAgainHoldText,
  pausedByTaro,
  pausedHoldText,
  pauseProgress,
  pauseRefusal,
  pauseRequestedAt,
  queuedToResume,
  resumedReleaseText,
  resumeRefusal,
  resumesNow,
  type PauseProgress,
} from "../shared/pause";
import {
  emptyQueueWatch,
  managerCondition,
  type ManagerCondition,
  markRestarted,
  alertRaisedAt,
  markWoken,
  newlyAlerted,
  newlyWithheld,
  newlyQueuedStartable,
  queuedAlerts,
  queuedTickets,
  recount,
  recountFields,
  restartDue,
  shouldWakeIdleManager,
  situationKey,
  trackQueue,
  type QueueWatch,
  type QueuedTicket,
  type Recount,
} from "../shared/queue-check";
import { hasHeadroom, type BoardAlert } from "../shared/recovery";
import { TARO_LABELS, TICKET_STATUSES } from "../shared/project";
import { fetchLiveAgent, isAgentGone, isMidTurn, listTaroAgents, projectAgents, projectArchivedAgents } from "./agents";
import { taroEnvironment } from "./environment";
import { requireCompleteEvidence } from "./evidence";
import { readHeadroom } from "./headroom";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { restartManager } from "./manager";
import { bypassModeId } from "./models";
import { TEMPLATES, message, skillDirectory } from "./package-files";
import { listProjectConfigs, projectPaths, requireProjectConfig } from "./projects";
import { serialized } from "./serialize";
import { sendFromPlugin, sendWithoutInterrupting } from "./send";
import { hasAttachments, sendWithAttachments, type Attachments } from "./uploads";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import { identityFromLabels, lastHumanMessageAt, managerHandoffPath, type Supervisor } from "./supervision";
import { appendTicketNote, listTickets, viewTicket, type TicketSummary } from "./tickets";
import { usageReading, type Stats } from "./stats";
import { isStopping, reportFailure } from "./stopping";
import type { TrackerWatch } from "./tracker-watch";

export class Actions {
  /** Last seen status per project and ticket, to notice transitions to Done; on disk once acted on (TR-043). */
  private readonly lastStatuses = new Map<string, Map<string, string>>();
  /**
   * Per project, the tickets whose wake-up is held until threads allow, with the status each had
   * before: stored in place of the new one until the wake-up went out, so a reload repeats it.
   */
  private readonly undelivered = new Map<string, Map<string, string | undefined>>();
  /** Per project, tickets first seen in a pass whose wake-up failed: the next pass must see them as new, whatever the stats hold. */
  private readonly firstSeenRetrying = new Map<string, Set<string>>();
  /** The release running per project, so two never archive the same agents at once. */
  private readonly releasing = new Map<string, Promise<void>>();
  /** Agents already archived here: Paseo may still list one for a moment after archiving it. */
  private readonly released = new Set<string>();
  /** The escalation ladder per project (TR-062); in memory, so a reload starts it again. */
  private readonly queues = new Map<string, QueueWatch>();
  /** The manager's condition per project at the last minute check, which the queued alert's text follows. */
  private readonly managerConditions = new Map<string, ManagerCondition>();
  /** Queued tickets' dependencies and notes, read again only when the ticket changes. */
  private readonly queuedDetails = new Map<string, { updatedAt: string; ticket: QueuedTicket }>();
  private checkingQueues = false;
  /** Under-way tickets' notes, read again only when the ticket changes, for pauses and queued resumes (TR-088). */
  private readonly pauseNotes = new Map<string, { updatedAt: string; notes: string | null }>();
  /** Projects whose stored ladder was merged in since the start. */
  private readonly ladderLoaded = new Set<string>();

  constructor(
    private readonly state: PluginState,
    private readonly supervisor: Supervisor,
    private readonly trackers: TrackerWatch,
    private readonly stats: Stats,
    private readonly recovery: Recovery,
  ) {}

  async answerDecision(paseo: PaseoApi, key: string, label: string | null, text: string, from: "screen" | "tab" = "screen"): Promise<void> {
    const decision = await this.state.decision(key);
    // An answered or withdrawn decision stays stored for a while; a second answer would contradict the first.
    if (decision === null || decision.status !== "open") throw new Error("That decision is no longer open.");
    // Withdrawal is final, so only Paseo's own word that the agent is gone counts, not a failed lookup.
    if (await isAgentGone(paseo, decision.agentId)) {
      await this.supervisor.withdrawDecisionsOf(decision.agentId);
      throw new Error("The agent that asked this is archived or gone, so nothing was sent; its open questions are withdrawn.");
    }
    const option = label === null ? null : decision.options.find((candidate) => candidate.label === label) ?? null;
    const typed = text.trim();
    const prompt = option?.prompt.trim() ?? "";
    const lead = prompt.replace(/\u2026$/, "").trim();
    // Typed text goes with a chosen option (an option whose prompt ends with "…" asks for it): the prompt, then the text.
    // Text that already starts with the prompt (the card prefills it; older cards send the prompt alone) is not repeated.
    const words = option === null ? typed : typed === "" ? prompt : typed.startsWith(lead) ? typed : `${lead}: ${typed}`;
    if (words === "") throw new Error("Type an answer or press an option.");
    // Tagged as the plugin's, so this answer closes only its own decision, not the agent's others.
    await sendFromPlugin(paseo, decision.agentId, await message(TEMPLATES.answer, { text: words }));
    // A decision without a ticket is the manager's: answering it acts on a queued alert as a message would.
    if (decision.ticket === null) this.userToldManager(decision.project);
    const at = new Date().toISOString();
    await this.state.updateDecisions((decisions) => {
      const stored = decisions.find((candidate) => candidate.key === key);
      if (stored !== undefined) {
        stored.status = "answered";
        stored.answer = { text: words, label: option?.label ?? null, at };
      }
    });
    if (decision.ticket !== null) {
      const paths = await projectPaths(decision.project);
      await appendTicketNote(paths.tracker, decision.ticket, `ANSWER ${at} — ${decision.id}: "${decision.question}" → ${option === null ? `"${words}"` : `${option.label} ("${words}")`} (the user, from ${from === "tab" ? "the agent's tab" : "the Taro screen"})`).catch(
        (error: unknown) => console.warn(`[taro] could not record the answer on ${decision.ticket}: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
  }

  async tellAgent(paseo: PaseoApi, agentId: string, text: string, attachments: Attachments = {}): Promise<void> {
    const words = text.trim();
    if (words === "" && !hasAttachments(attachments)) throw new Error("Say something first.");
    const agent = await fetchLiveAgent(paseo, agentId);
    if (agent === null) throw new Error("That agent is no longer running.");
    await sendWithAttachments(paseo, agentId, words, { ...attachments, agentMidTurn: isMidTurn(agent) });
  }

  async nudge(paseo: PaseoApi, agentId: string): Promise<void> {
    if ((await fetchLiveAgent(paseo, agentId)) === null) throw new Error("That agent is no longer running.");
    await sendFromPlugin(paseo, agentId, await message(TEMPLATES.nudge));
    const record = await this.state.agent(agentId);
    if (record !== null) {
      await this.state.updateAgent(agentId, () => record, (next) => {
        next.stallCount = 0;
        next.stalled = false;
      });
    }
  }

  async compact(paseo: PaseoApi, agentId: string): Promise<void> {
    const agent = await fetchLiveAgent(paseo, agentId);
    if (agent === null) throw new Error("That agent is no longer running.");
    if (isMidTurn(agent)) throw new Error("It is in the middle of a turn. Compact it once it is idle.");
    const identity = identityFromLabels(agent.labels, agent.title ?? null);
    if (identity === null) throw new Error("That is not a Taro agent.");
    await this.supervisor.startCompaction(paseo, agentId, identity, agent.lastUsage?.contextWindowUsedTokens ?? null, "button");
  }

  private async owners(paseo: PaseoApi, project: string, ticket: string) {
    return listTaroAgents(paseo, { [TARO_LABELS.project]: project, [TARO_LABELS.role]: "owner", [TARO_LABELS.ticket]: ticket });
  }

  private async requireOwner(paseo: PaseoApi, project: string, ticket: string) {
    const owner = (await this.owners(paseo, project, ticket)).filter((agent) => agent.status !== "closed").sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (owner === undefined) throw new Error(`${ticket} has no live owner. Relaunch it from its card.`);
    return owner;
  }

  async accept(paseo: PaseoApi, project: string, ticket: string): Promise<void> {
    const config = await requireProjectConfig(project);
    const owner = await this.requireOwner(paseo, project, ticket);
    const paths = await projectPaths(project);
    const detail = await viewTicket(paths.tracker, ticket);
    // Nothing reaches the owner while the evidence is incomplete.
    await requireCompleteEvidence(project, ticket, detail.implementationNotes, detail.labels);
    const investigation = detail.labels.includes("investigation");
    let mergeInstruction: string;
    // What the card says while the owner finishes (TR-031): what it merges, null for nothing, undefined
    // when the owner is told to present again instead, so the card keeps offering Accept.
    let merging: string | null | undefined = null;
    if (investigation) mergeInstruction = "Record ACCEPTANCE with my words and set the ticket Done.";
    else if (!config.acceptAlsoMerges) mergeInstruction = "Do not merge; record ACCEPTANCE with my words and set the ticket Done.";
    else if (config.delivery === "pull-request") {
      mergeInstruction = pullRequestMergeInstruction(detail.implementationNotes, detail.finalSummary);
      const mergeable = reviewHead(detail.implementationNotes) !== null && pullRequestUrl(detail.implementationNotes, detail.finalSummary) !== null;
      merging = mergeable ? "the pull request" : undefined;
    } else {
      mergeInstruction = localMergeInstruction(detail.implementationNotes, config.baseBranch, config.repoPath);
      merging = reviewHead(detail.implementationNotes) !== null ? `into ${config.baseBranch}` : undefined;
    }
    await sendWithoutInterrupting(paseo, owner.id, await message(TEMPLATES.accept, { ticket, mergeInstruction }));
    if (merging !== undefined) await appendTicketNote(paths.tracker, ticket, acceptedRecordText(new Date().toISOString(), merging)).catch(() => undefined);
  }

  async requestChanges(paseo: PaseoApi, project: string, ticket: string, text: string): Promise<void> {
    const owner = await this.requireOwner(paseo, project, ticket);
    await sendWithoutInterrupting(paseo, owner.id, await message(TEMPLATES.requestChanges, { ticket, text: text.trim() }));
    const paths = await projectPaths(project);
    await appendTicketNote(paths.tracker, ticket, `CHANGES-REQUESTED ${new Date().toISOString()} — the user: "${text.trim()}"`).catch(() => undefined);
  }

  /** A fresh owner in the same workspace, from the ticket's latest handoff or milestone (decision 30). */
  async relaunchOwner(paseo: PaseoApi, project: string, ticket: string): Promise<string> {
    const config = await requireProjectConfig(project);
    const paths = await projectPaths(project);
    const previous = (await this.owners(paseo, project, ticket)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
    let workspaceId = previous?.workspaceId ?? null;
    if (workspaceId === null) {
      const detail = await viewTicket(paths.tracker, ticket);
      workspaceId = executionWorkspace(detail.implementationNotes);
    }
    if (workspaceId === null) throw new Error(`Cannot tell which workspace ${ticket} used; its EXECUTION record names none.`);
    if (previous !== null && isMidTurn(previous)) throw new Error("Its owner is running; nudge or interrupt it instead.");
    if (previous !== null) {
      await paseo.agents.ref(previous.id).archive().catch(() => undefined);
      // The archive hook does this too; done here as well so the new owner never appears beside the old questions.
      await this.supervisor.withdrawDecisionsOf(previous.id);
    }

    const detail = await viewTicket(paths.tracker, ticket);
    const agentId = randomUUID();
    const modeId = await bypassModeId(paseo, config.owner.model);
    await paseo.workspaces.ref(workspaceId).agents.create({
      agentId,
      config: {
        provider: config.owner.model,
        ...(modeId === null ? {} : { modeId }),
        ...(config.owner.thinking === "" ? {} : { thinkingOptionId: config.owner.thinking }),
      },
      title: `${ticket} · ${detail.title}`,
      labels: { [TARO_LABELS.project]: project, [TARO_LABELS.role]: "owner", [TARO_LABELS.ticket]: ticket },
      env: await taroEnvironment(project, paths.tracker),
      prompt: await message(TEMPLATES.relaunchOwner, {
        ticket,
        project,
        skill: await skillDirectory(),
        tracker: paths.tracker,
        agentId,
        workspaceId,
        previousAgentId: previous?.id ?? "(none)",
      }),
    });
    if (previous !== null) await this.state.forgetAgent(previous.id);
    return agentId;
  }

  /** A ticket's live owner, if any; ids compare without case. */
  private async liveOwner(paseo: PaseoApi, project: string, ticket: string): Promise<PaseoAgent | null> {
    const owners = (await projectAgents(paseo, project, "owner")).filter((agent) => agent.status !== "closed" && dependsOn([agent.labels[TARO_LABELS.ticket] ?? ""], ticket));
    return owners.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  }

  /**
   * Pause (TR-088): asks the owner for a HANDOFF and records the request; the owner's turn end and
   * the minute check finish the pause (`advancePauses`). With no live owner it pauses at once.
   */
  async pause(paseo: PaseoApi, project: string, ticket: string): Promise<string> {
    // Under the project's tracker lock, with the minute check and the turn-end hook, so a pause is never finished twice.
    return serialized(`tracker-changed:${project}`, () => this.pauseTicket(paseo, project, ticket));
  }

  private async pauseTicket(paseo: PaseoApi, project: string, ticket: string): Promise<string> {
    const paths = await projectPaths(project);
    const detail = await viewTicket(paths.tracker, ticket);
    const notes = detail.implementationNotes;
    const merging = detail.status === "Awaiting acceptance" && acceptedRecord(notes) !== null;
    const refusal = pauseRefusal({ id: detail.id, status: detail.status, parentTaskId: detail.parentTaskId, notes }, merging);
    if (refusal !== null) throw new Error(refusal);
    const owner = await this.liveOwner(paseo, project, detail.id);
    // Queued to resume and not started yet: back to Paused at once, from what the earlier pause left.
    if (owner === null && queuedToResume(notes)) {
      await appendTicketNote(paths.tracker, detail.id, pausedAgainHoldText(new Date().toISOString().slice(0, 16) + "Z", notes));
      return `${detail.id} is paused again: it will not start until you resume it.`;
    }
    const minutes = PAUSE_HANDOFF_TIMEOUT_MS / 60_000;
    await appendTicketNote(paths.tracker, detail.id, `PAUSE-REQUESTED ${new Date().toISOString()} — the user pressed Pause; waiting up to ${minutes} minutes for the owner's HANDOFF`);
    if (owner === null) {
      await this.finishPause(paseo, project, detail.id, "owner-gone", false);
      return `${detail.id} is paused. It had no live owner, so there is no handoff: a fresh owner resumes from the latest milestone.`;
    }
    await sendFromPlugin(paseo, owner.id, await message(TEMPLATES.pause, { ticket: detail.id, skill: await skillDirectory(), timeoutMinutes: String(minutes) }));
    return `Pausing ${detail.id}: its owner is writing a handoff (at most ${minutes} minutes).`;
  }

  /** Archives the ticket's agents after recording the pause, so the board never sees it without an owner and unpaused. */
  private async finishPause(paseo: PaseoApi, project: string, ticket: string, progress: Exclude<PauseProgress, "waiting">, handoffWritten: boolean): Promise<void> {
    const paths = await projectPaths(project);
    await appendTicketNote(paths.tracker, ticket, pausedHoldText(new Date().toISOString().slice(0, 16) + "Z", progress, handoffWritten));
    const archived = await this.archiveTicketAgents(paseo, project, ticket);
    console.log(`[taro] ${project}: paused ${ticket} (${progress}); archived ${archived} agent(s)`);
  }

  /** Archives the live agents of a ticket and its children (never the manager); safe to repeat. Returns how many. */
  private async archiveTicketAgents(paseo: PaseoApi, project: string, ticket: string): Promise<number> {
    const agents = (await projectAgents(paseo, project)).filter((agent) => agent.labels[TARO_LABELS.role] !== "manager" && doneTicketOf(agent.labels[TARO_LABELS.ticket], new Set([ticket])) !== null);
    for (const agent of agents) {
      await paseo.agents
        .ref(agent.id)
        .archive()
        .catch((error: unknown) => console.warn(`[taro] pausing ${ticket}: could not archive ${agent.id}: ${error instanceof Error ? error.message : String(error)}`));
      await this.supervisor.withdrawDecisionsOf(agent.id);
      await this.state.forgetAgent(agent.id);
    }
    return agents.length;
  }

  /**
   * Resume (TR-088): with a free slot (and no older queued ticket waiting for it) a fresh owner starts
   * from the latest HANDOFF now; otherwise the ticket is queued to resume and the minute check starts it.
   */
  async resume(paseo: PaseoApi, project: string, ticket: string): Promise<{ message: string; agentId: string | null }> {
    // Under the project's tracker lock: two quick Resumes (card and ticket view, phone and desktop) start one owner.
    return serialized(`tracker-changed:${project}`, () => this.resumeTicket(paseo, project, ticket));
  }

  private async resumeTicket(paseo: PaseoApi, project: string, ticket: string): Promise<{ message: string; agentId: string | null }> {
    const config = await requireProjectConfig(project);
    const paths = await projectPaths(project);
    const detail = await viewTicket(paths.tracker, ticket);
    const notes = detail.implementationNotes;
    const merging = detail.status === "Awaiting acceptance" && acceptedRecord(notes) !== null;
    const owner = await this.liveOwner(paseo, project, detail.id);
    const refusal = resumeRefusal({ id: detail.id, status: detail.status, parentTaskId: detail.parentTaskId, notes }, merging, owner !== null);
    if (refusal !== null) throw new Error(refusal);
    const tickets = await listTickets(paths.tracker);
    const count = await this.recountQueue(paseo, project, tickets, config.maxParallelOwners, true);
    const at = new Date().toISOString().slice(0, 16) + "Z";
    if (this.resumesNow(detail.id, tickets, count)) {
      const agentId = await this.relaunchOwner(paseo, project, detail.id);
      await appendTicketNote(paths.tracker, detail.id, resumedReleaseText(at, null));
      return { message: `A fresh owner is starting on ${detail.id}.`, agentId };
    }
    await appendTicketNote(paths.tracker, detail.id, resumedReleaseText(at, { counting: count.counting.length, cap: count.cap }));
    const why = count.counting.length >= count.cap ? `owners ${count.counting.length} of ${count.cap}` : !hasHeadroom(count.threads) ? "threads near the host's limit" : "older queued tickets come first";
    return { message: `${detail.id} is queued to resume: no free slot (${why}). It starts when one frees.`, agentId: null };
  }

  private resumesNow(ticket: string, tickets: readonly TicketSummary[], count: Recount): boolean {
    return resumesNow({ ticket, order: tickets.map((each) => each.id), startable: count.startable, counting: count.counting.length, cap: count.cap, headroom: hasHeadroom(count.threads) });
  }

  /** Notes of the tickets that may be pausing or queued to resume: top-level, holding a slot when owned. */
  private async pauseCandidates(project: string, tickets: readonly TicketSummary[]): Promise<{ ticket: TicketSummary; notes: string | null }[]> {
    const paths = await projectPaths(project);
    const candidates: { ticket: TicketSummary; notes: string | null }[] = [];
    for (const ticket of tickets) {
      if (ticket.parentTaskId !== null || !holdsSlot(ticket.status)) continue;
      const key = `${project}:${ticket.id}`;
      const cached = this.pauseNotes.get(key);
      if (cached !== undefined && ticket.updatedAt !== null && cached.updatedAt === ticket.updatedAt) {
        candidates.push({ ticket, notes: cached.notes });
        continue;
      }
      const notes = (await viewTicket(paths.tracker, ticket.id)).implementationNotes ?? null;
      if (ticket.updatedAt !== null) this.pauseNotes.set(key, { updatedAt: ticket.updatedAt, notes });
      candidates.push({ ticket, notes });
    }
    return candidates;
  }

  /**
   * Finishes pauses whose HANDOFF is in (and the owner's turn over), whose owner is gone, or whose wait
   * ran out; then starts tickets queued to resume while slots allow, oldest first (TR-088).
   * Returns whether anything changed.
   */
  async advancePauses(paseo: PaseoApi, project: string, now: number = Date.now()): Promise<boolean> {
    const config = await requireProjectConfig(project);
    const paths = await projectPaths(project);
    let tickets = await listTickets(paths.tracker);
    let changed = false;
    for (const { ticket, notes } of await this.pauseCandidates(project, tickets)) {
      const requested = pauseRequestedAt(notes);
      if (requested === null) continue;
      const owner = await this.liveOwner(paseo, project, ticket.id);
      const progress = pauseProgress({ notes, requestedAt: Date.parse(requested), now, ownerAlive: owner !== null, ownerMidTurn: owner !== null && isMidTurn(owner) });
      if (progress === "waiting") continue;
      await this.finishPause(paseo, project, ticket.id, progress, handoffSincePauseRequest(notes));
      changed = true;
    }
    if (changed) tickets = await listTickets(paths.tracker);
    // A pause cut short after its HOLD (a reload, a failed archive) leaves agents alive under it: archive them now.
    for (const { ticket, notes } of await this.pauseCandidates(project, tickets)) {
      if (!pausedByTaro(notes)) continue;
      const archived = await this.archiveTicketAgents(paseo, project, ticket.id);
      if (archived === 0) continue;
      console.log(`[taro] ${project}: finished pausing ${ticket.id}; archived ${archived} agent(s) left alive`);
      changed = true;
    }
    const queued = [];
    for (const candidate of await this.pauseCandidates(project, tickets)) {
      if (queuedToResume(candidate.notes) && (await this.liveOwner(paseo, project, candidate.ticket.id)) === null) queued.push(candidate.ticket);
    }
    for (const ticket of queued) {
      const count = await this.recountQueue(paseo, project, tickets, config.maxParallelOwners, true);
      if (!this.resumesNow(ticket.id, tickets, count)) continue;
      const agentId = await this.relaunchOwner(paseo, project, ticket.id);
      await appendTicketNote(paths.tracker, ticket.id, `RESUMED ${new Date().toISOString()} — a slot freed: the plugin started a fresh owner ${agentId} from the latest HANDOFF`);
      console.log(`[taro] ${project}: resumed ${ticket.id} with a fresh owner ${agentId}`);
      changed = true;
    }
    return changed;
  }

  /**
   * Reads back every project's ticket statuses at start, as last acted on, so a change made while the
   * plugin was down or stopping is still seen as one (TR-043: the merge at an accept reloads the
   * plugin as the ticket goes Done). The tracker primes a project with nothing stored.
   */
  async primeStatuses(): Promise<void> {
    for (const config of await listProjectConfigs()) {
      if (this.lastStatuses.has(config.project)) continue;
      const tickets = await listTickets((await projectPaths(config.project)).tracker).catch(() => null);
      if (tickets === null) continue;
      const stored = await this.state.ticketStatuses(config.project).catch(() => null);
      if (this.lastStatuses.has(config.project)) continue;
      if (stored !== null) this.lastStatuses.set(config.project, new Map(stored));
      else {
        const current = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
        this.lastStatuses.set(config.project, current);
        await this.state.saveTicketStatuses(config.project, current).catch(() => undefined);
      }
      // Questions left open on tickets that finished while the plugin was not watching are moot.
      const finished = new Set(tickets.filter((ticket) => ticket.status === "Done" || ticket.status === "Cancelled").map((ticket) => ticket.id));
      await this.state.updateDecisions((decisions) => {
        for (const decision of decisions) {
          if (decision.project === config.project && decision.status === "open" && decision.ticket !== null && finished.has(decision.ticket)) decision.status = "withdrawn";
        }
      });
    }
  }

  /**
   * Called after every tracker commit, and once per project after a start: releases Done tickets'
   * agents and wakes the manager for cleared dependencies and freed owner slots. One pass at a time
   * per project. A change counts as seen only once acted on: one whose wake-up failed stays unseen
   * and is retried by the next pass, and one whose wake-up is held for threads is stored unseen until
   * it went out, so a stop repeats it at the next start (a wake-up may come twice, never not at all).
   */
  onTrackerChanged(paseo: PaseoApi, project: string): Promise<void> {
    return serialized(`tracker-changed:${project}`, () => this.trackerChanged(paseo, project));
  }

  private async trackerChanged(paseo: PaseoApi, project: string): Promise<void> {
    const paths = await projectPaths(project);
    const tickets = await listTickets(paths.tracker);
    // A pass may come before the start's priming: the stored statuses are what it compares with then.
    // Neither (the first pass over an adopted tracker): no last look, so unknown tickets free nothing.
    // A ticket missing from the last look (a tracker onboarded again) takes its status from the stats,
    // so a Done ticket is not announced again (TR-100).
    const recorded = await this.stats.recordedStatuses(project).catch(() => null);
    const retrying = this.firstSeenRetrying.get(project) ?? new Set<string>();
    this.firstSeenRetrying.set(project, retrying);
    for (const [ticket, before] of this.undelivered.get(project) ?? []) if (before === undefined) retrying.add(ticket);
    for (const ticket of retrying) recorded?.delete(ticket);
    const lastLook = withRecordedStatuses(this.lastStatuses.get(project) ?? (await this.state.ticketStatuses(project).catch(() => null)), recorded);
    const previous = lastLook ?? new Map<string, string>();
    const current = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
    this.lastStatuses.set(project, current);
    const at = new Date().toISOString();
    for (const ticket of tickets) {
      const before = previous.get(ticket.id) ?? null;
      if (before !== ticket.status) await this.stats.transition(project, ticket.id, ticket.title, before, ticket.status, at);
    }
    const done = tickets.filter((ticket) => ticket.status === "Done" && previous.get(ticket.id) !== "Done");
    let failure: unknown = null;
    // Every Done ticket, not only the new ones: a transition missed during a reload still releases its
    // agents, so a failed release is retried by the next pass and need not hold up the wake-ups.
    await this.releaseDoneTickets(paseo, project, done.map((ticket) => ticket.id)).catch((error: unknown) => {
      failure = error;
    });
    for (const change of statusChanges(lastLook, tickets)) {
      const before = previous.get(change.ticket);
      try {
        await this.wakeManager(paseo, project, change, tickets, () => this.markUndelivered(project, change.ticket, before));
        if (!this.undelivered.get(project)?.has(change.ticket)) retrying.delete(change.ticket);
      } catch (error: unknown) {
        failure ??= error;
        if (before === undefined) {
          current.delete(change.ticket);
          retrying.add(change.ticket);
        } else current.set(change.ticket, before);
      }
    }
    await this.storeStatuses(project);
    // A ticket filed while a slot is free (TR-062); missed here, the minute check still finds it.
    if (lastLook !== null && queuedTickets(tickets).some((ticket) => !lastLook.has(ticket.id))) {
      await this.wakeForNewTickets(paseo, project, tickets, lastLook).catch((error: unknown) => {
        reportFailure(`[taro] waking ${project}'s manager for a new ticket:`, error);
      });
    }
    if (failure !== null) throw failure;
  }

  /** A wake-up held for threads: stored as unseen until it goes out; returns what to call then. */
  private markUndelivered(project: string, ticket: string, before: string | undefined): () => void {
    const pending = this.undelivered.get(project) ?? new Map<string, string | undefined>();
    this.undelivered.set(project, pending);
    if (!pending.has(ticket)) pending.set(ticket, before);
    return () => {
      pending.delete(ticket);
      void serialized(`tracker-changed:${project}`, () => this.storeStatuses(project)).catch((error: unknown) => {
        console.error(`[taro] storing ${project}'s ticket statuses:`, error);
      });
    };
  }

  /** The statuses acted on, with each held wake-up's ticket at its status from before. */
  private async storeStatuses(project: string): Promise<void> {
    const statuses = new Map(this.lastStatuses.get(project) ?? []);
    for (const [ticket, before] of this.undelivered.get(project) ?? []) {
      if (before === undefined) statuses.delete(ticket);
      else statuses.set(ticket, before);
    }
    await this.state.saveTicketStatuses(project, statuses);
  }

  /** An agent's turn ended: if its ticket is Done (it was mid-turn when Done landed), release it now. */
  async onAgentTurnEnded(paseo: PaseoApi, agentId: string): Promise<void> {
    const agent = await fetchLiveAgent(paseo, agentId);
    const project = agent?.labels[TARO_LABELS.project];
    if (agent === null || project === undefined) return;
    // An owner asked to pause is archived as soon as the turn that wrote its HANDOFF ends (TR-088).
    if (agent.labels[TARO_LABELS.role] === "owner") {
      // A failed pause check must not hold up the Done release below; the minute check tries again.
      await serialized(`tracker-changed:${project}`, () => this.advancePauses(paseo, project)).catch((error: unknown) => reportFailure(`[taro] pause check for ${project} failed:`, error));
    }
    const statuses = this.lastStatuses.get(project);
    if (statuses === undefined) return;
    const done = new Set([...statuses].filter(([, status]) => status === "Done").map(([ticket]) => ticket));
    if (doneTicketOf(agent.labels[TARO_LABELS.ticket], done) !== null) await this.releaseDoneTickets(paseo, project, []);
  }

  /**
   * After a start: acts on the changes made while the plugin was not watching, so Done tickets'
   * agents are released and the manager hears of cleared dependencies and freed slots.
   */
  async catchUpAfterStart(paseo: PaseoApi): Promise<void> {
    await this.primeStatuses();
    for (const config of await listProjectConfigs()) {
      if (!this.lastStatuses.has(config.project)) continue;
      await this.onTrackerChanged(paseo, config.project).catch((error: unknown) => {
        reportFailure(`[taro] catching up on ${config.project}'s tracker after start:`, error);
      });
    }
  }

  /**
   * Archives the idle agents of every Done ticket, and their owners' workspaces once empty; an agent
   * mid-turn waits for its turn end (TR-024). `newlyDone` tickets have their open questions withdrawn
   * even when no agent is left. Queued per project, since a turn end and a commit may arrive together.
   */
  private releaseDoneTickets(paseo: PaseoApi, project: string, newlyDone: readonly string[]): Promise<void> {
    const run = (this.releasing.get(project) ?? Promise.resolve()).then(() => this.release(paseo, project, newlyDone));
    this.releasing.set(project, run.catch(() => undefined));
    return run;
  }

  private async release(paseo: PaseoApi, project: string, newlyDone: readonly string[]): Promise<void> {
    const statuses = this.lastStatuses.get(project) ?? new Map<string, string>();
    const done = new Set([...statuses].filter(([, status]) => status === "Done").map(([ticket]) => ticket));
    if (done.size === 0) return;
    const agents = (await projectAgents(paseo, project)).filter((agent) => !this.released.has(agent.id));
    const config = await requireProjectConfig(project);
    const planWith = (archivedOwnerWorkspaces: ReadonlySet<string>) => planRelease(done, agents, { isMidTurn, managerWorkspaceId: config.managerWorkspaceId, archivedOwnerWorkspaces });
    let plan = planWith(new Set());
    // Past owners' workspaces matter only when a subagent outlived its owner; asked for only then.
    if (plan.archive.some((entry) => entry.agent.labels[TARO_LABELS.role] !== "owner")) {
      const pastOwners = (await projectArchivedAgents(paseo, project).catch(() => [])).filter(
        (agent) => agent.labels[TARO_LABELS.role] === "owner" && doneTicketOf(agent.labels[TARO_LABELS.ticket], done) !== null,
      );
      plan = planWith(new Set(pastOwners.flatMap((agent) => (agent.workspaceId ? [agent.workspaceId] : []))));
    }

    let archivedAgents = 0;
    for (const { agent, ticket } of plan.archive) {
      const statsTicket = agent.labels[TARO_LABELS.ticket] ?? ticket;
      for (const target of new Set([statsTicket, ticket])) {
        await this.stats.agentUsage(project, target, agent.id, usageReading(agent.lastUsage)).catch(() => undefined);
      }
      if (!(await paseo.agents.ref(agent.id).archive().then(() => true, () => false))) continue;
      archivedAgents += 1;
      this.released.add(agent.id);
      await this.state.forgetAgent(agent.id);
    }
    // Paseo archives a workspace with every agent in it: keep one where any agent still lives (the
    // user's own, without Taro labels, or one whose archive just failed and is retried next time).
    const occupied =
      plan.workspaces.length === 0
        ? new Set<string>()
        : await listTaroAgents(paseo, {}).then(
            (all) => new Set(all.filter((agent) => !this.released.has(agent.id)).flatMap((agent) => (agent.workspaceId ? [agent.workspaceId] : []))),
            () => new Set(plan.workspaces),
          );
    let archivedWorkspaces = 0;
    for (const workspaceId of plan.workspaces.filter((candidate) => !occupied.has(candidate))) {
      await paseo.workspaces.archive(workspaceId).then(
        () => {
          archivedWorkspaces += 1;
        },
        (error: unknown) => {
          if (!isStopping()) console.warn(`[taro] could not archive workspace ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
        },
      );
    }
    // Questions about a finished ticket are moot.
    const finished = new Set([...newlyDone, ...plan.archive.map((entry) => entry.ticket), ...plan.waiting.flatMap((agent) => doneTicketOf(agent.labels[TARO_LABELS.ticket], done) ?? [])]);
    if (finished.size > 0) {
      await this.state.updateDecisions((decisions) => {
        for (const decision of decisions) {
          if (decision.project === project && decision.status === "open" && decision.ticket !== null && doneTicketOf(decision.ticket, finished) !== null) decision.status = "withdrawn";
        }
      });
    }
    if (plan.archive.length > 0 || newlyDone.length > 0) {
      const tickets = [...new Set([...newlyDone, ...plan.archive.map((entry) => entry.ticket)])].join(", ");
      const failed = plan.archive.length - archivedAgents;
      const kept = plan.workspaces.filter((candidate) => occupied.has(candidate)).length;
      console.log(
        `[taro] ${project}: ${tickets}: archived ${archivedAgents} agents and ${archivedWorkspaces} workspaces` +
          (failed > 0 ? `; ${failed} failed to archive, retried on the next release` : "") +
          (kept > 0 ? `; kept ${kept} workspaces another agent still uses` : "") +
          `; ${plan.waiting.length} mid-turn, archived when their turn ends`,
      );
    }
  }

  /**
   * Tells the manager when a ticket is Done (tickets may depend on it) or stops holding an owner slot
   * (Awaiting acceptance counts as free, TR-029), unless nothing could start: no dependents cleared
   * by a Done, and no queued ticket or no room under the cap. The dependents are listed either way
   * (TR-043); they wake the manager only once the ticket is Done. The message carries the plugin's
   * recount (TR-062).
   */
  private async wakeManager(paseo: PaseoApi, project: string, change: StatusChange, tickets: readonly TicketSummary[], whenHeld: () => () => void): Promise<void> {
    const queued = queuedTickets(tickets).map((candidate) => candidate.id);
    const cleared = change.status === "Done";
    // Reading every open ticket's dependencies is a file read each: only when a message may follow.
    if (!cleared && (!change.freesSlot || queued.length === 0)) return;
    const paths = await projectPaths(project);
    const dependents: string[] = [];
    for (const candidate of tickets.filter((open) => open.status !== "Done" && open.status !== "Cancelled")) {
      const detail = await viewTicket(paths.tracker, candidate.id).catch(() => null);
      if (detail !== null && dependsOn(detail.dependencies, change.ticket)) dependents.push(candidate.id);
    }
    const dependentsCleared = cleared ? dependents.length : 0;
    // Only the cap comparison needs the owners, and listing them is a round trip to the daemon.
    if (dependentsCleared === 0 && (!change.freesSlot || queued.length === 0)) return;
    const config = await requireProjectConfig(project);
    const count = await this.recountQueue(paseo, project, tickets, config.maxParallelOwners);
    if (!shouldWakeManager({ dependents: dependentsCleared, queued: queued.length, freesSlot: change.freesSlot, counting: count.counting.length, cap: config.maxParallelOwners })) return;
    const manager = await fetchLiveAgent(paseo, config.managerAgentId);
    if (manager === null) return;
    const text = await message(TEMPLATES.dependencyCleared, {
      ticket: change.ticket,
      status: change.status,
      dependents: dependents.length === 0 ? "none" : dependents.join(", "),
      recount: await recountText(count),
    });
    // Held while threads are short (TR-012): a free owner slot is no reason to start one then.
    let sent = false;
    let delivered: (() => void) | null = null;
    await this.recovery.tellManagerWhenHeadroom(paseo, project, manager.id, text, () => {
      sent = true;
      delivered?.();
      this.woken(project, count, "a slot freed or a dependency cleared");
    });
    if (!sent) delivered = whenHeld();
  }

  /** The plugin's recount (TR-062): owners from Paseo, the queue from the tracker, threads from the host. */
  private async recountQueue(paseo: PaseoApi, project: string, tickets: readonly TicketSummary[], cap: number, withOwners = false): Promise<Recount> {
    const paths = await projectPaths(project);
    const queued: QueuedTicket[] = [];
    for (const ticket of queuedTickets(tickets)) {
      const key = `${project}:${ticket.id}`;
      const cached = this.queuedDetails.get(key);
      if (cached !== undefined && ticket.updatedAt !== null && cached.updatedAt === ticket.updatedAt) {
        queued.push(cached.ticket);
        continue;
      }
      const detail = await viewTicket(paths.tracker, ticket.id);
      const entry = { id: ticket.id, dependencies: detail.dependencies, notes: detail.implementationNotes ?? null };
      if (ticket.updatedAt !== null) this.queuedDetails.set(key, { updatedAt: ticket.updatedAt, ticket: entry });
      queued.push(entry);
    }
    // With nothing queued only a resume needs the count (TR-088); a wake-up does not.
    const counted = withOwners || queued.length > 0;
    const owners = !counted ? [] : (await projectAgents(paseo, project)).filter((agent) => agent.labels[TARO_LABELS.role] === "owner");
    const headroom = !counted ? null : await readHeadroom();
    return recount({ owners, tickets, queued, cap, threads: headroom === null ? null : { current: headroom.current, max: headroom.max } });
  }

  private queueWatch(project: string): QueueWatch {
    const existing = this.queues.get(project);
    if (existing !== undefined) return existing;
    const watch = emptyQueueWatch();
    this.queues.set(project, watch);
    return watch;
  }

  /**
   * The ladder with its restarts and dismissals merged in from disk the first time (after a start or
   * reload), whichever path created it first; every save goes through here, so none overwrites them.
   */
  private async loadQueueWatch(project: string): Promise<QueueWatch> {
    const watch = this.queueWatch(project);
    if (this.ladderLoaded.has(project)) return watch;
    const stored = await this.state.queueLadder(project).catch(() => null);
    if (!this.ladderLoaded.has(project)) {
      this.ladderLoaded.add(project);
      for (const at of stored?.restarts ?? []) if (!watch.restarts.includes(Date.parse(at))) watch.restarts.push(Date.parse(at));
      for (const id of stored?.dismissed ?? []) watch.dismissed.add(id);
    }
    return watch;
  }

  private async saveQueueWatch(project: string, watch: QueueWatch): Promise<void> {
    await this.state.saveQueueLadder(project, { restarts: watch.restarts.map((at) => new Date(at).toISOString()), dismissed: [...watch.dismissed] }).catch((error: unknown) => {
      console.error(`[taro] storing ${project}'s queue ladder:`, error);
    });
  }

  /** A wake-up naming the startable tickets went out: the ladder starts, and each ticket's first one is logged on it. */
  private woken(project: string, count: Recount, why: string): void {
    const first = markWoken(this.queueWatch(project), count, Date.now());
    if (first.length === 0) return;
    const fields = recountFields(count);
    console.log(`[taro] ${project}: told the manager ${first.join(", ")} could start (${why}; owners ${fields.counting} of ${fields.cap}, threads ${fields.threads})`);
    void this.noteTickets(
      project,
      first,
      `QUEUE-WAKE ${new Date().toISOString()} — the plugin told the manager this ticket could start (${why}): owners counting ${fields.counting} of ${fields.cap} (${fields.countingTickets}), threads ${fields.threads}, startable ${fields.startable}.`,
    );
  }

  private async noteTickets(project: string, tickets: readonly string[], record: string): Promise<void> {
    const paths = await projectPaths(project).catch(() => null);
    if (paths === null) return;
    for (const ticket of tickets) {
      try {
        await appendTicketNote(paths.tracker, ticket, record);
      } catch (error: unknown) {
        console.warn(`[taro] could not record on ${ticket}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** New Queued tickets that could start now, with the manager idle: it may have miscounted (TR-062). */
  private async wakeForNewTickets(paseo: PaseoApi, project: string, tickets: readonly TicketSummary[], lastLook: ReadonlyMap<string, string>): Promise<void> {
    const config = await requireProjectConfig(project);
    const count = await this.recountQueue(paseo, project, tickets, config.maxParallelOwners);
    const fresh = newlyQueuedStartable(lastLook, count);
    const watch = this.queueWatch(project);
    if (fresh.length === 0 || watch.wokenFor === situationKey(count)) return;
    // A manager mid-turn is most likely dispatching the ticket it just filed; the minute check follows up.
    const manager = await fetchLiveAgent(paseo, config.managerAgentId);
    if (manager === null || manager.status !== "idle") return;
    trackQueue(watch, count, Date.now());
    const text = await message(TEMPLATES.ticketQueued, { tickets: fresh.join(", "), recount: await recountText(count) });
    await this.recovery.tellManagerWhenHeadroom(paseo, project, manager.id, text, () => this.woken(project, count, "a ticket was filed while a slot is free"));
  }

  /**
   * The minute check (TR-062), on TR-050's timer: for each project, recounts the queue, wakes an
   * idle manager once per situation, and climbs the ladder for tickets it still has not dispatched.
   * Returns whether any project's alerts may have changed.
   */
  async checkQueues(paseo: PaseoApi, now: number = Date.now()): Promise<boolean> {
    if (this.checkingQueues) return false;
    this.checkingQueues = true;
    let changed = false;
    try {
      for (const config of await listProjectConfigs()) {
        // One at a time with the project's tracker passes, so a new ticket's wake-up and this one never cross.
        const check = serialized(`tracker-changed:${config.project}`, () => this.checkQueue(paseo, config.project, now));
        changed = (await check.catch((error: unknown) => {
          reportFailure(`[taro] queue check for ${config.project} failed:`, error);
          return false;
        })) || changed;
      }
    } finally {
      this.checkingQueues = false;
    }
    return changed;
  }

  private async checkQueue(paseo: PaseoApi, project: string, now: number): Promise<boolean> {
    // Pauses run out and queued resumes take freed slots on the same minute, before the manager hears of a slot (TR-088).
    const paused = await this.advancePauses(paseo, project, now).catch((error: unknown) => {
      reportFailure(`[taro] pause check for ${project} failed:`, error);
      return false;
    });
    return (await this.checkQueueAfterPauses(paseo, project, now)) || paused;
  }

  private async checkQueueAfterPauses(paseo: PaseoApi, project: string, now: number): Promise<boolean> {
    const config = await requireProjectConfig(project);
    const paths = await projectPaths(project);
    const tickets = await listTickets(paths.tracker);
    const count = await this.recountQueue(paseo, project, tickets, config.maxParallelOwners);
    const watch = await this.loadQueueWatch(project);
    const alertsBefore = this.queueAlertKey(project, watch, now);
    const storedBefore = ladderSnapshot(watch);
    trackQueue(watch, count, now);
    if (ladderSnapshot(watch) !== storedBefore) await this.saveQueueWatch(project, watch);
    if (watch.queuedAt.size === 0) return alertsBefore !== "";

    const manager = await fetchLiveAgent(paseo, config.managerAgentId);
    const managerState = manager === null ? null : await this.state.agent(manager.id);
    const lastTurnEnded = managerState?.lastTurnEndedAt ?? null;
    if (
      manager !== null &&
      shouldWakeIdleManager({
        count,
        managerMidTurn: manager.status !== "idle",
        lastTurnEndedAt: lastTurnEnded === null ? null : Date.parse(lastTurnEnded),
        lastWokenFor: watch.wokenFor,
        now,
      })
    ) {
      const text = await message(TEMPLATES.queueIdle, { tickets: count.startable.join(", "), recount: await recountText(count) });
      await this.recovery.tellManagerWhenHeadroom(paseo, project, manager.id, text, () => this.woken(project, count, "the manager was idle with a ticket that could start"));
    }

    const alerted = newlyAlerted(watch, now);
    if (alerted.length > 0) {
      console.warn(`[taro] ${project}: ${alerted.join(", ")} queued with a free slot and not dispatched; alert raised`);
      await this.noteTickets(project, alerted, `QUEUE-ALERT ${new Date(now).toISOString()} — still queued with a free slot after the manager was told; the board and Inbox show an alert.`);
    }

    const condition = managerCondition(manager === null ? null : { status: manager.status, updatedAt: manager.updatedAt, stalled: managerState?.stalled ?? false }, now);
    this.managerConditions.set(project, condition);
    const withheld = newlyWithheld(watch, count, condition, now);
    if (withheld.length > 0) {
      console.warn(`[taro] ${project}: ${withheld.join(", ")} still queued with a free slot; not restarting the manager, as the ladder already did within the hour`);
      await this.noteTickets(project, withheld, `QUEUE-RESTART ${new Date(now).toISOString()} — still queued with a free slot, but the plugin already restarted the manager within the hour, so it does not again; the alert stays up.`);
    }
    let due = restartDue(watch, count, condition, now);
    // The user may have answered the alert in the manager's own tab, which Taro does not see: its timeline does.
    if (due.length > 0 && manager !== null) {
      const typed = await this.lastTypedToManager(paseo, manager.id);
      if (typed === undefined) due = [];
      else if (typed !== null && typed >= (alertRaisedAt(watch, due) ?? now)) {
        watch.userToldManagerAt = Math.max(watch.userToldManagerAt ?? typed, typed);
        due = restartDue(watch, count, condition, now);
      }
    }
    if (due.length > 0) await this.restartForQueue(paseo, project, manager, due, count, condition, now);
    return alerted.length > 0 || this.queueAlertKey(project, watch, now) !== alertsBefore || due.length > 0;
  }

  /**
   * What the queued alert says, to tell whether this check changed it: its tickets and the manager's
   * condition its text follows, not the text itself, whose minutes tick on every check.
   */
  private queueAlertKey(project: string, watch: QueueWatch, now: number): string {
    const condition = this.managerConditions.get(project) ?? "busy";
    return queuedAlerts(watch, now, condition)
      .map((alert) => `${condition}:${alert.tickets.join(",")}`)
      .join("\n");
  }

  /** When the user last typed to the manager themselves; undefined when its timeline cannot be read (no restart on a guess). */
  private async lastTypedToManager(paseo: PaseoApi, managerId: string): Promise<number | null | undefined> {
    const page = await paseo.agents
      .ref(managerId)
      .timeline.refetch({ direction: "tail", limit: 40, projection: "projected" })
      .catch(() => null);
    return page === null ? undefined : lastHumanMessageAt(page.entries);
  }

  /** The ladder's last step: a fresh manager through the usual restart, told why and given the recount. */
  private async restartForQueue(paseo: PaseoApi, project: string, manager: PaseoAgent | null, due: readonly string[], count: Recount, condition: string, now: number): Promise<void> {
    const watch = await this.loadQueueWatch(project);
    const start = Math.min(...due.map((id) => watch.wokenAt.get(id) ?? watch.queuedAt.get(id) ?? now));
    const why = await message(TEMPLATES.managerQueueRestart, {
      tickets: due.join(", "),
      minutes: String(Math.floor((now - start) / 60_000)),
      handoff: await managerHandoffPath(project),
      recount: await recountText(count),
    });
    const at = new Date(now).toISOString();
    try {
      const restarted = await restartManager(paseo, project, { why, evenMidTurn: condition === "unresponsive" && manager !== null && isMidTurn(manager) });
      markRestarted(watch, due, count, now, true);
      await this.saveQueueWatch(project, watch);
      console.warn(`[taro] ${project}: restarted the ${condition} manager ${manager?.id ?? "?"} as ${restarted.agentId}: ${due.join(", ")} stayed queued with a free slot`);
      await this.noteTickets(project, due, `QUEUE-RESTART ${at} — still queued with a free slot 20 minutes after the manager was told; the plugin restarted the ${condition} manager ${manager?.id ?? "?"} as ${restarted.agentId} (at most one such restart per project an hour).`);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      markRestarted(watch, due, count, now, false);
      await this.saveQueueWatch(project, watch);
      if (!isStopping()) console.error(`[taro] ${project}: restarting the manager for ${due.join(", ")} failed: ${reason}`);
      await this.noteTickets(project, due, `QUEUE-RESTART ${at} — the plugin tried to restart the manager for this queued ticket and failed (${reason}); the alert stays up.`);
    }
  }

  /** The queued-with-a-free-slot alerts for a project's board and Inbox. */
  queueAlerts(project: string, now: number = Date.now()): BoardAlert[] {
    const watch = this.queues.get(project);
    // An alert needs ten minutes of minute checks, each recording the condition; "busy" covers only failed ones.
    return watch === undefined ? [] : queuedAlerts(watch, now, this.managerConditions.get(project) ?? "busy");
  }

  /** The user dismissed the alert for these tickets: it comes down and the ladder stops for them until they leave the queue. */
  async dismissQueueAlert(project: string, tickets: readonly string[]): Promise<void> {
    const watch = await this.loadQueueWatch(project);
    for (const ticket of tickets) watch.dismissed.add(ticket);
    await this.saveQueueWatch(project, watch);
    console.log(`[taro] ${project}: the user dismissed the queued alert for ${tickets.join(", ")}`);
  }

  /** The user sent the manager a message from Taro: acting on an alert that way stops the restart. */
  userToldManager(project: string, now: number = Date.now()): void {
    this.queueWatch(project).userToldManagerAt = now;
  }

  /** Statuses this plugin knows; used to sanity-check a ticket a user moved by hand. */
  static readonly statuses = TICKET_STATUSES;

  /** Commits now (after the plugin wrote to the tracker itself). */
  async commit(project: string): Promise<void> {
    await this.trackers.commit(project);
  }
}

async function recountText(count: Recount): Promise<string> {
  return message(TEMPLATES.recount, recountFields(count));
}

/** What of the ladder is kept on disk, to tell whether it changed. */
function ladderSnapshot(watch: QueueWatch): string {
  return JSON.stringify([watch.restarts, [...watch.dismissed].sort()]);
}
