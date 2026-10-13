/**
 * Crash recovery (TR-012). A Taro agent whose process died is queued here; one
 * timer recovers queued agents one at a time, and only while the host has thread
 * headroom, because the crash that queued them was most likely the thread limit
 * and every restart spends threads again. Recovery is `paseo agent reload` (the
 * same agent and conversation in a new process) plus one message; when the
 * reload fails, owners are relaunched, the manager restarted, and a helper's or
 * reviewer's owner told. Past the hourly limit the agent is left stalled.
 *
 * The same timer holds the plugin's own wake-ups to the manager ("a slot is
 * free") while threads are short, and sends them once they are not.
 */
import { hasHeadroom, isCrash, mayRecover, recentRecoveries, MAX_RECOVERIES_PER_WINDOW, RECOVERY_WINDOW_MS } from "../shared/recovery";
import { fetchLiveAgent } from "./agents";
import { runPaseoJson } from "./cli";
import { readHeadroom } from "./headroom";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { restartManager } from "./manager";
import { TEMPLATES, message, skillDirectory } from "./package-files";
import { projectPaths, requireProjectConfig } from "./projects";
import { sendFromPlugin } from "./send";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { currentOwner, freshState, identityFromLabels, type TaroIdentity } from "./supervision";
import { appendTicketNote } from "./tickets";

/** How often the queue is looked at; also the spacing between two recoveries. */
const TICK_MS = 15_000;
/** A moment for the dead process to be reaped before the first restart. */
const FIRST_TICK_MS = 5_000;

interface QueuedCrash {
  agentId: string;
  error: string;
  crashedAt: string;
}

export type RelaunchOwner = (paseo: PaseoApi, project: string, ticket: string) => Promise<string>;

export class Recovery {
  private readonly queue: QueuedCrash[] = [];
  /** Wake-ups for each project's manager, held while threads are short. */
  private readonly heldForManager = new Map<string, string[]>();
  private paseo: PaseoApi | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  /** Set when the plugin unloads: a tick still running must not arm a timer for a dead instance. */
  private disposed = false;
  private relaunchOwner: RelaunchOwner | null = null;

  constructor(
    private readonly state: PluginState,
    private readonly stats: Stats,
  ) {}

  /** The owner relaunch lives in `Actions`, which is built after this. */
  setRelaunchOwner(relaunch: RelaunchOwner): void {
    this.relaunchOwner = relaunch;
  }

  /** A Taro agent's turn failed with a crash: queue it, or stall it when it has crashed too often. */
  async onCrash(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity, error: string): Promise<void> {
    if (this.disposed) return;
    this.paseo = paseo;
    if (this.queue.some((queued) => queued.agentId === agent.id)) return;
    const now = Date.now();
    const known = await this.state.agent(agent.id);
    if (!mayRecover(known?.recoveries ?? [], now)) {
      const reason = `crashed ${MAX_RECOVERIES_PER_WINDOW + 1} times within an hour, so it was not restarted again (last: ${oneLine(error)})`;
      await this.giveUp(paseo, agent, identity, reason);
      await this.note(identity, `RECOVERY ${new Date(now).toISOString()} — ${identity.role} ${agent.id} ${reason}; it is left stalled for the user.`);
      return;
    }
    this.queue.push({ agentId: agent.id, error, crashedAt: new Date(now).toISOString() });
    console.warn(`[taro] ${identity.role} ${agent.id} (${identity.ticket ?? identity.project}) crashed: ${oneLine(error)}; queued for recovery`);
    this.schedule(FIRST_TICK_MS);
  }

  /**
   * After a start: agents a crash left in error while the plugin was not running. Only recent ones:
   * an agent the user has left crashed for longer is theirs to deal with.
   */
  async recoverLeftovers(paseo: PaseoApi, agents: readonly PaseoAgent[]): Promise<number> {
    let queued = 0;
    for (const agent of agents) {
      const error = agent.lastError ?? "";
      if (agent.status !== "error" || !isCrash(error)) continue;
      if (Date.now() - Date.parse(agent.updatedAt) > RECOVERY_WINDOW_MS) continue;
      // Given up on already: a restart must not record it again.
      const known = await this.state.agent(agent.id);
      if (known !== null && known.stalledReason !== null) continue;
      const identity = identityFromLabels(agent.labels, agent.title ?? null);
      if (identity === null) continue;
      await this.onCrash(paseo, agent, identity, error);
      queued += 1;
    }
    return queued;
  }

  /** Sends to the manager now, or once threads allow when they are short. */
  async tellManagerWhenHeadroom(paseo: PaseoApi, project: string, managerId: string, text: string): Promise<void> {
    if (this.disposed) return;
    this.paseo = paseo;
    const headroom = await readHeadroom();
    if (hasHeadroom(headroom) && !this.heldForManager.has(project)) {
      await sendFromPlugin(paseo, managerId, text);
      return;
    }
    this.heldForManager.set(project, [...(this.heldForManager.get(project) ?? []), text]);
    console.warn(`[taro] threads short (${headroom === null ? "?" : `${headroom.current}/${headroom.max}`}); holding a message to ${project}'s manager`);
    this.schedule(TICK_MS);
  }

