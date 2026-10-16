/**
 * The plugin's own state on disk (decision 37): parsed decisions, each
 * agent's supervision record, the ticket statuses last acted on (TR-043), and
 * the queue ladder's restarts and dismissed alerts (TR-062), and Taro agents' permission asks (TR-149). Kept in memory, written through on every change,
 * read back on start, so a reload or restart loses nothing.
 */
import { z } from "zod";

import { keptAsks, PermissionAskSchema, resolveAsk, type AskResolution, type PermissionAsk } from "../shared/permission-asks";
import { AgentStateSchema, StoredDecisionSchema, type AgentState, type StoredDecision } from "../shared/state";
import { statePath } from "./data-dir";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import { serialized } from "./serialize";

const DecisionsFileSchema = z.object({ decisions: z.array(StoredDecisionSchema).default([]) });
const AgentsFileSchema = z.object({ agents: z.record(z.string(), AgentStateSchema).default({}) });
const TicketStatusesFileSchema = z.object({ projects: z.record(z.string(), z.record(z.string(), z.string())).default({}) });
const QueueLadderSchema = z.object({ restarts: z.array(z.string()).default([]), dismissed: z.array(z.string()).default([]) });
export type StoredQueueLadder = z.infer<typeof QueueLadderSchema>;
const PermissionAsksFileSchema = z.object({ asks: z.array(PermissionAskSchema).default([]) });
const QueueLaddersFileSchema = z.object({ projects: z.record(z.string(), QueueLadderSchema).default({}) });

