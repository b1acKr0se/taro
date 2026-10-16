/** Stats on disk (`state/stats.json`), written as tickets move and agents work. */
import { z } from "zod";

import { parentOf, ProjectStatsSchema, TicketStatsSchema, withoutRepeats, type AgentStats, type ProjectStats, type TicketStats } from "../shared/stats";
import { isMidTurn } from "./agents";
import { statePath } from "./data-dir";
import { readJsonIfPresent, readTextIfPresent, writeJsonAtomically, writeTextIfMissing } from "./files";
import { serialized } from "./serialize";

/** The one-time fill of costs recorded before every turn end recorded one (TR-097): when, and how many. */
const CostBackfillSchema = z.object({ at: z.string(), filled: z.number().int(), missing: z.number().int() });
export type CostBackfill = z.infer<typeof CostBackfillSchema>;

/** The one-time removal of entries into the status a ticket already had (TR-100): when, and how many. */
const RepeatRepairSchema = z.object({ at: z.string(), removed: z.number().int() });
export type RepeatRepair = z.infer<typeof RepeatRepairSchema>;

/** A Needs-you check finding a ticket again within this long continues its stretch; a longer gap (the plugin was down) starts a new one. */
export const WAITING_GAP_MS = 90_000;
/** How often a continued stretch's end is written to disk. */
export const WAITING_WRITE_EVERY_MS = 60_000;

// Turn starts are kept on disk so a turn that spans a plugin reload or daemon restart keeps its duration.
// `costBackfill` and `repeatRepair` are null until each has run once; files without them load as not yet run.
const StatsFileSchema = z.object({
  tickets: z.record(z.string(), TicketStatsSchema).default({}),
  projects: z.record(z.string(), ProjectStatsSchema).default({}),
  turnStarts: z.record(z.string(), z.string()).default({}),
  costBackfill: CostBackfillSchema.nullable().default(null),
  repeatRepair: RepeatRepairSchema.nullable().default(null),
});
type StatsFile = z.infer<typeof StatsFileSchema>;

function keyFor(project: string, ticket: string): string {
  return `${project}:${ticket}`;
}

/** The ticket and, for a child, its parent: a child's agents count on both. */
function ticketAndParent(ticket: string): string[] {
  const parent = parentOf(ticket);
  return parent === null ? [ticket] : [ticket, parent];
}

/** An agent's usage as Paseo last reported it; either may be missing (after a daemon restart, both are). */
export interface AgentUsageReading {
  costUsd: number | null;
  contextTokens: number | null;
  contextMaxTokens?: number | null;
}

export function usageReading(usage: { totalCostUsd?: number; contextWindowUsedTokens?: number; contextWindowMaxTokens?: number } | null | undefined): AgentUsageReading {
  return { costUsd: usage?.totalCostUsd ?? null, contextTokens: usage?.contextWindowUsedTokens ?? null, contextMaxTokens: usage?.contextWindowMaxTokens ?? null };
}

/**
 * Paseo's cost is the agent's running total, so it only grows: the highest reading is kept, and a
 * missing one (a daemon restart forgets usage) never erases what was recorded.
 */
function applyUsage(record: AgentStats, usage: AgentUsageReading): void {
  if (usage.costUsd !== null) record.costUsd = Math.max(record.costUsd ?? 0, usage.costUsd);
  if (usage.contextTokens !== null) record.contextTokens = usage.contextTokens;
  if (usage.contextMaxTokens !== null && usage.contextMaxTokens !== undefined) record.contextMaxTokens = usage.contextMaxTokens;
}

/**
 * Whether a stored turn start may still be paired with an end. A missing (or archived) agent's
 * cannot; a mid-turn agent's can; an idle agent's can only when it went idle after the plugin
 * started, since then its turn-end hook is under way or about to arrive.
 */
export function turnMayStillEnd(agent: { status: string; updatedAt: string } | null, pluginStartedAt: number): boolean {
  if (agent === null) return false;
  if (isMidTurn(agent)) return true;
  const updatedAt = Date.parse(agent.updatedAt);
  return !Number.isNaN(updatedAt) && updatedAt >= pluginStartedAt;
}

export class Stats {
  private file: StatsFile | null = null;
  /** When each ticket's waiting was last written (see `waitingSeen`). */
  private readonly waitingWrittenAt = new Map<string, number>();

