/**
 * Idle compaction (TR-015): an owner or manager left idle with a large context
 * is compacted just before its provider's prompt cache (an hour) expires, so the
 * compaction reads the context cached and the user's return reads a small one.
 */
import { z } from "zod";

import type { Role } from "./project";
import type { CompactionStage } from "./state";

export const IDLE_COMPACT_AFTER_MS = 55 * 60_000;
/** Past this the cache is cold: compacting would cost a full uncached read whether or not the user returns. */
export const IDLE_COMPACT_WINDOW_MS = 5 * 60_000;

/**
 * Where the agent is in the idle pipeline: `running` from the handoff request until the reload's turn
 * ends, then `done` until a turn the pipeline did not cause ends. Only `none` may start one, so an
 * agent the compaction left above the threshold is not compacted again every hour.
 */
export const IdleCompactionSchema = z.enum(["none", "running", "done"]);
export type IdleCompaction = z.infer<typeof IdleCompactionSchema>;

/** The idle state after a turn ends; `stage` is the compaction stage the turn ended in. */
export function idleCompactionAfterTurn(current: IdleCompaction, stage: CompactionStage): IdleCompaction {
  // The handoff and /compact turns are the pipeline's own; the first turn ending outside them is the reload.
  if (stage !== "none") return current;
  return current === "running" ? "done" : "none";
}

export interface IdleCandidate {
  role: Role;
  /** Paseo's status: only `idle` qualifies (not running, initializing, error or closed). */
  status: string;
  pendingPermissions: number;
  stage: CompactionStage;
  idle: IdleCompaction;
  /** When its last turn ended, as the plugin saw it. */
  lastTurnEndedAt: string | null;
  usedTokens: number | null | undefined;
}

export function idleCompactionDue(candidate: IdleCandidate, thresholdTokens: number, now: number, afterMs: number = IDLE_COMPACT_AFTER_MS): boolean {
  if (candidate.role !== "owner" && candidate.role !== "manager") return false;
  if (candidate.status !== "idle" || candidate.pendingPermissions > 0) return false;
  if (candidate.stage !== "none" || candidate.idle !== "none") return false;
  if (typeof candidate.usedTokens !== "number" || candidate.usedTokens <= thresholdTokens) return false;
  const endedAt = candidate.lastTurnEndedAt === null ? Number.NaN : Date.parse(candidate.lastTurnEndedAt);
  if (Number.isNaN(endedAt)) return false;
  const idleFor = now - endedAt;
  return idleFor >= afterMs && idleFor < afterMs + IDLE_COMPACT_WINDOW_MS;
}

/** A test daemon's shorter idle time (`TARO_IDLE_COMPACT_AFTER_SECONDS`), so an end-to-end check need not wait an hour. */
export function idleCompactAfterMs(override: string | undefined): number {
  const seconds = override === undefined ? Number.NaN : Number(override);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : IDLE_COMPACT_AFTER_MS;
}
