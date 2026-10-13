/**
 * The plugin's own state on disk (decision 37): parsed decisions and each
 * agent's supervision record. Kept in memory, written through on every change,
 * read back on start, so a reload or restart loses nothing.
 */
import { z } from "zod";

import { AgentStateSchema, StoredDecisionSchema, type AgentState, type StoredDecision } from "../shared/state";
import { statePath } from "./data-dir";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import { serialized } from "./serialize";

const DecisionsFileSchema = z.object({ decisions: z.array(StoredDecisionSchema).default([]) });
const AgentsFileSchema = z.object({ agents: z.record(z.string(), AgentStateSchema).default({}) });

/** Answered and withdrawn decisions are kept this long for the record, then dropped. */
const CLOSED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export class PluginState {
  private decisions: StoredDecision[] | null = null;
  private agents: Record<string, AgentState> | null = null;

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
}