  private async load(): Promise<StatsFile> {
    if (this.file === null) {
      const parsed = StatsFileSchema.safeParse((await readJsonIfPresent(statePath("stats.json")).catch(() => null)) ?? {});
      this.file = parsed.success ? parsed.data : { tickets: {}, projects: {}, turnStarts: {}, costBackfill: null, repeatRepair: null };
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

  /** Records a status change; one into the status the ticket already has is ignored (TR-100). */
  transition(project: string, ticket: string, title: string, from: string | null, to: string, at: string): Promise<void> {
    return this.modify((file) => {
      const key = keyFor(project, ticket);
      const stats = file.tickets[key] ?? TicketStatsSchema.parse({ project, ticket });
      if (stats.transitions[stats.transitions.length - 1]?.to === to) return false;
      stats.title = title;
      stats.transitions.push({ from, to, at });
      file.tickets[key] = stats;
      return true;
    });
  }

  /** Each recorded ticket's last status, or null when none of the project's tickets was recorded. */
  async recordedStatuses(project: string): Promise<Map<string, string> | null> {
    const recorded = new Map<string, string>();
    for (const stats of await this.all(project)) {
      const last = stats.transitions[stats.transitions.length - 1];
      if (last !== undefined) recorded.set(stats.ticket, last.to);
    }
    return recorded.size === 0 ? null : recorded;
  }

  /**
   * The Needs-you check found these tickets' cards waiting on the user at `now` (TR-100): each
   * continues its stretch, or starts one after a gap. A child's waiting counts on its parent too.
   */
  waitingSeen(project: string, tickets: readonly string[], now: number = Date.now()): Promise<void> {
    if (tickets.length === 0) return Promise.resolve();
    const at = new Date(now).toISOString();
    return this.modify((file) => {
      // A continued stretch is written at most once a minute: the end moves in memory every check, and
      // a reload loses at most that minute.
      let write = false;
      for (const target of new Set(tickets.flatMap(ticketAndParent))) {
        const key = keyFor(project, target);
        const stats = file.tickets[key] ?? TicketStatsSchema.parse({ project, ticket: target });
        const last = stats.waiting[stats.waiting.length - 1];
        const sinceEnd = last === undefined ? Number.NaN : now - Date.parse(last.end);
        // A clock moved back must not put an end before its start: a new stretch starts instead.
        if (last !== undefined && sinceEnd >= 0 && sinceEnd <= WAITING_GAP_MS) {
          last.end = at;
          if (now - (this.waitingWrittenAt.get(key) ?? 0) >= WAITING_WRITE_EVERY_MS) write = true;
        } else {
          stats.waiting.push({ start: at, end: at });
          write = true;
        }
        file.tickets[key] = stats;
      }
      if (write) for (const target of new Set(tickets.flatMap(ticketAndParent))) this.waitingWrittenAt.set(keyFor(project, target), now);
      return write;
    });
  }

  /**
   * Drops, once, every recorded entry into the status its ticket already had (TR-100: the tracker
   * conversion announced every Done ticket again, stretching their wall time to it). Before its write
   * the file as it was is copied to `stats.json.pre-repair`. `repeatRepair` marks it done, and the
   * repair finds nothing on a second pass anyway. Returns the marker, or null when it had already run.
   */
  repairRepeats(): Promise<RepeatRepair | null> {
    let marker: RepeatRepair | null = null;
    return serialized("state:stats", async () => {
      const file = await this.load();
      if (file.repeatRepair !== null) return;
      const original = await readTextIfPresent(statePath("stats.json"));
      if (original !== null) await writeTextIfMissing(statePath("stats.json.pre-repair"), original);
      let removed = 0;
      for (const stats of Object.values(file.tickets)) {
        const kept = withoutRepeats(stats.transitions);
        removed += stats.transitions.length - kept.length;
        stats.transitions = kept;
      }
      marker = { at: new Date().toISOString(), removed };
      file.repeatRepair = marker;
      await writeJsonAtomically(statePath("stats.json"), file);
    }).then(() => marker);
  }

  turnStarted(agentId: string): Promise<void> {
    const at = new Date().toISOString();
    return this.modify((file) => {
      file.turnStarts[agentId] = at;
      return true;
    });
  }

  /**
   * Removes the agent's stored turn start and returns how long the turn ran until now, if it had one.
   * Queued in call order with the other stats work, so a turn end must call it before anything that
   * could drop the start is queued.
   */
  takeTurnDuration(agentId: string): Promise<number | undefined> {
    const endedAt = Date.now();
    let duration: number | undefined;
    return this.modify((file) => {
      const at = file.turnStarts[agentId];
      if (at === undefined) return false;
      delete file.turnStarts[agentId];
      const started = Date.parse(at);
      duration = Number.isNaN(started) ? undefined : Math.max(0, endedAt - started);
      return true;
    }).then(() => duration);
  }

  /**
   * After a reload or restart: drops stored starts whose turn ended while the plugin was down, since
   * pairing one with a later end would count the idle gap. A start the check cannot confirm, or one
   * replaced while it ran (a new turn), is kept.
   */
  async dropFinishedTurns(mayStillEnd: (agentId: string) => Promise<boolean>): Promise<number> {
    const stored = { ...(await serialized("state:stats", async () => (await this.load()).turnStarts)) };
    const finished: [string, string][] = [];
    for (const [agentId, at] of Object.entries(stored)) {
      if (!(await mayStillEnd(agentId).catch(() => true))) finished.push([agentId, at]);
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

  /**
   * `activeMs` is what `takeTurnDuration` returned when the turn ended; `usage` is Paseo's reading at
   * the turn end, so an agent's cost is recorded however it is archived later (TR-097). A child
   * ticket's agents and turns count toward its parent as well as itself (`projectTotals` relies on it).
   */
  async turnEnded(project: string, ticket: string | null, agent: { id: string; role: string; model: string | null; title: string | null }, activeMs: number | undefined, usage: AgentUsageReading = { costUsd: null, contextTokens: null }): Promise<void> {
    if (ticket === null) return;
    for (const target of ticketAndParent(ticket)) {
      await this.update(project, target, (stats) => {
        const record = stats.agents[agent.id] ?? { agentId: agent.id, role: agent.role, model: agent.model, title: agent.title, turns: 0, activeMs: 0, costUsd: null, contextTokens: null, contextMaxTokens: null, startingContextTokens: null };
        record.turns += 1;
        if (activeMs !== undefined) record.activeMs += activeMs;
        applyUsage(record, usage);
        stats.agents[agent.id] = record;
      });
    }
  }

  /** A later reading of an agent already recorded on `ticket` (at its archive or its ticket's release), on the parent too. */
  agentUsage(project: string, ticket: string, agentId: string, usage: AgentUsageReading): Promise<void> {
    return this.modify((file) => {
      let changed = false;
      for (const target of ticketAndParent(ticket)) {
        const record = file.tickets[keyFor(project, target)]?.agents[agentId];
        if (record === undefined) continue;
        applyUsage(record, usage);
        changed = true;
      }
      return changed;
    });
  }

  /** Whether an agent on `ticket` has its starting context recorded; false when the agent is not recorded there. */
  async hasStartingContext(project: string, ticket: string, agentId: string): Promise<boolean> {
    const record = (await this.load()).tickets[keyFor(project, ticket)]?.agents[agentId];
    return record !== undefined && record.startingContextTokens !== null;
  }

  /** Records an agent's starting context once, on the parent too; true when `ticket`'s record took it now. */
  async startingContext(project: string, ticket: string, agentId: string, tokens: number): Promise<boolean> {
    let taken = false;
    await this.modify((file) => {
      let changed = false;
      for (const target of ticketAndParent(ticket)) {
        const record = file.tickets[keyFor(project, target)]?.agents[agentId];
        if (record === undefined || record.startingContextTokens !== null) continue;
        record.startingContextTokens = tokens;
        changed = true;
        if (target === ticket) taken = true;
      }
      return changed;
    });
    return taken;
  }

  /**
   * Fills the cost of every recorded agent that has none, once (TR-097): `costOf` answers from
   * wherever the cost survives (the agent's transcript), null when it is gone. Before its write the
   * file as it was is copied to `stats.json.pre-backfill`, so a bad fill can be undone by copying it
   * back. Only missing costs are filled and `costBackfill` marks it done, so running it again changes
   * nothing. Returns the marker, or null when it had already run.
   */
  async backfillCosts(costOf: (agentId: string) => Promise<number | null>): Promise<CostBackfill | null> {
    const missing = await serialized("state:stats", async () => {
      const file = await this.load();
      if (file.costBackfill !== null) return null;
      return [...new Set(Object.values(file.tickets).flatMap((stats) => Object.values(stats.agents).filter((agent) => agent.costUsd === null).map((agent) => agent.agentId)))];
    });
    if (missing === null) return null;
    const found = new Map<string, number>();
    for (const agentId of missing) {
      const cost = await costOf(agentId).catch(() => null);
      if (cost !== null) found.set(agentId, cost);
    }
    let marker: CostBackfill | null = null;
    await serialized("state:stats", async () => {
      const file = await this.load();
      if (file.costBackfill !== null) return;
      const original = await readTextIfPresent(statePath("stats.json"));
      if (original !== null) await writeTextIfMissing(statePath("stats.json.pre-backfill"), original);
      const filled = new Set<string>();
      const stillMissing = new Set<string>();
      for (const stats of Object.values(file.tickets)) {
        for (const agent of Object.values(stats.agents)) {
          if (agent.costUsd !== null) continue;
          const cost = found.get(agent.agentId);
          if (cost === undefined) stillMissing.add(agent.agentId);
          else {
            agent.costUsd = cost;
            filled.add(agent.agentId);
          }
        }
      }
      marker = { at: new Date().toISOString(), filled: filled.size, missing: stillMissing.size };
      file.costBackfill = marker;
      await writeJsonAtomically(statePath("stats.json"), file);
    });
    return marker;
  }

  count(project: string, ticket: string, field: "nudges" | "decisions" | "recoveries" | "idleCompactions" | "permissionDenials"): Promise<void> {
    return this.update(project, ticket, (stats) => {
      stats[field] += 1;
    });
  }

  countProject(project: string, field: keyof ProjectStats): Promise<void> {
    return this.modify((file) => {
      const stats = file.projects[project] ?? ProjectStatsSchema.parse({});
      stats[field] += 1;
      file.projects[project] = stats;
      return true;
    });
  }

  /** Per-project counts (the manager's), summed over every project when `project` is null. */
  async projectCounts(project: string | null): Promise<ProjectStats> {
    const all = (await this.load()).projects;
    const picked = project === null ? Object.values(all) : [all[project] ?? ProjectStatsSchema.parse({})];
    return { idleCompactions: picked.reduce((total, stats) => total + stats.idleCompactions, 0) };
  }
}
