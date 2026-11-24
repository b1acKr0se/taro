/**
 * Reads a Taro agent's timeline every few seconds while its turn runs and keeps when each tool call
 * began and ended, one file per agent (`<plugin data>/tool-times/<agent id>.json`), so the chat can say
 * how long a call took after a reload (`shared/tool-times.ts` says how). Paseo tells a plugin nothing
 * as a call begins, so reading is the only way to see one run.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AgentToolTimesSchema, emptyToolTimes, recordCalls, TOOL_POLL_MS, type AgentToolTimes, type CallTime } from "../shared/tool-times";
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

export async function forgetCallTimes(agentId: string): Promise<void> {
  lastRead.delete(agentId);
  await rm(fileFor(agentId), { force: true });
}

/** When each agent's timeline was last read: the file is rewritten only when a call changed, so this is newer than the file's. */
const lastRead = new Map<string, number>();

/** One read of the agent's timeline, recorded; the file is written only when a call changed. */
export async function readAndRecord(paseo: PaseoApi, agentId: string, now: number = Date.now()): Promise<void> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: TAIL_LIMIT, projection: "projected" });
  const file = fileFor(agentId);
  await serialized(file, async () => {
    const stored = await load(agentId);
    const before = { ...stored, lastReadAt: Math.max(stored.lastReadAt ?? 0, lastRead.get(agentId) ?? 0) || null };
    const after = recordCalls(before, page.entries, now);
    lastRead.set(agentId, now);
    if (after.calls !== before.calls) await writeJsonAtomically(file, after);
  });
}

export interface ToolTimePollers {
  /** Starts reading an agent's running turn; a second start for the same agent does nothing. */
  start(paseo: PaseoApi, agentId: string, onFailure: (error: unknown) => void): void;
  /** One last read as the turn ends, then no more; nothing for an agent that was not started. */
  finish(paseo: PaseoApi, agentId: string, onFailure: (error: unknown) => void): Promise<void>;
  /** Stops reading without a last read (an archived agent). */
  cancel(agentId: string): void;
  stopAll(): void;
}

export function toolTimePollers(): ToolTimePollers {
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  const stop = (agentId: string): void => {
    const timer = timers.get(agentId);
    if (timer === undefined) return;
    clearInterval(timer);
    timers.delete(agentId);
  };
  return {
    start(paseo, agentId, onFailure) {
      if (timers.has(agentId)) return;
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
      if (!timers.has(agentId)) return;
      stop(agentId);
      await readAndRecord(paseo, agentId).catch(onFailure);
    },
    cancel: stop,
    stopAll() {
      [...timers.keys()].forEach(stop);
    },
  };
}
