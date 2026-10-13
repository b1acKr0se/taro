/**
 * The plugin's share of supervision (decisions 28, 30, 35, 36, 37), driven by
 * `agent.turn_ended`. No model turns: it reads what agents wrote, stores
 * decisions and status lines, delivers helpers' reports to the ticket's current
 * owner, nudges a stalled owner once, and runs the compaction pipeline.
 */
import { RoleSchema, TARO_LABELS, type Role } from "../shared/project";
import { isCrash } from "../shared/recovery";
import { hashText, parseDecisionBlocks, parseStatusLine, sameQuestion, type ParsedDecision } from "../shared/reports";
import { withdrawOpenDecisions, type AgentState, type HeldReport, type StoredDecision } from "../shared/state";
import { fetchLiveAgent, isMidTurn, listTaroAgents } from "./agents";
import type { HookAgent, PaseoAgent, PaseoApi, TimelineItem, TurnOutcome } from "./host-types";
import { TEMPLATES, message, skillDirectory } from "./package-files";
import { readProjectConfig } from "./projects";
import { isPluginMessageId, sendCommand, sendFromPlugin } from "./send";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";

export interface TaroIdentity {
  project: string;
  role: Role;
  ticket: string | null;
  title: string | null;
}

export function identityFromLabels(labels: Readonly<Record<string, string>>, title: string | null): TaroIdentity | null {
  const project = labels[TARO_LABELS.project];
  const role = RoleSchema.safeParse(labels[TARO_LABELS.role]);
  if (project === undefined || project === "" || !role.success) return null;
  const ticket = labels[TARO_LABELS.ticket];
  return { project, role: role.data, ticket: ticket === undefined || ticket === "" ? null : ticket, title };
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

/** Every assistant message of the turn, for decision blocks anywhere in it. */
export function allAssistantText(timeline: readonly TimelineItem[]): string {
  return timeline.flatMap((item) => (item.type === "assistant_message" ? [item.text] : [])).join("");
}

/** The turn that just ended: from the last user message on (the whole timeline when there is none). */
export function currentTurn(timeline: readonly TimelineItem[]): readonly TimelineItem[] {
  const lastUser = timeline.map((item) => item.type).lastIndexOf("user_message");
  return timeline.slice(lastUser === -1 ? 0 : lastUser);
}

/**
 * Whether the provider compacted this turn on its own. The hook passes the whole stored timeline,
 * so only the current turn counts, or every later turn (the reload included) would reload again.
 * Claude marks it `trigger: "auto"`; Codex sets only "manual", so its automatic ones carry none.
 */
export function autoCompactedThisTurn(timeline: readonly TimelineItem[]): boolean {
  return currentTurn(timeline).some((item) => item.type === "compaction" && item.status === "completed" && item.trigger !== "manual");
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
    lastTurnEndedAt: null,
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
  ) {}

  async onTurnEnded(paseo: PaseoApi, hookAgent: HookAgent, outcome: TurnOutcome, timeline: readonly TimelineItem[], turnId: string | null, activeMs: number | undefined): Promise<void> {
    const live = await fetchLiveAgent(paseo, hookAgent.id);
    if (live === null) return;
    const identity = identityFromLabels(live.labels, live.title ?? null);
    if (identity === null) return;
    const model = live.model === null || live.model === undefined ? live.provider : `${live.provider}/${live.model}`;
    await this.stats.turnEnded(identity.project, identity.ticket, { id: live.id, role: identity.role, model, title: identity.title }, activeMs).catch(() => undefined);
    const now = new Date().toISOString();
    // The hook passes the agent's whole stored timeline: earlier turns' blocks would reopen answered
    // decisions, their user words would close new ones, and a turn without text would reuse their reply.
    const turn = currentTurn(timeline);
    const closing = closingText(turn);
    // Reports are deduplicated by their text: turn ids ("foreground-turn-1") may repeat, and the
    // reconcile after a restart must recognise a report the hook already delivered.
    void turnId;
    const turnKey = hashText(closing);

    const status = parseStatusLine(closing);
    const decisions = parseDecisionBlocks(allAssistantText(turn));
    const userWords = humanMessages(turn);
    if (userWords.length > 0) await this.closeAnsweredInTab(live.id, userWords, decisions, now);
    if (decisions.length > 0) await this.storeDecisions(paseo, live, identity, decisions, now);

    const openBlocking = (await this.state.allDecisions()).some(
      (decision) => decision.agentId === live.id && decision.status === "open" && decision.blocking,
    );
    const stage = await this.state.updateAgent(live.id, () => freshState(identity), (record) => {
      record.ticket = identity.ticket;
      record.title = identity.title;
      record.lastTurnEndedAt = now;
      if (status !== null) record.lastStatus = { ...status, at: now };
      // Working again after the plugin gave up on its crashes (the user restarted it by hand).
      if (outcome.kind === "completed" && record.stalledReason !== null) {
        record.stalled = false;
        record.stalledReason = null;
      }
      return record.compaction;
    });

    if (outcome.kind === "canceled") return;
    // Any role, the manager included (TR-012): a dead process gets no further turns on its own.
    const failure = outcome.kind === "failed" ? (outcome.error?.message ?? "") : "";
    if (isCrash(failure)) {
      await this.recovery.onCrash(paseo, live, identity, failure);
      return;
    }

    if (identity.role === "helper" || identity.role === "reviewer") {
      if (outcome.kind === "completed") await this.deliverReport(paseo, live, identity, closing, turnKey, hookAgent.parentAgentId);
      return;
    }
    if (identity.role !== "owner") return;

    // Compaction pipeline (decision 35): handoff → /compact → reload.
    if (stage === "handoff") {
      await this.setStage(live.id, identity, "compacting");
      await sendCommand(paseo, live.id, `/compact ${await message(TEMPLATES.compactInstructions)}`);
      return;
    }
    if (stage === "compacting") {
      await this.setStage(live.id, identity, "none");
      await sendFromPlugin(paseo, live.id, await this.reloadText(identity));
      return;
    }
    if (autoCompactedThisTurn(timeline)) {
      await sendFromPlugin(paseo, live.id, await this.reloadText(identity));
      return;
    }

    if (outcome.kind === "completed") {
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

    if (await this.flushHeldReports(paseo, live.id)) return;
    await this.maybeStartCompaction(paseo, live, identity);
  }

  /**
   * After a reload or restart (decision 37): re-read each idle Taro agent's
   * latest turn the plugin did not see end, rebuild its status line, and deliver
   * helper reports that finished while the plugin was down. No nudges here.
   */
  async reconcile(paseo: PaseoApi, projects: readonly string[]): Promise<number> {
    let repaired = 0;
    for (const project of projects) {
      const agents = await listTaroAgents(paseo, { [TARO_LABELS.project]: project });
      // Agents archived (or removed) while the plugin was down: their questions can no longer be answered.
      const live = new Set(agents.map((agent) => agent.id));
      await this.state.updateDecisions((stored) => withdrawOpenDecisions(stored, (decision) => decision.project === project && !live.has(decision.agentId)));
      repaired += await this.recovery.recoverLeftovers(paseo, agents);
      for (const agent of agents) {
        if (isMidTurn(agent) || agent.status === "closed") continue;
        const identity = identityFromLabels(agent.labels, agent.title ?? null);
        if (identity === null) continue;
        const known = await this.state.agent(agent.id);
        // Seen by the hook already (its clock and Paseo's differ by moments, hence the minute's slack).
        const seenAt = known?.lastTurnEndedAt === null || known?.lastTurnEndedAt === undefined ? Number.NaN : Date.parse(known.lastTurnEndedAt);
        if (!Number.isNaN(seenAt) && seenAt >= Date.parse(agent.updatedAt) - 60_000) continue;
        const page = await paseo.agents.ref(agent.id).timeline.refetch({ direction: "tail", limit: 40, projection: "projected" }).catch(() => null);
        if (page === null) continue;
        const items = page.entries.map((entry) => entry.item);
        const turn = currentTurn(items);
        const closing = closingText(turn);
        const status = parseStatusLine(closing);
        await this.state.updateAgent(agent.id, () => freshState(identity), (record) => {
          record.lastTurnEndedAt = agent.updatedAt;
          if (status !== null) record.lastStatus = { ...status, at: agent.updatedAt };
        });
        const decisions = parseDecisionBlocks(allAssistantText(turn));
        if (decisions.length > 0) await this.storeDecisions(paseo, agent, identity, decisions, agent.updatedAt);
        if (identity.role === "helper" || identity.role === "reviewer") {
          await this.deliverReport(paseo, agent, identity, closing, hashText(closing), agent.labels["paseo.parent-agent-id"] ?? null);
        }
        repaired += 1;
      }
    }
    return repaired;
  }

  /** An archived agent never reads an answer, whoever archived it: the plugin, the user, the CLI. */
  async withdrawDecisionsOf(agentId: string): Promise<number> {
    return this.state.updateDecisions((stored) => withdrawOpenDecisions(stored, (decision) => decision.agentId === agentId));
  }

  private async reloadText(identity: TaroIdentity): Promise<string> {
    return message(TEMPLATES.reload, { skill: await skillDirectory(), ticket: identity.ticket ?? "your ticket" });
  }

  private async setStage(agentId: string, identity: TaroIdentity, stage: AgentState["compaction"]): Promise<void> {
    await this.state.updateAgent(agentId, () => freshState(identity), (record) => {
      record.compaction = stage;
    });
  }

  /** The user wrote to the agent directly: its open decisions (not asked again this turn) count as answered. */
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

  private async storeDecisions(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity, decisions: readonly ParsedDecision[], now: string): Promise<void> {
    const newlyAsked: string[] = [];
    const corrections = await this.state.updateDecisions((stored) => {
      const problems: string[] = [];
      for (const decision of decisions) {
        const key = `${agent.id}:${decision.id}`;
        const index = stored.findIndex((existing) => existing.key === key);
        if (decision.withdrawn) {
          const existing = stored[index];
          if (existing !== undefined) existing.status = "withdrawn";
          continue;
        }
        const next: StoredDecision = {
          ...decision,
          key,
          project: identity.project,
          ticket: identity.ticket,
          agentId: agent.id,
          agentRole: identity.role,
          agentTitle: identity.title,
          askedAt: now,
          status: "open",
          answer: null,
        };
        const existing = stored[index];
        if (existing === undefined) {
          stored.push(next);
          if (identity.ticket !== null) newlyAsked.push(identity.ticket);
          if (decision.problems.length > 0) problems.push(...decision.problems);
        } else if (existing.status !== "open" && sameQuestion(existing, decision)) {
          // The same block seen again (a repeated message, a replayed turn) does not reopen an answered decision.
          continue;
        } else {
          stored[index] = next;
        }
      }
      return problems;
    });
    for (const ticket of newlyAsked) await this.stats.count(identity.project, ticket, "decisions").catch(() => undefined);
    if (corrections.length > 0) {
      await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.decisionCorrection, { problems: [...new Set(corrections)].join("; ") }));
    }
  }

  private async deliverReport(paseo: PaseoApi, helper: PaseoAgent, identity: TaroIdentity, closing: string, turnKey: string, parentAgentId: string | null): Promise<void> {
    if (closing.trim() === "") return;
    const delivered = await this.state.updateAgent(helper.id, () => freshState(identity), (record) => {
      if (record.deliveredTurns.includes(turnKey)) return true;
      record.deliveredTurns = [...record.deliveredTurns, turnKey].slice(-20);
      return false;
    });
    if (delivered) return;
    const owner = await currentOwner(paseo, identity.project, identity.ticket, parentAgentId);
    if (owner === null) {
      console.warn(`[taro] no live owner for ${identity.ticket ?? "?"}; report from ${helper.id} kept on the helper only`);
      return;
    }
    const report: HeldReport = {
      fromAgentId: helper.id,
      role: identity.role,
      title: identity.title ?? helper.id,
      ticket: identity.ticket,
      text: closing.trim(),
      turnId: turnKey,
    };
    const ownerIdentity = identityFromLabels(owner.labels, owner.title ?? null);
    if (ownerIdentity === null) return;
    const ownerState = await this.state.agent(owner.id);
    if (isMidTurn(owner) || (ownerState !== null && ownerState.compaction !== "none")) {
      await this.state.updateAgent(owner.id, () => freshState(ownerIdentity), (record) => {
        record.heldReports.push(report);
      });
      return;
    }
    await sendFromPlugin(paseo, owner.id, await this.reportText(report));
  }

  private async reportText(report: HeldReport): Promise<string> {
    return message(TEMPLATES.helperReport, {
      role: report.role,
      title: report.title,
      agentId: report.fromAgentId,
      ticket: report.ticket ?? "your ticket",
      report: report.text,
    });
  }

  /** Sends reports held while the owner was busy; returns whether it sent anything. */
  async flushHeldReports(paseo: PaseoApi, ownerId: string): Promise<boolean> {
    const held = await this.state.agent(ownerId);
    if (held === null || held.heldReports.length === 0 || held.compaction !== "none") return false;
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

  /** Step 1 of compaction; also the card's Compact button. */
  async startCompaction(paseo: PaseoApi, ownerId: string, identity: TaroIdentity, usedTokens: number | null): Promise<void> {
    await this.setStage(ownerId, identity, "handoff");
    await sendFromPlugin(
      paseo,
      ownerId,
      await message(TEMPLATES.handoffRequest, {
        usedTokens: usedTokens === null ? "large" : `${Math.round(usedTokens / 1000)}k`,
        ticket: identity.ticket ?? "your ticket",
        skill: await skillDirectory(),
      }),
    );
  }
}
