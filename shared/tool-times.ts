/**
 * What the plugin knows of how long each tool call of an agent took. Paseo stamps a call only with its
 * last change, and tells a plugin nothing as a call begins, so the plugin reads the running turn's
 * timeline every few seconds: a call first seen running began at its stamp (a running call has not
 * changed since), and the stamp it has once finished is its end. A call first seen already finished
 * began after the previous read, which bounds its length (`underMs`) without inventing a figure.
 */
import { z } from "zod";

/** How often a running turn's timeline is read. */
export const TOOL_POLL_MS = 5_000;

/** A gap between two reads longer than this (the plugin was stopped) bounds nothing. */
export const MAX_READ_GAP_MS = 3 * TOOL_POLL_MS;

/** The most calls kept per agent; the oldest go first. */
export const MAX_CALLS_PER_AGENT = 1500;

export const CallTimeSchema = z.object({
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  underMs: z.number().optional(),
});
export type CallTime = z.infer<typeof CallTimeSchema>;

export const AgentToolTimesSchema = z.object({
  lastReadAt: z.number().nullable(),
  calls: z.record(z.string(), CallTimeSchema),
});
export type AgentToolTimes = z.infer<typeof AgentToolTimesSchema>;

export function emptyToolTimes(): AgentToolTimes {
  return { lastReadAt: null, calls: {} };
}

/** The parts of a timeline entry this reads. */
export interface TimedEntry {
  timestamp: string;
  item: { type: string; callId?: string | undefined; status?: string | undefined };
}

/**
 * The record after one read of the timeline at `now`; its `calls` is the same object when no call changed, so the caller writes only then.
 * A call already finished with a start or a bound is never revised: the first sight is the best one.
 */
export function recordCalls(times: AgentToolTimes, entries: readonly TimedEntry[], now: number): AgentToolTimes {
  const calls = { ...times.calls };
  let changed = false;
  const gapOk = times.lastReadAt !== null && now - times.lastReadAt <= MAX_READ_GAP_MS;
  entries.forEach((entry) => {
    const { item } = entry;
    if (item.type !== "tool_call" || item.callId === undefined || item.callId === "") return;
    const stamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(stamp)) return;
    const known = calls[item.callId];
    if (item.status === "running") {
      if (known?.startedAt !== undefined) return;
      calls[item.callId] = { ...known, startedAt: Math.min(stamp, now) };
      changed = true;
      return;
    }
    if (item.status !== "completed" && item.status !== "failed") return;
    if (known?.endedAt !== undefined) return;
    if (known?.startedAt !== undefined) {
      calls[item.callId] = { ...known, endedAt: stamp };
    } else if (gapOk && times.lastReadAt !== null && stamp >= times.lastReadAt) {
      // Not running at the previous read, so it began after it.
      calls[item.callId] = { endedAt: stamp, underMs: stamp - times.lastReadAt };
    } else {
      // Finished before the previous read, or no trustworthy previous read: only its end is known.
      calls[item.callId] = { endedAt: stamp };
    }
    changed = true;
  });
  return { lastReadAt: now, calls: changed ? newest(calls) : times.calls };
}

function newest(calls: Record<string, CallTime>): Record<string, CallTime> {
  const ids = Object.keys(calls);
  if (ids.length <= MAX_CALLS_PER_AGENT) return calls;
  // Insertion order is the order calls were first noted: drop the oldest.
  return Object.fromEntries(ids.slice(ids.length - MAX_CALLS_PER_AGENT).map((id) => [id, calls[id] as CallTime]));
}
