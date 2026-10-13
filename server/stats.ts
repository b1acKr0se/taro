/** Stats on disk (`state/stats.json`), written as tickets move and agents work. */
import { z } from "zod";

import { parentOf, TicketStatsSchema, type TicketStats } from "../shared/stats";
import { statePath } from "./data-dir";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import { serialized } from "./serialize";

// Turn starts are kept on disk so a turn that spans a plugin reload or daemon restart keeps its duration.
const StatsFileSchema = z.object({
  tickets: z.record(z.string(), TicketStatsSchema).default({}),
  turnStarts: z.record(z.string(), z.string()).default({}),
});
type StatsFile = z.infer<typeof StatsFileSchema>;

function keyFor(project: string, ticket: string): string {
  return `${project}:${ticket}`;
}

export class Stats {
  private file: StatsFile | null = null;

  private async load(): Promise<StatsFile> {
    if (this.file === null) {
      const parsed = StatsFileSchema.safeParse((await readJsonIfPresent(statePath("stats.json")).catch(() => null)) ?? {});
      this.file = parsed.success ? parsed.data : { tickets: {}, turnStarts: {} };
    }
    return this.file;
  }

  /** Runs `change` on the loaded file under the stats lock; writes only when it returns true. */
  private modify(change: (file: StatsFile) => boolean): Promise<void> {
    return serialized("state:stats", async () => {
      const file = await this.load();
      if (change(file)) await writeJsonAtomically(statePath("stats.json"), file);
    });
  }

  private update(project: string, ticket: string, change: (stats: TicketStats) => void): Promise<void> {
    return this.modify((file) => {
      const key = keyFor(project, ticket);
      const stats = file.tickets[key] ?? TicketStatsSchema.parse({ project, ticket });
      change(stats);
      file.tickets[key] = stats;
      return true;
    });
  }

  async all(project: string | null): Promise<TicketStats[]> {
    return Object.values((await this.load()).tickets).filter((stats) => project === null || stats.project === project);
  }

  transition(project: string, ticket: string, title: string, from: string | null, to: string, at: string): Promise<void> {
    return this.update(project, ticket, (stats) => {
      stats.title = title;
      stats.transitions.push({ from, to, at });
    });
  }

  turnStarted(agentId: string): Promise<void> {
    const at = new Date().toISOString();
    return this.modify((file) => {
      file.turnStarts[agentId] = at;
      return true;
    });
  }

  /** Removes and returns the agent's stored turn start (ms), if any. */
  private takeTurnStart(agentId: string): Promise<number | undefined> {
    let started: number | undefined;
    return this.modify((file) => {
      const at = file.turnStarts[agentId];
      if (at === undefined) return false;
      delete file.turnStarts[agentId];
      const parsed = Date.parse(at);
      started = Number.isNaN(parsed) ? undefined : parsed;
      return true;
    }).then(() => started);
  }

  /** Forgets a turn start nobody recorded an end for (an agent outside Taro), so the file does not grow. */
  async discardTurnStart(agentId: string): Promise<void> {
    await this.takeTurnStart(agentId);
  }

  /**
   * After a reload or restart: drops stored starts of agents no longer mid-turn. Their turn ended
   * while the plugin was down, and pairing the start with a later end would count the idle gap.
   * A start replaced while the check ran (a new turn) is kept.
   */
  async dropFinishedTurns(isMidTurn: (agentId: string) => Promise<boolean>): Promise<number> {
    const stored = { ...(await serialized("state:stats", async () => (await this.load()).turnStarts)) };
    const finished: [string, string][] = [];
    for (const [agentId, at] of Object.entries(stored)) {
      if (!(await isMidTurn(agentId).catch(() => true))) finished.push([agentId, at]);
    }
    let dropped = 0;
    await this.modify((file) => {
      for (const [agentId, at] of finished) {
        if (file.turnStarts[agentId] !== at) continue;
        delete file.turnStarts[agentId];
        dropped += 1;
      }
      return dropped > 0;
    });
    return dropped;
  }

  /** A child ticket's agents and turns count toward its parent as well as itself (`projectTotals` relies on it). */
  async turnEnded(project: string, ticket: string | null, agent: { id: string; role: string; model: string | null; title: string | null }): Promise<void> {
    const started = await this.takeTurnStart(agent.id);
    if (ticket === null) return;
    const tickets = [ticket];
    const parent = parentOf(ticket);
    if (parent !== null) tickets.push(parent);
    for (const target of tickets) {
      await this.update(project, target, (stats) => {
        const record = stats.agents[agent.id] ?? { agentId: agent.id, role: agent.role, model: agent.model, title: agent.title, turns: 0, activeMs: 0, costUsd: null, contextTokens: null };
        record.turns += 1;
        if (started !== undefined) record.activeMs += Math.max(0, Date.now() - started);
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
