/**
 * The plugin's share of supervision (decisions 28, 30, 35, 36, 37), driven by
 * `agent.turn_ended`. No model turns: it reads what agents wrote (from their
 * timeline: since Paseo 0.13.0 the hook's own is always empty), stores
 * decisions and status lines, delivers subagents' reports to the ticket's current
 * owner, nudges a stalled owner once, and runs the compaction pipeline.
 */
import { join } from "node:path";

import { asksToAccept, deliveryEndedRecord, deliveryTakenBackRecord, questionEndingDelivery, questionOpenAtDelivery } from "../shared/delivery-end";
import { idleCompactionAfterTurn, idleCompactionDue } from "../shared/idle-compaction";
import { isSubagentRole, roleFromLabel, TARO_LABELS, type Role } from "../shared/project";
import { CHAT_MESSAGE_PREFIX } from "../shared/pending-sends";
import { SCOPE_APPROVAL } from "../shared/decision-view";
import { deliveryMissing } from "../shared/execution";
import { remindsAtCount, waitsPrematurely } from "../shared/premature-wait";
import { ACCEPT_STALL_LIMIT, acceptHandoffOpen, acceptStallReason } from "../shared/accept-stall";
import { pullRequestUrl } from "../shared/execution";
import { runCommand } from "./process";
import { lacksPlan, mayBuildBeforePlan, noPlanRecord } from "../shared/no-plan";
import { approvalGate, buildGap, gateRecord, noApprovalRecord, parentTicketId, workApproved, type BuildGap } from "../shared/approval-gate";
import { asPlanningQuestion, asStored, planningTicket } from "../shared/planning-questions";
import type { DrainTrigger } from "../shared/chat-queue";
import { receivedMessage } from "../shared/received-message";
import { isCrash } from "../shared/recovery";
import { hashText, parseDecisionBlocks, parseStatusLine, sameQuestion, seenAgain, withImagePaths, type ParsedDecision } from "../shared/reports";
import { openQuestionHolding, withdrawOpenDecisions, type AgentState, type HeldReport, type StoredDecision } from "../shared/state";
import { watchTrimmedTurn } from "./agent-trim";
import { fetchLiveAgent, isMidTurn, listTaroAgents } from "./agents";
import { branchName, commitsPast } from "./branch-commits";
import type { HookAgent, PaseoAgent, PaseoApi, TimelineItem, TimelinePage, TurnOutcome } from "./host-types";
import { mockupsMissing, ticketEvidence, ticketEvidenceDirectory } from "./evidence";
import { TEMPLATES, message, skillDirectory } from "./package-files";
import { projectPaths, readProjectConfig } from "./projects";
import { appendTicketNote, endDelivery, viewTicket } from "./tickets";
import { isPluginMessageId, sendCommand, sendFromPlugin } from "./send";
import type { ChatQueue } from "./chat-queue";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import { usageReading, type Stats } from "./stats";

export interface TaroIdentity {
  project: string;
  role: Role;
  ticket: string | null;
  title: string | null;
}

export function identityFromLabels(labels: Readonly<Record<string, string>>, title: string | null): TaroIdentity | null {
  const project = labels[TARO_LABELS.project];
  const role = roleFromLabel(labels[TARO_LABELS.role]);
  if (project === undefined || project === "" || role === null) return null;
  const ticket = labels[TARO_LABELS.ticket];
  return { project, role, ticket: ticket === undefined || ticket === "" ? null : ticket, title };
}

/** The assistant messages at the very end of the turn, joined: a streamed reply arrives in pieces. */
export function closingText(timeline: readonly TimelineItem[]): string {
  const pieces: string[] = [];
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item === undefined) continue;
    if (item.type === "assistant_message") pieces.unshift(item.text);
    else if (item.type === "reasoning" || item.type === "compaction") continue;
    else if (pieces.length > 0) break;
  }
  return pieces.join("");
}

/** What the user said in this turn: user messages the plugin did not send. */
export function humanMessages(timeline: readonly TimelineItem[]): string[] {
  return timeline.flatMap((item) => (item.type === "user_message" && !isPluginMessageId(item.clientMessageId) && !isPluginMessageId(item.messageId) ? [item.text] : []));
}

/**
 * What the user typed in the agent's own tab this turn: their words, less those sent from a Taro chat
 * (`chat-` ids). Words in the manager's tab answer its open decisions; a chat message does not (TR-102):
 * the chat shows each decision as a card with its own answer box, and a message sent beside it, while it
 * is pending, closed the card and was recorded as its answer.
 */
export function tabMessages(timeline: readonly TimelineItem[]): string[] {
  return timeline.flatMap((item) =>
    item.type === "user_message" && !isPluginMessageId(item.clientMessageId) && !isPluginMessageId(item.messageId) && !isChatMessageId(item.clientMessageId) ? [item.text] : [],
  );
}

function isChatMessageId(messageId: string | undefined): boolean {
  return messageId !== undefined && messageId.startsWith(CHAT_MESSAGE_PREFIX);
}

/** When the user last typed to the agent themselves (not a message the plugin sent), from timeline entries; null if never. */
export function lastHumanMessageAt(entries: readonly { item: TimelineItem; timestamp: string }[]): number | null {
  let last: number | null = null;
  for (const entry of entries) {
    if (humanMessages([entry.item]).length === 0) continue;
    const at = Date.parse(entry.timestamp);
    if (!Number.isNaN(at) && (last === null || at > last)) last = at;
  }
  return last;
}

/** Every assistant message of the turn, for decision blocks anywhere in it. */
export function allAssistantText(timeline: readonly TimelineItem[]): string {
  return timeline.flatMap((item) => (item.type === "assistant_message" ? [item.text] : [])).join("");
}

/** Whether an item opens a turn: a user message, or one another agent sent (Paseo 0.12.0 logs an agent's starting prompt that way). */
function opensTurn(item: TimelineItem): boolean {
  return item.type === "user_message" || receivedMessage(item) !== null;
}

/** The turn that just ended: from the last opening message on (the whole timeline when there is none). */
export function currentTurn(timeline: readonly TimelineItem[]): readonly TimelineItem[] {
  const lastOpening = timeline.map(opensTurn).lastIndexOf(true);
  return timeline.slice(lastOpening === -1 ? 0 : lastOpening);
}

/**
 * Which turn this is, from the message that opened it and everything the agent wrote in it, so a block
 * seen again is told from the same block asked again in a later turn (TR-108). Message ids are left
 * out, as the hook's timeline and Paseo's projected page may not both carry them. Null when the turn's
 * opening is not there (a page that starts mid-turn).
 */