/** Answered and withdrawn decisions are kept this long for the record, then dropped. */
const CLOSED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export class PluginState {
  private decisions: StoredDecision[] | null = null;
  private agents: Record<string, AgentState> | null = null;
  private ticketStatusesByProject: Record<string, Record<string, string>> | null = null;
  private queueLadders: Record<string, StoredQueueLadder> | null = null;
  private permissionAsks: PermissionAsk[] | null = null;

  private async loadQueueLadders(): Promise<Record<string, StoredQueueLadder>> {
    if (this.queueLadders === null) {
      const raw = await readJsonIfPresent(statePath("queue-ladders.json")).catch(() => null);
      const parsed = QueueLaddersFileSchema.safeParse(raw ?? {});
      this.queueLadders = parsed.success ? parsed.data.projects : {};
    }
    return this.queueLadders;
  }

  /** A project's ladder restarts (for the hourly limit) and dismissed alerts, so a reload neither repeats a restart nor brings an alert back. */
  async queueLadder(project: string): Promise<StoredQueueLadder | null> {
    return (await this.loadQueueLadders())[project] ?? null;
  }

  saveQueueLadder(project: string, ladder: StoredQueueLadder): Promise<void> {
    return serialized("state:queue-ladders", async () => {
      const projects = await this.loadQueueLadders();
      projects[project] = ladder;
      await writeJsonAtomically(statePath("queue-ladders.json"), { projects });
    });
  }

  private async loadDecisions(): Promise<StoredDecision[]> {
    if (this.decisions === null) {
      const raw = await readJsonIfPresent(statePath("decisions.json")).catch(() => null);
      const parsed = DecisionsFileSchema.safeParse(raw ?? {});
      this.decisions = parsed.success ? parsed.data.decisions : [];
    }
    return this.decisions;
  }

  private async loadAgents(): Promise<Record<string, AgentState>> {
    if (this.agents === null) {
      const raw = await readJsonIfPresent(statePath("agents.json")).catch(() => null);
      const parsed = AgentsFileSchema.safeParse(raw ?? {});
      this.agents = parsed.success ? parsed.data.agents : {};
    }
    return this.agents;
  }

  async allDecisions(): Promise<readonly StoredDecision[]> {
    return [...(await this.loadDecisions())];
  }

  async decision(key: string): Promise<StoredDecision | null> {
    return (await this.loadDecisions()).find((decision) => decision.key === key) ?? null;
  }

  /** Changes decisions under one lock and writes them back. */
  updateDecisions<T>(change: (decisions: StoredDecision[]) => T): Promise<T> {
    return serialized("state:decisions", async () => {
      const decisions = await this.loadDecisions();
      const result = change(decisions);
      const cutoff = Date.now() - CLOSED_RETENTION_MS;
      this.decisions = decisions.filter((decision) => decision.status === "open" || Date.parse(decision.answer?.at ?? decision.askedAt) > cutoff);
      await writeJsonAtomically(statePath("decisions.json"), { decisions: this.decisions });
      return result;
    });
  }

  async agent(agentId: string): Promise<AgentState | null> {
    return (await this.loadAgents())[agentId] ?? null;
  }

  async allAgents(): Promise<Readonly<Record<string, AgentState>>> {
    return { ...(await this.loadAgents()) };
  }

  /** Changes one agent's record (created from `initial` when missing) and writes the file. */
  updateAgent<T>(agentId: string, initial: () => AgentState, change: (state: AgentState) => T): Promise<T> {
    return serialized("state:agents", async () => {
      const agents = await this.loadAgents();
      const state = agents[agentId] ?? initial();
      const result = change(state);
      agents[agentId] = state;
      await writeJsonAtomically(statePath("agents.json"), { agents });
      return result;
    });
  }

  forgetAgent(agentId: string): Promise<void> {
    return serialized("state:agents", async () => {
      const agents = await this.loadAgents();
      if (!(agentId in agents)) return;
      delete agents[agentId];
      await writeJsonAtomically(statePath("agents.json"), { agents });
    });
  }

  private async loadTicketStatuses(): Promise<Record<string, Record<string, string>>> {
    if (this.ticketStatusesByProject === null) {
      const raw = await readJsonIfPresent(statePath("ticket-statuses.json")).catch(() => null);
      const parsed = TicketStatusesFileSchema.safeParse(raw ?? {});
      this.ticketStatusesByProject = parsed.success ? parsed.data.projects : {};
    }
    return this.ticketStatusesByProject;
  }

  /** The statuses a project's tickets had when the plugin last acted on them; null when never stored. */
  async ticketStatuses(project: string): Promise<ReadonlyMap<string, string> | null> {
    const stored = (await this.loadTicketStatuses())[project];
    return stored === undefined ? null : new Map(Object.entries(stored));
  }

  /** For a project onboarded afresh under a name used before: its old tracker's statuses are moot. */
  forgetTicketStatuses(project: string): Promise<void> {
    return serialized("state:ticket-statuses", async () => {
      const projects = await this.loadTicketStatuses();
      if (!(project in projects)) return;
      delete projects[project];
      await writeJsonAtomically(statePath("ticket-statuses.json"), { projects });
    });
  }

  saveTicketStatuses(project: string, statuses: ReadonlyMap<string, string>): Promise<void> {
    return serialized("state:ticket-statuses", async () => {
      const projects = await this.loadTicketStatuses();
      projects[project] = Object.fromEntries(statuses);
      await writeJsonAtomically(statePath("ticket-statuses.json"), { projects });
    });
  }

  private async loadPermissionAsks(): Promise<PermissionAsk[]> {
    if (this.permissionAsks === null) {
      const raw = await readJsonIfPresent(statePath("permission-asks.json")).catch(() => null);
      const parsed = PermissionAsksFileSchema.safeParse(raw ?? {});
      this.permissionAsks = parsed.success ? parsed.data.asks : [];
    }
    return this.permissionAsks;
  }

  /** An agent's answered permission asks, oldest first, for its chat's finished cards. */
  async answeredPermissionAsks(agentId: string): Promise<PermissionAsk[]> {
    return (await this.loadPermissionAsks())
      .filter((ask) => ask.agentId === agentId && ask.answeredAt !== null)
      .sort((left, right) => Date.parse(left.askedAt) - Date.parse(right.askedAt));
  }

  /** Changes the asks under one lock, drops those past keeping, and writes them back. */
  private updatePermissionAsks<T>(change: (asks: PermissionAsk[]) => T): Promise<T> {
    return serialized("state:permission-asks", async () => {
      const asks = await this.loadPermissionAsks();
      const result = change(asks);
      this.permissionAsks = keptAsks(asks, Date.now());
      await writeJsonAtomically(statePath("permission-asks.json"), { asks: this.permissionAsks });
      return result;
    });
  }

  /** A new ask; the same request asked again replaces it. */
  recordPermissionAsk(ask: PermissionAsk): Promise<void> {
    return this.updatePermissionAsks((asks) => {
      const index = asks.findIndex((each) => each.agentId === ask.agentId && each.requestId === ask.requestId);
      if (index === -1) asks.push(ask);
      else asks[index] = ask;
    });
  }

  /**
   * Taro's rules are answering this ask (TR-143): marked before they respond, so the resolution that
   * follows is theirs and not the user's. Whether an ask was recorded to mark.
   */
  markPermissionAskByRules(agentId: string, requestId: string, rule: string): Promise<boolean> {
    return this.updatePermissionAsks((asks) => {
      const ask = asks.find((each) => each.agentId === agentId && each.requestId === requestId && each.answeredAt === null);
      if (ask === undefined) return false;
      ask.rule = rule;
      return true;
    });
  }

  /** The rules could not respond: the answer, now or later, is the user's. */
  clearPermissionAskRules(agentId: string, requestId: string): Promise<void> {
    return this.updatePermissionAsks((asks) => {
      const ask = asks.find((each) => each.agentId === agentId && each.requestId === requestId);
      if (ask === undefined || ask.rule === null) return;
      ask.rule = null;
      if (ask.by === "rules") ask.by = "you";
    });
  }

  /** The ask's answer; an ask never recorded (another agent's, or made before TR-149) is ignored. Whether one was answered. */
  resolvePermissionAsk(agentId: string, requestId: string, resolution: AskResolution, at: string): Promise<boolean> {
    return this.updatePermissionAsks((asks) => {
      const index = asks.findIndex((each) => each.agentId === agentId && each.requestId === requestId);
      const ask = asks[index];
      if (ask === undefined) return false;
      asks[index] = resolveAsk(ask, resolution, at, ask.rule === null ? null : { rule: ask.rule });
      return true;
    });
  }
}
