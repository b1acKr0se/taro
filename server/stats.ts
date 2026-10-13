/** Stats on disk (`state/stats.json`), written as tickets move and agents work. */
import { z } from "zod";

import { parentOf, TicketStatsSchema, type TicketStats } from "../shared/stats";
import { statePath } from "./data-dir";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import { serialized } from "./serialize";

const StatsFileSchema = z.object({ tickets: z.record(z.string(), TicketStatsSchema).default({}) });

function keyFor(project: string, ticket: string): string {
  return `${project}:${ticket}`;
}

export class Stats {
  private tickets: Record<string, TicketStats> | null = null;
  private readonly turnStarts = new Map<string, number>();

  private async load(): Promise<Record<string, TicketStats>> {
    if (this.tickets === null) {
      const parsed = StatsFileSchema.safeParse((await readJsonIfPresent(statePath("stats.json")).catch(() => null)) ?? {});
      this.tickets = parsed.success ? parsed.data.tickets : {};
    }
    return this.tickets;
  }

  private update(project: string, ticket: string, change: (stats: TicketStats) => void): Promise<void> {
    return serialized("state:stats", async () => {
      const tickets = await this.load();
      const key = keyFor(project, ticket);
      const stats = tickets[key] ?? TicketStatsSchema.parse({ project, ticket });
      change(stats);
      tickets[key] = stats;
      await writeJsonAtomically(statePath("stats.json"), { tickets });
    });
  }

  async all(project: string | null): Promise<TicketStats[]> {
    return Object.values(await this.load()).filter((stats) => project === null || stats.project === project);
  }

  transition(project: string, ticket: string, title: string, from: string | null, to: string, at: string): Promise<void> {
    return this.update(project, ticket, (stats) => {
      stats.title = title;
      stats.transitions.push({ from, to, at });
    });
  }

  turnStarted(agentId: string): void {
    this.turnStarts.set(agentId, Date.now());
  }

  /** A child ticket's agents and turns count toward its parent as well as itself (`projectTotals` relies on it). */
  async turnEnded(project: string, ticket: string | null, agent: { id: string; role: string; model: string | null; title: string | null }): Promise<void> {
    const started = this.turnStarts.get(agent.id);
    this.turnStarts.delete(agent.id);
    if (ticket === null) return;
    const tickets = [ticket];
    const parent = parentOf(ticket);
    if (parent !== null) tickets.push(parent);
    for (const target of tickets) {
      await this.update(project, target, (stats) => {
        const record = stats.agents[agent.id] ?? { agentId: agent.id, role: agent.role, model: agent.model, title: agent.title, turns: 0, activeMs: 0, costUsd: null, contextTokens: null };
        record.turns += 1;
        if (started !== undefined) record.activeMs += Date.now() - started;
        stats.agents[agent.id] = record;
      });
    }
  }

  agentFinal(project: string, ticket: string, agentId: string, costUsd: number | null, contextTokens: number | null): Promise<void> {
    return this.update(project, ticket, (stats) => {
      const record = stats.agents[agentId];
      if (record === undefined) return;
      record.costUsd = costUsd;
      record.contextTokens = contextTokens;
    });
  }

  count(project: string, ticket: string, field: "nudges" | "decisions"): Promise<void> {
    return this.update(project, ticket, (stats) => {
      stats[field] += 1;
    });
  }
}