export function turnIdentity(turn: readonly TimelineItem[]): string | null {
  const opening = turn[0];
  if (opening === undefined) return null;
  const openingText = opening.type === "user_message" ? opening.text : receivedMessage(opening)?.text;
  if (openingText === undefined) return null;
  return hashText(JSON.stringify([openingText, allAssistantText(turn)]));
}

/** What the agent wrote before the current turn, to tell a later ask from a replay for a decision stored without a turn (TR-221). */
function earlierText(timeline: readonly TimelineItem[], turn: readonly TimelineItem[]): string {
  return allAssistantText(timeline.slice(0, timeline.length - turn.length));
}

type TimelineEntry = TimelinePage["entries"][number];

/**
 * The entries up to the last one of the turn the hook named: a turn that started since (a queued
 * message sent at once) is not the one that ended. All of them when none carries that id.
 */
export function throughTurn(entries: readonly TimelineEntry[], turnId: string | null): TimelineItem[] {
  const last = turnId === null ? -1 : entries.map((entry) => entry.turnId === turnId).lastIndexOf(true);
  return (last === -1 ? entries : entries.slice(0, last + 1)).map((entry) => entry.item);
}

/**
 * The end of an agent's projected timeline, reaching back to the message that opened its latest turn
 * (or the turn `turnId` names): without it the turn has no identity, and a re-ask in a long turn would
 * be taken for a replay (TR-108). Bounded, as the very first turn may have no such message at all.
 */
async function latestTurnItems(paseo: PaseoApi, agentId: string, turnId: string | null = null): Promise<TimelineItem[] | null> {
  const timeline = paseo.agents.ref(agentId).timeline;
  let page = await timeline.refetch({ direction: "tail", limit: 40, projection: "projected" }).catch(() => null);
  if (page === null) return null;
  let entries = page.entries;
  let items = throughTurn(entries, turnId);
  for (let older = 0; older < 10 && !items.some(opensTurn); older++) {
    if (!page.hasOlder || page.startCursor === null) break;
    page = await timeline.refetch({ direction: "before", cursor: page.startCursor, limit: 40, projection: "projected" }).catch(() => null);
    if (page === null) break;
    entries = [...page.entries, ...entries];
    items = throughTurn(entries, turnId);
  }
  return items;
}

/** How long a turn end waits before reading the turn again after a failed read. */
export const TURN_READ_RETRY_MS = 1_000;

/** The turn the hook named, read once more a moment later if the first read fails: an unread turn loses its status line, card or report. */
async function readEndedTurn(paseo: PaseoApi, agentId: string, turnId: string | null): Promise<TimelineItem[] | null> {
  const first = await latestTurnItems(paseo, agentId, turnId);
  if (first !== null) return first;
  await new Promise((resolve) => setTimeout(resolve, TURN_READ_RETRY_MS));
  return latestTurnItems(paseo, agentId, turnId);
}

/** The plugin log's line for a Taro agent's turn end: what supervision read, so a missed status line or card can be traced. */
export function turnEndLine(agentId: string, outcome: TurnOutcome["kind"], turnId: string | null, read: { items: number; turn: number } | null, status: ReturnType<typeof parseStatusLine>, decisions: readonly ParsedDecision[]): string {
  const head = `[taro] ${agentId} turn ended (${outcome}, ${turnId ?? "no turn id"})`;
  if (read === null) return `${head}: its timeline could not be read, so no status line or decision was looked for and no nudge is sent`;
  const found = decisions.length === 0 ? "none" : decisions.map((decision) => decision.id).join(", ");
  return `${head}: read ${read.items} items, ${read.turn} in this turn; status ${status === null ? "none" : status.state}; decisions ${found}`;
}

/**
 * Whether the provider compacted this turn on its own. The timeline read reaches back past the turn,
 * so only the current turn counts, or every later turn (the reload included) would reload again.
 * Claude marks it `trigger: "auto"`; Codex sets only "manual", so its automatic ones carry none.
 */
export function autoCompactedThisTurn(timeline: readonly TimelineItem[]): boolean {
  return currentTurn(timeline).some((item) => item.type === "compaction" && item.status === "completed" && item.trigger !== "manual");
}

/** The manager has no ticket: its handoff is a file in the project's home, beside its AGENTS.md. */
export async function managerHandoffPath(project: string): Promise<string> {
  return join((await projectPaths(project)).home, "manager-handoff.md");
}

/** Step 3 of compaction, and what the SessionStart hook prints after any compaction (TR-101). */
export async function reloadText(identity: TaroIdentity): Promise<string> {
  if (identity.role === "manager") {
    return message(TEMPLATES.managerReload, { skill: await skillDirectory(), handoff: await managerHandoffPath(identity.project) });
  }
  return message(TEMPLATES.reload, { skill: await skillDirectory(), ticket: identity.ticket ?? "your ticket" });
}

/** Step 2: what /compact keeps. The manager has no ticket or HANDOFF record, so its own list (TR-101). */
async function compactInstructions(identity: TaroIdentity): Promise<string> {
  if (identity.role === "manager") return message(TEMPLATES.managerCompactInstructions, { handoff: await managerHandoffPath(identity.project) });
  return message(TEMPLATES.compactInstructions);
}

export function freshState(identity: TaroIdentity): AgentState {
  return {
    project: identity.project,
    role: identity.role,
    ticket: identity.ticket,
    title: identity.title,
    lastStatus: null,
    stallCount: 0,
    stalled: false,
    stalledReason: null,
    recoveries: [],
    deliveredTurns: [],
    heldReports: [],
    compaction: "none",
    idleCompaction: "none",
    lastTurnEndedAt: null,
    evidenceReminded: null,
    noPlanFlagged: false,
    noApprovalFlagged: false,
    prematureWaits: 0,
    deliveryReminded: null,
    acceptStalls: 0,
  };
}

/** The live owner of a ticket now: the creator if it is an owner, else by label, else the parent ticket's owner. */
export async function currentOwner(paseo: PaseoApi, project: string, ticket: string | null, parentAgentId: string | null): Promise<PaseoAgent | null> {
  if (parentAgentId !== null) {
    const parent = await fetchLiveAgent(paseo, parentAgentId);
    if (parent !== null && parent.labels[TARO_LABELS.role] === "owner") return parent;
  }
  if (ticket === null) return null;
  const candidates = [ticket];
  const parentTicket = /^(.*)\.\d+$/.exec(ticket)?.[1];
  if (parentTicket !== undefined) candidates.push(parentTicket);
  for (const candidate of candidates) {
    const owners = await listTaroAgents(paseo, { [TARO_LABELS.project]: project, [TARO_LABELS.role]: "owner", [TARO_LABELS.ticket]: candidate });
    const live = owners.filter((owner) => owner.status !== "closed").sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (live[0] !== undefined) return live[0];
  }
  return null;
}

