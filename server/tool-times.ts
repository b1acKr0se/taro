/**
 * Reads a Taro agent's timeline every few seconds while its turn runs and keeps when each tool call
 * began and ended, one file per agent (`<plugin data>/tool-times/<agent id>.json`), so the chat can say
 * how long a call took after a reload (`shared/tool-times.ts` says how). Paseo tells a plugin nothing
 * as a call begins, so reading is the only way to see one run.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AgentToolTimesSchema, emptyToolTimes, recordCalls, TOOL_POLL_MS, type AgentToolTimes, type CallTime } from "../shared/tool-times";
import { isMidTurn, projectAgents } from "./agents";
import { dataPath } from "./data-dir";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import type { PaseoApi } from "./host-types";
import { serialized } from "./serialize";

/** Calls older than the tail read are never in it, so a limit as long as supervision's is plenty. */
const TAIL_LIMIT = 60;

function fileFor(agentId: string): string {
  return join(dataPath("tool-times"), `${agentId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

async function load(agentId: string): Promise<AgentToolTimes> {
  try {
    return AgentToolTimesSchema.parse(await readJsonIfPresent(fileFor(agentId)));
  } catch {
    // No file yet, or a damaged one: start over rather than fail a turn.
    return emptyToolTimes();
  }
}

export async function readCallTimes(agentId: string): Promise<Record<string, CallTime>> {
  return (await load(agentId)).calls;
}

/** Agents whose record was dropped at archive: a read already under way must not write it back. Ids are never reused. */
const forgotten = new Set<string>();

export async function forgetCallTimes(agentId: string): Promise<void> {
  forgotten.add(agentId);
  lastRead.delete(agentId);
  const file = fileFor(agentId);
  // Queued behind a read under way, so its write cannot land after the delete.
  await serialized(file, () => rm(file, { force: true }));
}

/** When each agent's timeline was last read: the file is rewritten only when a call changed, so this is newer than the file's. */
const lastRead = new Map<string, number>();

/** One read of the agent's timeline, recorded; the file is written only when a call changed. */
export async function readAndRecord(paseo: PaseoApi, agentId: string, now: number = Date.now()): Promise<void> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: TAIL_LIMIT, projection: "projected" });
  const file = fileFor(agentId);
  await serialized(file, async () => {
    if (forgotten.has(agentId)) return;
    const stored = await load(agentId);
    const before = { ...stored, lastReadAt: Math.max(stored.lastReadAt ?? 0, lastRead.get(agentId) ?? 0) || null };
    const after = recordCalls(before, page.entries, now);
    lastRead.set(agentId, now);
    if (after.calls !== before.calls) await writeJsonAtomically(file, after);
  });
}

export interface ToolTimePollers {
  /** Notes, at once, that the agent's turn began: `start` may come after a lookup, by when the turn may be over. */
  turnStarted(agentId: string): void;
  /** Starts reading an agent's running turn; a second start for the same agent does nothing, and one for a turn already over reads once. */
  start(paseo: PaseoApi, agentId: string, onFailure: (error: unknown) => void): void;
  /** One last read as the turn ends, then no more; nothing for an agent that was not started. */
  finish(paseo: PaseoApi, agentId: string, onFailure: (error: unknown) => void): Promise<void>;
  /** Stops reading without a last read (an archived agent). */
  cancel(agentId: string): void;
  stopAll(): void;
}

export function toolTimePollers(): ToolTimePollers {
  const turning = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  const stop = (agentId: string): void => {
    const timer = timers.get(agentId);
    if (timer === undefined) return;
    clearInterval(timer);
    timers.delete(agentId);
  };
  return {
    turnStarted(agentId) {
      turning.add(agentId);
    },
    start(paseo, agentId, onFailure) {
      if (timers.has(agentId)) return;
      if (!turning.has(agentId)) {
        // The turn ended while the caller looked the agent up: no poller to leave running, one read for its calls.
        void readAndRecord(paseo, agentId).catch(onFailure);
        return;
      }
      let reading = false;
      const tick = (): void => {
        if (reading) return;
        reading = true;
        readAndRecord(paseo, agentId)
          .catch(onFailure)
          .finally(() => {
            reading = false;
          });
      };
      timers.set(agentId, setInterval(tick, TOOL_POLL_MS));
      tick();
    },
    async finish(paseo, agentId, onFailure) {
      turning.delete(agentId);
      if (!timers.has(agentId)) return;
      stop(agentId);
      await readAndRecord(paseo, agentId).catch(onFailure);
    },
    cancel(agentId) {
      turning.delete(agentId);
      stop(agentId);
    },
    stopAll() {
      turning.clear();
      [...timers.keys()].forEach(stop);
    },
  };
}

/** After a plugin start: Taro agents mid-turn are read from now on, as the turn start that would have begun it was missed. */
export async function resumeToolTimes(paseo: PaseoApi, projects: readonly string[], pollers: ToolTimePollers, onFailure: (error: unknown) => void): Promise<number> {
  const running = (await Promise.all(projects.map((project) => projectAgents(paseo, project)))).flat().filter((agent) => isMidTurn(agent));
  running.forEach((agent) => {
    pollers.turnStarted(agent.id);
    pollers.start(paseo, agent.id, onFailure);
  });
  return running.length;
}
