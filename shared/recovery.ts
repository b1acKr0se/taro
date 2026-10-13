/**
 * Crash recovery and thread headroom (TR-012), as pure functions: which failed
 * turns are process crashes, how many automatic recoveries an agent may still
 * have, and whether the host has room for more threads. The 11:56 incident was a
 * 2,048-thread cgroup limit killing several Claude processes with SIGABRT at once.
 */
import { z } from "zod";

/** Usage above this share of the host's thread limit holds recoveries and new dispatches. */
export const HEADROOM_HIGH_RATIO = 0.85;
/** High usage becomes a Needs you item only once it has lasted this long; a brief spike is normal. */
export const HEADROOM_ALERT_AFTER_MS = 2 * 60_000;
/** Automatic recoveries allowed per agent within `RECOVERY_WINDOW_MS`; the next crash stalls it. */
export const MAX_RECOVERIES_PER_WINDOW = 2;
export const RECOVERY_WINDOW_MS = 60 * 60_000;

/**
 * Texts Paseo's Claude provider reports when the process dies: "Claude stopped unexpectedly (signal
 * SIGABRT)" while idle, "process exited with code N" / "terminated by signal" mid-turn, or the
 * stderr tail, which under thread exhaustion names the failed thread or fork call.
 */
const CRASH_PATTERNS = [
  /stopped unexpectedly/i,
  /terminated by signal/i,
  /\bsignal SIG[A-Z]+/i,
  /process exited with code/i,
  /resource temporarily unavailable/i,
  /pthread_create/i,
  /\bEAGAIN\b/,
];

export function isCrash(message: string): boolean {
  return CRASH_PATTERNS.some((pattern) => pattern.test(message));
}

/** The recoveries still inside the window, oldest first. */
export function recentRecoveries(recoveries: readonly string[], now: number): string[] {
  return recoveries.filter((at) => {
    const time = Date.parse(at);
    return !Number.isNaN(time) && time > now - RECOVERY_WINDOW_MS && time <= now;
  });
}

/** Whether a crash now may be recovered automatically, given the times of earlier recoveries. */
export function mayRecover(recoveries: readonly string[], now: number): boolean {
  return recentRecoveries(recoveries, now).length < MAX_RECOVERIES_PER_WINDOW;
}

export const HeadroomSchema = z.object({
  current: z.number().int(),
  max: z.number().int(),
  /** Above `HEADROOM_HIGH_RATIO` of the limit. */
  high: z.boolean(),
  /** When usage last went high, while it stays high. */
  highSince: z.string().nullable(),
});
export type Headroom = z.infer<typeof HeadroomSchema>;

/** `pids.current` and `pids.max` as read; null when either is missing, unreadable or "max" (no limit). */
export function parsePids(current: string | null, max: string | null): { current: number; max: number } | null {
  if (current === null || max === null) return null;
  const used = Number.parseInt(current.trim(), 10);
  const limit = Number.parseInt(max.trim(), 10);
  if (!/^\d+$/.test(current.trim()) || !/^\d+$/.test(max.trim()) || limit <= 0) return null;
  return { current: used, max: limit };
}

export function isHigh(pids: { current: number; max: number }): boolean {
  return pids.current > pids.max * HEADROOM_HIGH_RATIO;
}

/** Whether new threads may be spent now: always when the limit is unknown. */
export function hasHeadroom(pids: { current: number; max: number } | null): boolean {
  return pids === null || !isHigh(pids);
}

/** Whether high usage has lasted long enough to put in front of the user. */
export function headroomNeedsYou(headroom: Headroom | null, now: number): boolean {
  if (headroom === null || !headroom.high || headroom.highSince === null) return false;
  return now - Date.parse(headroom.highSince) >= HEADROOM_ALERT_AFTER_MS;
}

/** Something for the user that belongs to no ticket card: shown at the top of the board and in the Inbox. */
export const BoardAlertSchema = z.object({ id: z.string(), text: z.string() });
export type BoardAlert = z.infer<typeof BoardAlertSchema>;

/** The project's alerts: threads high for a while, and a manager the plugin stopped recovering. */
export function boardAlerts(headroom: Headroom | null, managerStalledReason: string | null, now: number): BoardAlert[] {
  const alerts: BoardAlert[] = [];
  if (headroom !== null && headroomNeedsYou(headroom, now)) {
    const percent = Math.round((headroom.current / headroom.max) * 100);
    alerts.push({
      id: "headroom",
      text: `The host is at ${headroom.current} of ${headroom.max} threads (${percent}%) and has been above ${Math.round(HEADROOM_HIGH_RATIO * 100)}% for a while. Crash recovery and new dispatches wait until it falls; stopping idle agents, test daemons or other sessions frees threads.`,
    });
  }
  if (managerStalledReason !== null) {
    alerts.push({ id: "manager-crashed", text: `The manager is stopped. ${managerStalledReason} Restart it from the project's settings.` });
  }
  return alerts;
}