export class Supervisor {
  constructor(
    private readonly state: PluginState,
    private readonly stats: Stats,
    private readonly recovery: Recovery,
    private readonly queue: Pick<ChatQueue, "drain" | "hasQueued"> | null = null,
  ) {}

  /** Whether the user's messages wait in the agent's queue: they go before held reports (TR-171). */
  private async userMessagesQueued(agentId: string): Promise<boolean> {
    if (this.queue === null) return false;
    return this.queue.hasQueued(agentId).catch(() => false);
  }

  /** The user's next queued chat message as the agent's next prompt (TR-171); whether it went. */
  private async drainQueue(paseo: PaseoApi, agentId: string, trigger: DrainTrigger): Promise<boolean> {
    if (this.queue === null) return false;
    return this.queue.drain(paseo, agentId, trigger).catch((error: unknown) => {
      console.warn(`[taro] draining ${agentId}'s chat queue: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
  }

  async onTurnEnded(paseo: PaseoApi, hookAgent: HookAgent, outcome: TurnOutcome, turnId: string | null, activeMs: number | undefined): Promise<void> {
    const live = await fetchLiveAgent(paseo, hookAgent.id);
    if (live === null) return;
    const identity = identityFromLabels(live.labels, live.title ?? null);
    if (identity === null) return;
    const model = live.model === null || live.model === undefined ? live.provider : `${live.provider}/${live.model}`;
    await this.stats.turnEnded(identity.project, identity.ticket, { id: live.id, role: identity.role, model, title: identity.title }, activeMs, usageReading(live.lastUsage)).catch(() => undefined);
    const now = new Date().toISOString();
    // Since Paseo 0.13.0 the hook's timeline is always empty (TR-233): the turn is read from the
    // agent's own, as Paseo's types direct. Null when that read failed: nothing is known of the turn.
    const read = await readEndedTurn(paseo, live.id, turnId);
    const timeline = read ?? [];
    // Only the turn that ended: earlier turns' blocks would reopen answered decisions, their user words
    // would close new ones, and a turn without text would reuse their reply.
    const turn = currentTurn(timeline);
    // What a trimmed owner or subagent reached for that Taro removed, and what it started with (TR-139).
    await watchTrimmedTurn(this.stats, live, identity, turn).catch((error: unknown) => {
      console.warn(`[taro] watching ${live.id}'s tools: ${error instanceof Error ? error.message : String(error)}`);
    });
    const closing = closingText(turn);
    // Reports are deduplicated by their text: turn ids ("foreground-turn-1") may repeat, and the
    // reconcile after a restart must recognise a report the hook already delivered.
    const turnKey = hashText(closing);

    const status = parseStatusLine(closing);
    const decisions = parseDecisionBlocks(allAssistantText(turn));
    console.log(turnEndLine(live.id, outcome.kind, turnId, read === null ? null : { items: timeline.length, turn: turn.length }, status, decisions));
    // Only the manager's tab: an owner's also takes the manager's `paseo send`, which Paseo records just
    // like words the user typed, and it closed the owner's open cards (TR-134).
    const userWords = identity.role === "manager" ? tabMessages(turn) : [];
    if (userWords.length > 0) await this.closeAnsweredInTab(live.id, userWords, decisions, now);
    if (decisions.length > 0) await this.storeDecisions(paseo, live, identity, decisions, turnIdentity(turn), now, status?.state === "waiting", earlierText(timeline, turn));

    const openBlocking = (await this.state.allDecisions()).some(
      (decision) => decision.agentId === live.id && decision.status === "open" && decision.blocking,
    );
    const stage = await this.state.updateAgent(live.id, () => freshState(identity), (record) => {
      record.ticket = identity.ticket;
      record.title = identity.title;
      // Left as it was when the turn could not be read, so the reconcile after a restart reads it again.
      if (read !== null) record.lastTurnEndedAt = now;
      record.idleCompaction = idleCompactionAfterTurn(record.idleCompaction, record.compaction);
      if (status !== null) record.lastStatus = { ...status, at: now };
      // Working again after the plugin gave up on its crashes (the user restarted it by hand).
      if (outcome.kind === "completed" && record.stalledReason !== null) {
        record.stalled = false;
        record.stalledReason = null;
      }
      return record.compaction;
    });

    // A canceled turn may be the one Send now cut off: the queue knows, and holds its drain (TR-171).
    if (outcome.kind === "canceled") {
      await this.drainQueue(paseo, live.id, "canceled");
      return;
    }
    // Any role, the manager included (TR-012): a dead process gets no further turns on its own.
    // Nor a queued message: the recovery restarts it, and the turn end after drains.
    const failure = outcome.kind === "failed" ? (outcome.error?.message ?? "") : "";
    if (isCrash(failure)) {
      await this.recovery.onCrash(paseo, live, identity, failure);
      return;
    }

    if (isSubagentRole(identity.role)) {
      if (outcome.kind === "completed") {
        await this.deliverReport(paseo, live, identity, closing, turnKey, hookAgent.parentAgentId);
        await this.drainQueue(paseo, live.id, "completed");
      }
      return;
    }
    if (identity.role !== "owner" && identity.role !== "manager") return;

    // Compaction pipeline (decision 35): handoff → /compact → reload. The manager gets it only when idle (TR-015).
    if (stage === "handoff") {
      await this.setStage(live.id, identity, "compacting");
      await sendCommand(paseo, live.id, `/compact ${await compactInstructions(identity)}`);
      return;
    }
    if (stage === "compacting") {
      await this.setStage(live.id, identity, "none");
      await sendFromPlugin(paseo, live.id, await reloadText(identity));
      return;
    }
    if (identity.role === "owner" && autoCompactedThisTurn(timeline)) {
      await sendFromPlugin(paseo, live.id, await reloadText(identity));
      return;
    }
    // The user's queued message is the next prompt (TR-171); the nudge, held reports and reminders wait for its turn end.
    if (outcome.kind === "completed" && (await this.drainQueue(paseo, live.id, "completed"))) return;
    if (identity.role !== "owner") return;

    if (outcome.kind === "completed" && (await this.flagCommitsWithoutPlan(paseo, live, identity))) return;
    if (outcome.kind === "completed" && read !== null && (await this.finishAcceptHandoff(paseo, live, identity, openBlocking))) return;
    // A turn that could not be read is not taken for one without a status line.
    if (outcome.kind === "completed" && read !== null) {
      const stalled = (status === null || status.state === "working") && !openBlocking;
      const nudge = await this.state.updateAgent(live.id, () => freshState(identity), (record) => {
        if (!stalled) {
          record.stallCount = 0;
          record.stalled = false;
          record.stalledReason = null;
          return false;
        }
        record.stallCount += 1;
        record.stalled = record.stallCount >= 2;
        return record.stallCount === 1;
      });
      if (nudge) {
        if (identity.ticket !== null) await this.stats.count(identity.project, identity.ticket, "nudges").catch(() => undefined);
        await sendFromPlugin(paseo, live.id, await message(TEMPLATES.nudge));
        return;
      }
    }

    if (outcome.kind === "completed" && (await this.takeBackDeliveryWithOpenQuestion(paseo, live, identity))) return;
    if (await this.flushHeldReports(paseo, live.id)) return;
    if (outcome.kind === "completed" && (await this.remindAboutEvidence(paseo, live, identity))) return;
    if (outcome.kind === "completed" && (await this.remindAboutDelivery(paseo, live, identity))) return;
    if (outcome.kind === "completed" && read !== null && (await this.remindAboutPrematureWait(paseo, live, identity, status))) return;
    await this.maybeStartCompaction(paseo, live, identity);
  }

  /**
   * After a reload or restart (decision 37): re-read each idle Taro agent's
   * latest turn the plugin did not see end, rebuild its status line, and deliver
   * subagent reports that finished while the plugin was down. No nudges here.
   */
  async reconcile(paseo: PaseoApi, projects: readonly string[]): Promise<number> {
    let repaired = 0;
    for (const project of projects) {
      const agents = await listTaroAgents(paseo, { [TARO_LABELS.project]: project });
      // Agents archived (or removed) while the plugin was down: their questions can no longer be answered.
      const live = new Set(agents.map((agent) => agent.id));
      await this.state.updateDecisions((stored) => withdrawOpenDecisions(stored, (decision) => decision.project === project && !live.has(decision.agentId), true));
      repaired += await this.recovery.recoverLeftovers(paseo, agents);
      for (const agent of agents) {
        if (isMidTurn(agent) || agent.status === "closed") continue;
        const identity = identityFromLabels(agent.labels, agent.title ?? null);
        if (identity === null) continue;
        const known = await this.state.agent(agent.id);
        // Seen by the hook already (its clock and Paseo's differ by moments, hence the minute's slack).
        const seenAt = known?.lastTurnEndedAt === null || known?.lastTurnEndedAt === undefined ? Number.NaN : Date.parse(known.lastTurnEndedAt);
        if (!Number.isNaN(seenAt) && seenAt >= Date.parse(agent.updatedAt) - 60_000) continue;
        const items = await latestTurnItems(paseo, agent.id);
        if (items === null) continue;
        const turn = currentTurn(items);
        const closing = closingText(turn);
        const status = parseStatusLine(closing);
        await this.state.updateAgent(agent.id, () => freshState(identity), (record) => {
          record.lastTurnEndedAt = agent.updatedAt;
          if (status !== null) record.lastStatus = { ...status, at: agent.updatedAt };
        });
        const decisions = parseDecisionBlocks(allAssistantText(turn));
        if (decisions.length > 0) await this.storeDecisions(paseo, agent, identity, decisions, turnIdentity(turn), agent.updatedAt, status?.state === "waiting", earlierText(items, turn));
        if (isSubagentRole(identity.role)) {
          await this.deliverReport(paseo, agent, identity, closing, hashText(closing), agent.labels["paseo.parent-agent-id"] ?? null);
        }
        repaired += 1;
      }
    }
    return repaired;
  }

  /** An archived agent never reads an answer, whoever archived it: the plugin, the user, the CLI. */
  async withdrawDecisionsOf(agentId: string): Promise<number> {
    return this.state.updateDecisions((stored) => withdrawOpenDecisions(stored, (decision) => decision.agentId === agentId, true));
  }

  /**
   * An owner whose ticket is Awaiting acceptance without complete evidence is told what is missing,
   * once per distinct set; anything else clears the memory so a later gap is told again.
   */
  private async remindAboutEvidence(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity): Promise<boolean> {
    if (identity.ticket === null) return false;
    let missing: string[] = [];
    try {
      const detail = await viewTicket((await projectPaths(identity.project)).tracker, identity.ticket);
      if (detail.status === "Awaiting acceptance") {
        missing = (await ticketEvidence(identity.project, identity.ticket, detail.implementationNotes, detail.labels)).missing;
        // A trivial or low owner may build first (TR-241), but the Accept card shows its plan: it is due at delivery.
        if (mayBuildBeforePlan(detail.labels) && lacksPlan({ status: detail.status, plan: detail.implementationPlan, criteria: detail.acceptanceCriteria.length, labels: [] })) {
          missing = [...missing, "the plan: write it with `taro ticket edit --plan` (what you did and why, following the plan template); the Accept card shows it"];
        }
      }
    } catch {
      return false;
    }
    const key = missing.length === 0 ? null : missing.join("\n");
    const changed = await this.state.updateAgent(agent.id, () => freshState(identity), (record) => {
      if (record.evidenceReminded === key) return false;
      record.evidenceReminded = key;
      return key !== null;
    });
    if (!changed) return false;
    await sendFromPlugin(
      paseo,
      agent.id,
      await message(TEMPLATES.evidenceMissing, {
        ticket: identity.ticket,
        missing: missing.map((gap) => `- ${gap}`).join("\n"),
        folder: ticketEvidenceDirectory(identity.project, identity.ticket),
        skill: await skillDirectory(),
      }),
    );
    return true;
  }

  /**
   * An owner whose ticket is Awaiting acceptance without what Accept merges (TR-254: no review-head, or no PR
   * URL) is told so once per gap: the card holds Accept back, so nobody else would ask for it.
   */
  private async remindAboutDelivery(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity): Promise<boolean> {
    if (identity.ticket === null) return false;
    let missing: string | null = null;
    try {
      const detail = await viewTicket((await projectPaths(identity.project)).tracker, identity.ticket);
      const config = await readProjectConfig(identity.project);
      if (detail.status === "Awaiting acceptance" && config !== null && config !== undefined) {
        missing = deliveryMissing(config, detail.labels.includes("investigation"), detail.implementationNotes, detail.finalSummary);
      }
    } catch {
      return false;
    }
    const changed = await this.state.updateAgent(agent.id, () => freshState(identity), (record) => {
      if (record.deliveryReminded === missing) return false;
      record.deliveryReminded = missing;
      return missing !== null;
    });
    if (!changed || missing === null) return false;
    await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.deliveryMissing, { ticket: identity.ticket, missing, skill: await skillDirectory() }));
    return true;
  }

  /**
   * An owner that ends waiting for acceptance while its ticket is not Awaiting acceptance (TR-252) is told
   * what is missing: the first time, then with backoff while it keeps doing so. Any other ending resets it.
   */
  private async remindAboutPrematureWait(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity, status: ReturnType<typeof parseStatusLine>): Promise<boolean> {
    if (identity.ticket === null) return false;
    let missing: string[] = [];
    let ticketStatus = "";
    let premature = false;
    try {
      if (status !== null && status.state === "waiting") {
        const detail = await viewTicket((await projectPaths(identity.project)).tracker, identity.ticket);
        ticketStatus = detail.status;
        premature = waitsPrematurely(status, detail.status);
        if (premature) {
          if (lacksPlan({ status: detail.status, plan: detail.implementationPlan, criteria: detail.acceptanceCriteria.length, labels: [] })) {
            missing.push("the plan: write it with `taro ticket edit --plan` and get the user's approval where the ticket needs it");
          }
          missing = [...missing, ...(await ticketEvidence(identity.project, identity.ticket, detail.implementationNotes, detail.labels)).missing];
          if ((detail.finalSummary ?? "").trim() === "") missing.push("the FINAL summary: write it with `taro ticket edit --final-summary` (templates/final.md)");
          missing.push("the status step: move the ticket to Awaiting acceptance with `taro ticket edit -s \"Awaiting acceptance\"` together with it");
        }
      }
    } catch {
      return false;
    }
    const tell = await this.state.updateAgent(agent.id, () => freshState(identity), (record) => {
      if (!premature) {
        record.prematureWaits = 0;
        return false;
      }
      record.prematureWaits += 1;
      return remindsAtCount(record.prematureWaits);
    });
    if (!tell) return false;
    await sendFromPlugin(
      paseo,
      agent.id,
      await message(TEMPLATES.acceptingTooEarly, {
        ticket: identity.ticket,
        status: ticketStatus,
        missing: missing.map((gap) => `- ${gap}`).join("\n"),
        skill: await skillDirectory(),
      }),
    );
    return true;
  }

  /**
   * The owner an Accept was handed to (TR-141) that ends its turn with the ticket still waiting on the merge
   * (TR-256) is told to finish it, each time. After ACCEPT_STALL_LIMIT such turns in a row the user is asked
   * instead (NOT-MERGED puts the card back in Needs you with Accept offered), as nothing else would retry.
   */
  private async finishAcceptHandoff(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity, openBlocking: boolean): Promise<boolean> {
    if (identity.ticket === null || openBlocking) return false;
    const tracker = (await projectPaths(identity.project)).tracker;
    let pullRequest = "";
    let open = false;
    try {
      const detail = await viewTicket(tracker, identity.ticket);
      open = detail.status === "Awaiting acceptance" && acceptHandoffOpen(detail.implementationNotes);
      const url = open ? pullRequestUrl(detail.implementationNotes, detail.finalSummary) : null;
      if (url === null) pullRequest = "No pull request is recorded for this ticket (a local-branch delivery).";
      else {
        const view = await runCommand("gh", ["pr", "view", url, "--json", "state,mergeable"], { timeoutMs: 60_000 }).catch(() => null);
        pullRequest = view !== null && view.code === 0 ? `Pull request ${url} now reads ${view.stdout.trim().replace(/\s+/g, " ")}.` : `Pull request ${url} could not be read.`;
      }
    } catch {
      return false;
    }
    let turns = 0;
    await this.state.updateAgent(agent.id, () => freshState(identity), (record) => {
      turns = open ? record.acceptStalls + 1 : 0;
      // At the limit the count starts over, so the next hand-off's owner is told again before the user is.
      record.acceptStalls = turns >= ACCEPT_STALL_LIMIT ? 0 : turns;
      return false;
    });
    if (!open) return false;
    if (turns >= ACCEPT_STALL_LIMIT) {
      await appendTicketNote(tracker, identity.ticket, `NOT-MERGED ${new Date().toISOString()} — ${acceptStallReason(turns, pullRequest === "" ? "no pull request is recorded" : pullRequest.replace(/\.$/, ""))}`).catch(() => undefined);
      // The card is back with the user: no nudge or stall reminder on top of it.
      return true;
    }
    await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.acceptUnfinished, { ticket: identity.ticket, pullRequest, skill: await skillDirectory() }));
    return true;
  }

  /**
   * An owner whose branch has commits while its ticket has no plan (TR-206) gets a NO-PLAN record on
   * the ticket and is told to stop and plan; with a plan the round has not approved (TR-263), a
   * NO-APPROVAL record and a stop until it is. Once per gap. Git runs only when there is a gap.
   */
  private async flagCommitsWithoutPlan(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity): Promise<boolean> {
    if (identity.ticket === null) return false;
    let gap: BuildGap | null;
    let found: { commits: number; branch: string; base: string } | null = null;
    try {
      const tracker = (await projectPaths(identity.project)).tracker;
      const detail = await viewTicket(tracker, identity.ticket);
      const facts = { status: detail.status, plan: detail.implementationPlan, criteria: detail.acceptanceCriteria.length, labels: detail.labels, notes: detail.implementationNotes };
      gap = buildGap(facts);
      // A child's work is approved with its parent's plan: read the parent only when the child's own round is not.
      const parent = gap === "no-approval" ? parentTicketId(identity.ticket) : null;
      if (parent !== null) gap = buildGap({ ...facts, parentNotes: (await viewTicket(tracker, parent)).implementationNotes });
      const base = gap !== null ? (await readProjectConfig(identity.project))?.baseBranch : undefined;
      const commits = base === undefined ? 0 : await commitsPast(agent.cwd, base);
      if (base !== undefined && commits > 0) found = { commits, branch: await branchName(agent.cwd), base };
    } catch {
      return false;
    }
    const flagged = found;
    const kind = gap;
    const tell = await this.state.updateAgent(agent.id, () => freshState(identity), (record) => {
      if (kind !== "no-plan") record.noPlanFlagged = false;
      if (kind !== "no-approval") record.noApprovalFlagged = false;
      if (flagged === null || kind === null) return false;
      if (kind === "no-plan" ? record.noPlanFlagged : record.noApprovalFlagged) return false;
      if (kind === "no-plan") record.noPlanFlagged = true;
      else record.noApprovalFlagged = true;
      return true;
    });
    if (!tell || flagged === null || kind === null) return false;
    const at = new Date().toISOString();
    const record = kind === "no-plan" ? noPlanRecord(at, flagged.commits, flagged.branch, flagged.base) : noApprovalRecord(at, flagged.commits, flagged.branch, flagged.base);
    await appendTicketNote((await projectPaths(identity.project)).tracker, identity.ticket, record).catch((error: unknown) => {
      console.warn(`[taro] flagging ${identity.ticket}'s commits without ${kind === "no-plan" ? "a plan" : "an approved plan"}: ${error instanceof Error ? error.message : String(error)}`);
    });
    console.log(`[taro] ${agent.id} committed on ${identity.ticket} before ${kind === "no-plan" ? "its plan" : "this round's plan approval"}: ${kind.toUpperCase()} recorded and the owner told to stop`);
    await sendFromPlugin(
      paseo,
      agent.id,
      await message(kind === "no-plan" ? TEMPLATES.noPlan : TEMPLATES.noApproval, {
        ticket: identity.ticket,
        branch: flagged.branch,
        commits: flagged.commits === 1 ? "1 commit" : `${flagged.commits} commits`,
        base: flagged.base,
        skill: await skillDirectory(),
      }),
    );
    return true;
  }

  private async setStage(agentId: string, identity: TaroIdentity, stage: AgentState["compaction"]): Promise<void> {
    await this.state.updateAgent(agentId, () => freshState(identity), (record) => {
      record.compaction = stage;
    });
  }

  /** The user wrote to the manager directly: its open decisions (not asked again this turn) count as answered. */
  private async closeAnsweredInTab(agentId: string, userWords: readonly string[], askedNow: readonly ParsedDecision[], now: string): Promise<void> {
    const reasked = new Set(askedNow.map((decision) => decision.id));
    await this.state.updateDecisions((stored) => {
      for (const decision of stored) {
        if (decision.agentId !== agentId || decision.status !== "open" || reasked.has(decision.id)) continue;
        decision.status = "answered";
        decision.answer = { text: userWords[userWords.length - 1] ?? "", label: null, at: now };
      }
    });
  }

  private async storeDecisions(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity, decisions: readonly ParsedDecision[], turn: string | null, now: string, waiting: boolean, earlier: string): Promise<void> {
    const earlierBlocks = turn === null || earlier === "" ? [] : parseDecisionBlocks(earlier);
    // An owner's ticket: still planning (TR-146), or its plan approved this round (TR-263). Unread for anyone else.
    const facts = identity.role === "owner" && decisions.some((decision) => !decision.withdrawn) ? await this.decisionFacts(identity) : { planning: false, approved: false };
    // Before approval a question that would go on without the user is made blocking; after it, never.
    const planning = facts.planning && !facts.approved;
    // A plan approval asked without its mockups is held back (TR-235).
    const mockupGap = identity.role === "owner" && decisions.some((decision) => !decision.withdrawn && decision.id === SCOPE_APPROVAL) ? await this.planMockupsMissing(identity) : [];
    const newlyAsked: string[] = [];
    const opened: StoredDecision[] = [];
    const held: { id: string; open: string }[] = [];
    const unmocked: string[] = [];
    const refused: string[] = [];
    // Blocks the approval gate did not show as asked (TR-263), each with its outcome.
    const gated: { id: string; outcome: "refuse" | "default" | "hold"; default: string }[] = [];
    const corrections = await this.state.updateDecisions((stored) => {
      const problems: string[] = [];
      // Withdrawals first: an owner may withdraw its open question below the block that asks the next one.
      const inOrder = [...decisions.filter((decision) => decision.withdrawn), ...decisions.filter((decision) => !decision.withdrawn)];
      for (const block of inOrder) {
        const key = `${agent.id}:${block.id}`;
        const index = stored.findIndex((existing) => existing.key === key);
        // The card on the delivery is the only Accept, and it merges; a question that asks for one more would not.
        if (identity.role === "owner" && !block.withdrawn && asksToAccept(block)) {
          refused.push(block.id);
          continue;
        }
        // Made blocking and still open: a later read (failed, or the ticket moved on) does not unblock it.
        const stillBlocking = stored[index]?.status === "open" && stored[index]?.madeBlocking === true;
        const decision = asPlanningQuestion(block, planning || stillBlocking);
        if (decision.withdrawn) {
          const existing = stored[index];
          if (existing !== undefined) {
            existing.status = "withdrawn";
            // Withdrawn by its owner: nothing to hand on (TR-136).
            existing.held = false;
          }
          continue;
        }
        const next: StoredDecision = {
          ...decision,
          options: withImagePaths(decision.options, identity.ticket === null ? null : ticketEvidenceDirectory(identity.project, identity.ticket)),
          key,
          project: identity.project,
          ticket: identity.ticket,
          agentId: agent.id,
          agentRole: identity.role,
          agentTitle: identity.title,
          askedAt: now,
          turn,
          status: "open",
          answer: null,
        };
        const existing = stored[index];
        if (existing !== undefined && existing.status !== "open" && seenAgain(existing, asStored(decision, existing), turn, earlierBlocks.some((asked) => asked.id === block.id && sameQuestion(asked, block)))) {
          // The same block seen again (a repeated hook, a replayed turn) does not reopen an answered decision; asked in a later turn, it does.
          continue;
        }
        // After the round's approval the owner decides (TR-263): no second plan approval, and a blocking
        // question goes on with its default, unless the block names the approved line it would change.
        const gate = identity.role === "owner" ? approvalGate(block, facts.approved) : "ask";
        if (gate === "refuse") {
          gated.push({ id: block.id, outcome: gate, default: block.default });
          continue;
        }
        if (gate === "hold") {
          const withheld = { ...next, status: "withdrawn" as const };
          if (existing === undefined) stored.push(withheld);
          else stored[index] = withheld;
          gated.push({ id: block.id, outcome: gate, default: block.default });
          continue;
        }
        if (gate === "default") Object.assign(next, { blocking: false, madeNonBlocking: true });
        if (mockupGap.length > 0 && block.id === SCOPE_APPROVAL && !asksToAccept(block)) {
          const withheld = { ...next, status: "withdrawn" as const, held: true };
          if (existing === undefined) stored.push(withheld);
          else stored[index] = withheld;
          unmocked.push(block.id);
          continue;
        }
        // An owner asks one question at a time (TR-124): the next one, in this turn or a later one, waits
        // for the open one's answer. Stored withdrawn, so its turn seen again stays quiet and the tab says so.
        const holding = identity.role === "owner" ? openQuestionHolding(stored, agent.id, key) : undefined;
        if (holding !== undefined) {
          const withheld = { ...next, status: "withdrawn" as const, held: true };
          if (existing === undefined) stored.push(withheld);
          else stored[index] = withheld;
          held.push({ id: decision.id, open: holding.id });
          continue;
        }
        if (existing === undefined) stored.push(next);
        else stored[index] = next;
        if (existing === undefined || existing.status !== "open") opened.push(next);
        // Told once: an open question already going on with its default asked again stays quiet.
        if (gate === "default" && (existing === undefined || existing.status !== "open" || existing.madeNonBlocking !== true)) gated.push({ id: block.id, outcome: gate, default: block.default });
        // Shown for the first time (a held one included): counted, and its format problems reported.
        if (existing === undefined || existing.status === "withdrawn") {
          if (identity.ticket !== null) newlyAsked.push(identity.ticket);
          if (decision.problems.length > 0) problems.push(...decision.problems);
        }
      }
      return problems;
    });
    const madeBlocking = opened.filter((decision) => decision.madeBlocking === true);
    for (const ticket of newlyAsked) await this.stats.count(identity.project, ticket, "decisions").catch(() => undefined);
    const ending = identity.role === "owner" ? questionEndingDelivery(opened) : null;
    if (ending !== null && identity.ticket !== null) await this.endDeliveryOn(identity, identity.ticket, ending.id);
    if (corrections.length > 0) {
      await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.decisionCorrection, { problems: [...new Set(corrections)].join("; ") }));
    }
    if (refused.length > 0) {
      await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.acceptQuestionRefused, { refused: refused.map((id) => `\`${id}\``).join(", ") }));
    }
    if (unmocked.length > 0 && identity.ticket !== null) {
      await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.planWithoutMockups, { ticket: identity.ticket, missing: mockupGap.join("; "), skill: await skillDirectory() }));
    }
    if (gated.length > 0 && identity.ticket !== null) await this.tellGated(paseo, agent, identity.project, identity.ticket, gated);
    if (held.length > 0) {
      await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.decisionHeld, { held: held.map((each) => `\`${each.id}\``).join(", "), open: held[0]!.open }));
    }
    // A turn that already stopped for the user needs no reminder to.
    if (madeBlocking.length > 0 && !waiting) {
      await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.planningQuestion, { question: `\`${madeBlocking[0]!.id}\`` }));
    }
  }

  /** What the owner's plan lacks of its mockups (TR-235); unreadable counts as nothing missing, as a ticket the plugin cannot read blocks nothing else here. */
  private async planMockupsMissing(identity: TaroIdentity): Promise<string[]> {
    if (identity.ticket === null) return [];
    try {
      const detail = await viewTicket((await projectPaths(identity.project)).tracker, identity.ticket);
      return await mockupsMissing(identity.project, identity.ticket, detail.implementationPlan);
    } catch {
      return [];
    }
  }

  /**
   * The owner's ticket as its questions see it: still planning (TR-146), and its plan approved this
   * round, or its parent's for a child (TR-263). Unreadable counts as neither, keeping each block's own flag.
   */
  private async decisionFacts(identity: TaroIdentity): Promise<{ planning: boolean; approved: boolean }> {
    if (identity.ticket === null) return { planning: false, approved: false };
    try {
      const tracker = (await projectPaths(identity.project)).tracker;
      const detail = await viewTicket(tracker, identity.ticket);
      const planning = planningTicket({ status: detail.status, notes: detail.implementationNotes });
      let approved = workApproved(detail.implementationNotes);
      const parent = approved ? null : parentTicketId(identity.ticket);
      if (parent !== null) approved = await viewTicket(tracker, parent).then((parentDetail) => workApproved(detail.implementationNotes, parentDetail.implementationNotes), () => false);
      return { planning, approved };
    } catch {
      return { planning: false, approved: false };
    }
  }

  /** The owner whose blocks the approval gate changed (TR-263): a record each on the ticket, the plugin log, and one message. */
  private async tellGated(paseo: PaseoApi, agent: PaseoAgent, project: string, ticket: string, gated: readonly { id: string; outcome: "refuse" | "default" | "hold"; default: string }[]): Promise<void> {
    const tracker = (await projectPaths(project)).tracker;
    for (const each of gated) {
      const record = gateRecord(new Date().toISOString(), each.outcome, each);
      console.log(`[taro] ${agent.id} asked \`${each.id}\` on ${ticket} after its plan was approved, with no surprise: ${each.outcome === "refuse" ? "refused, not shown" : each.outcome === "hold" ? "held, no default" : "shown not blocking with its default"}`);
      if (record !== null) {
        await appendTicketNote(tracker, ticket, record).catch((error: unknown) => {
          console.warn(`[taro] recording ${ticket}'s question asked after approval: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
    const questions = gated.map((each) =>
      each.outcome === "refuse"
        ? `- \`${each.id}\`: not shown; the plan stays approved`
        : each.outcome === "hold"
          ? `- \`${each.id}\`: not shown, as it has no \`default\``
          : `- \`${each.id}\`: shown not blocking; go on with its default "${each.default.trim()}"`,
    );
    await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.approvalRepeated, { ticket, questions: questions.join("\n"), skill: await skillDirectory() }));
  }

  /**
   * An owner that delivered with one of its questions still open (TR-146): the user answers every
   * question before Accept, so the delivery goes back to In Progress and the owner is told why.
   */
  private async takeBackDeliveryWithOpenQuestion(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity): Promise<boolean> {
    if (identity.ticket === null) return false;
    const open = questionOpenAtDelivery(await this.state.allDecisions(), agent.id);
    if (open === null) return false;
    try {
      // Written only while the delivery is on offer, checked under the tracker's lock.
      const tracker = (await projectPaths(identity.project)).tracker;
      if (!(await endDelivery(tracker, identity.ticket, deliveryTakenBackRecord(new Date().toISOString(), open.id)))) return false;
    } catch (error) {
      console.warn(`[taro] taking back ${identity.ticket}'s delivery: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    // The owner now waits for it: shown blocking, without the default it would have gone on with.
    await this.state.updateDecisions((stored) => {
      const decision = stored.find((each) => each.key === open.key && each.status === "open");
      if (decision !== undefined && !decision.blocking) Object.assign(decision, { blocking: true, madeBlocking: true });
    });
    await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.deliveryWithOpenQuestion, { ticket: identity.ticket, question: `\`${open.id}\`` }));
    return true;
  }

  /**
   * An owner asking a blocking question while awaiting acceptance went back to work (TR-130): the
   * ticket returns to In Progress, so the question shows alone until the owner delivers again.
   */
  private async endDeliveryOn(identity: TaroIdentity, ticket: string, question: string): Promise<void> {
    try {
      await endDelivery((await projectPaths(identity.project)).tracker, ticket, deliveryEndedRecord(new Date().toISOString(), question));
    } catch (error) {
      console.warn(`[taro] ending ${ticket}'s delivery: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async deliverReport(paseo: PaseoApi, subagent: PaseoAgent, identity: TaroIdentity, closing: string, turnKey: string, parentAgentId: string | null): Promise<void> {
    if (closing.trim() === "") return;
    const delivered = await this.state.updateAgent(subagent.id, () => freshState(identity), (record) => {
      if (record.deliveredTurns.includes(turnKey)) return true;
      record.deliveredTurns = [...record.deliveredTurns, turnKey].slice(-20);
      return false;
    });
    if (delivered) return;
    const owner = await currentOwner(paseo, identity.project, identity.ticket, parentAgentId);
    if (owner === null) {
      console.warn(`[taro] no live owner for ${identity.ticket ?? "?"}; report from ${subagent.id} kept on the subagent only`);
      return;
    }
    const report: HeldReport = {
      fromAgentId: subagent.id,
      role: identity.role,
      title: identity.title ?? subagent.id,
      ticket: identity.ticket,
      text: closing.trim(),
      turnId: turnKey,
    };
    const ownerIdentity = identityFromLabels(owner.labels, owner.title ?? null);
    if (ownerIdentity === null) return;
    const ownerState = await this.state.agent(owner.id);
    // Held behind the user's queued messages too, which take the owner's next turns first (TR-171).
    if (isMidTurn(owner) || (ownerState !== null && ownerState.compaction !== "none") || (await this.userMessagesQueued(owner.id))) {
      await this.state.updateAgent(owner.id, () => freshState(ownerIdentity), (record) => {
        record.heldReports.push(report);
      });
      return;
    }
    await sendFromPlugin(paseo, owner.id, await this.reportText(report));
  }

  private async reportText(report: HeldReport): Promise<string> {
    return message(TEMPLATES.subagentReport, {
      // A report held before TR-017 may still say `helper`.
      role: roleFromLabel(report.role) ?? report.role,
      title: report.title,
      agentId: report.fromAgentId,
      ticket: report.ticket ?? "your ticket",
      report: report.text,
    });
  }

  /** Sends reports held while the owner was busy; returns whether it sent anything. Not while the user's messages wait in its queue. */
  async flushHeldReports(paseo: PaseoApi, ownerId: string): Promise<boolean> {
    const held = await this.state.agent(ownerId);
    if (held === null || held.heldReports.length === 0 || held.compaction !== "none") return false;
    if (await this.userMessagesQueued(ownerId)) return false;
    const reports = await this.state.updateAgent(ownerId, () => held, (record) => {
      const taken = record.heldReports;
      record.heldReports = [];
      return taken;
    });
    if (reports.length === 0) return false;
    const texts = await Promise.all(reports.map((report) => this.reportText(report)));
    await sendFromPlugin(paseo, ownerId, texts.join("\n\n---\n\n"));
    return true;
  }

  private async maybeStartCompaction(paseo: PaseoApi, owner: PaseoAgent, identity: TaroIdentity): Promise<void> {
    const config = await readProjectConfig(identity.project);
    const used = owner.lastUsage?.contextWindowUsedTokens;
    if (config === null || typeof used !== "number" || used <= config.compactThresholdTokens) return;
    await this.startCompaction(paseo, owner.id, identity, used);
  }

  /**
   * Idle compaction (TR-015): starts the pipeline for each owner and manager left idle
   * about an hour above the project's idle threshold. Run by a timer; returns how many it started.
   */
  async compactIdleAgents(paseo: PaseoApi, projects: readonly string[], now: number, afterMs: number): Promise<number> {
    let started = 0;
    for (const project of projects) {
      const config = await readProjectConfig(project);
      if (config === null) continue;
      for (const agent of await listTaroAgents(paseo, { [TARO_LABELS.project]: project })) {
        const identity = identityFromLabels(agent.labels, agent.title ?? null);
        if (identity === null) continue;
        const known = await this.state.agent(agent.id);
        const due = idleCompactionDue(
          {
            role: identity.role,
            status: agent.status,
            pendingPermissions: agent.pendingPermissions.length,
            stage: known?.compaction ?? "none",
            idle: known?.idleCompaction ?? "none",
            lastTurnEndedAt: known?.lastTurnEndedAt ?? null,
            usedTokens: agent.lastUsage?.contextWindowUsedTokens,
          },
          config.idleCompactThresholdTokens,
          now,
          afterMs,
        );
        if (!due) continue;
        await this.state.updateAgent(agent.id, () => freshState(identity), (record) => {
          record.idleCompaction = "running";
        });
        await this.startCompaction(paseo, agent.id, identity, agent.lastUsage?.contextWindowUsedTokens ?? null);
        if (identity.role === "manager") await this.stats.countProject(project, "idleCompactions").catch(() => undefined);
        else if (identity.ticket !== null) await this.stats.count(project, identity.ticket, "idleCompactions").catch(() => undefined);
        started += 1;
      }
    }
    return started;
  }

  /** Step 1 of compaction; also the Compact button, an owner's and the manager's (`trigger` "button"). */
  async startCompaction(paseo: PaseoApi, agentId: string, identity: TaroIdentity, usedTokens: number | null, trigger: "automatic" | "button" = "automatic"): Promise<void> {
    await this.setStage(agentId, identity, "handoff");
    const size = usedTokens === null ? "large" : `${Math.round(usedTokens / 1000)}k`;
    const managerRequest = trigger === "button" ? TEMPLATES.managerCompactRequest : TEMPLATES.managerHandoffRequest;
    const text =
      identity.role === "manager"
        ? await message(managerRequest, { usedTokens: size, handoff: await managerHandoffPath(identity.project) })
        : await message(TEMPLATES.handoffRequest, { usedTokens: size, ticket: identity.ticket ?? "your ticket", skill: await skillDirectory() });
    await sendFromPlugin(paseo, agentId, text);
  }
}