  /** The next instance's start-up pass finds agents still in error, so nothing queued here is lost. */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
    this.heldForManager.clear();
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null || this.busy || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    const paseo = this.paseo;
    if (paseo === null || this.busy || this.disposed) return;
    this.busy = true;
    try {
      const headroom = await readHeadroom();
      if (!hasHeadroom(headroom)) return;
      const next = this.queue.shift();
      if (next !== undefined) await this.recover(paseo, next);
      else await this.releaseHeld(paseo, headroom === null ? "?" : String(headroom.current), headroom === null ? "?" : String(headroom.max));
    } catch (error: unknown) {
      console.error("[taro] crash recovery:", error);
    } finally {
      this.busy = false;
      if (this.queue.length > 0 || this.heldForManager.size > 0) this.schedule(TICK_MS);
    }
  }

  private async recover(paseo: PaseoApi, crash: QueuedCrash): Promise<void> {
    const agent = await fetchLiveAgent(paseo, crash.agentId);
    // Archived, or no longer in error (the user, or a previous plugin instance, restarted it): nothing to do.
    if (agent === null || agent.status !== "error") return;
    const identity = identityFromLabels(agent.labels, agent.title ?? null);
    if (identity === null) return;
    const at = new Date().toISOString();
    const attempt = await this.state.updateAgent(agent.id, () => freshState(identity), (record) => {
      record.recoveries = [...recentRecoveries(record.recoveries, Date.parse(at)), at];
      // A handoff or /compact the crash cut short: its next turn answers the recovery, not the pipeline.
      record.compaction = "none";
      return record.recoveries.length;
    });
    if (identity.ticket !== null) await this.stats.count(identity.project, identity.ticket, "recoveries").catch(() => undefined);

    let outcome: string;
    try {
      await runPaseoJson(["agent", "reload", agent.id], "a crashed agent cannot be reloaded");
      await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.crashRecovery, { error: oneLine(crash.error), skill: await skillDirectory() }));
      outcome = `reloaded ${agent.id} in place (its conversation kept) and told it to check its checkout and continue`;
    } catch (error: unknown) {
      const reloadError = error instanceof Error ? error.message : String(error);
      console.warn(`[taro] reloading ${agent.id} failed: ${reloadError}`);
      outcome = `reload failed (${oneLine(reloadError)}); ${await this.fallBack(paseo, agent, identity, reloadError)}`;
    }
    console.log(`[taro] recovered ${identity.role} ${agent.id}: ${outcome}`);
    await this.note(identity, `RECOVERY ${at} — ${identity.role} ${agent.id} crashed at ${crash.crashedAt} ("${oneLine(crash.error)}"); the plugin ${outcome}. Automatic recovery ${attempt} of ${MAX_RECOVERIES_PER_WINDOW} this hour.`);
  }

  /** What replaces a reload that failed; returns what it did, for the note. */
  private async fallBack(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity, reloadError: string): Promise<string> {
    try {
      if (identity.role === "owner" && identity.ticket !== null && this.relaunchOwner !== null) {
        const relaunched = await this.relaunchOwner(paseo, identity.project, identity.ticket);
        return `relaunched a fresh owner ${relaunched} from the ticket`;
      }
      if (identity.role === "manager") {
        const config = await requireProjectConfig(identity.project);
        if (config.managerAgentId !== agent.id) return "left it: it is no longer the project's manager";
        const restarted = await restartManager(paseo, identity.project);
        return `restarted the manager as ${restarted.agentId}`;
      }
    } catch (error: unknown) {
      const reason = `the fallback failed too (${oneLine(error instanceof Error ? error.message : String(error))})`;
      await this.giveUp(paseo, agent, identity, reason);
      return `${reason}; left it stalled`;
    }
    const reason = `its reload failed (${oneLine(reloadError)})`;
    await this.giveUp(paseo, agent, identity, reason);
    return "left it stalled";
  }

  /** Leaves the agent stalled with the reason; a helper's or reviewer's owner is told. */
  private async giveUp(paseo: PaseoApi, agent: PaseoAgent, identity: TaroIdentity, reason: string): Promise<void> {
    console.warn(`[taro] not recovering ${identity.role} ${agent.id}: ${reason}`);
    await this.state.updateAgent(agent.id, () => freshState(identity), (record) => {
      record.stalled = true;
      record.stalledReason = `Crashed: ${reason}.`;
    });
    if (identity.role === "helper" || identity.role === "reviewer") {
      const owner = await currentOwner(paseo, identity.project, identity.ticket, agent.labels["paseo.parent-agent-id"] ?? null).catch(() => null);
      if (owner !== null) {
        await sendFromPlugin(
          paseo,
          owner.id,
          await message(TEMPLATES.helperCrashed, { role: identity.role, title: identity.title ?? agent.id, agentId: agent.id, ticket: identity.ticket ?? "your ticket", reason }),
        ).catch(() => undefined);
      }
    }
  }

  private async note(identity: TaroIdentity, record: string): Promise<void> {
    if (identity.ticket === null) return;
    const paths = await projectPaths(identity.project);
    await appendTicketNote(paths.tracker, identity.ticket, record).catch((error: unknown) => {
      console.warn(`[taro] could not record a recovery on ${identity.ticket}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async releaseHeld(paseo: PaseoApi, current: string, max: string): Promise<void> {
    for (const [project, texts] of [...this.heldForManager]) {
      this.heldForManager.delete(project);
      const config = await requireProjectConfig(project).catch(() => null);
      const manager = config === null ? null : await fetchLiveAgent(paseo, config.managerAgentId);
      if (manager === null) continue;
      const opening = await message(TEMPLATES.headroomRecovered, { current, max });
      try {
        await sendFromPlugin(paseo, manager.id, [opening, ...texts].join("\n\n---\n\n"));
      } catch (error: unknown) {
        // Kept for the next tick (ahead of anything held since), not dropped.
        this.heldForManager.set(project, [...texts, ...(this.heldForManager.get(project) ?? [])]);
        throw error;
      }
    }
  }
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}
