/**
 * The times a finished turn's footer shows (TR-202): how long the turn took ("Worked for 2m 12s") and
 * when it ended, which the label swaps to on hover or tap.
 *
 * Ported from Paseo (5293dda, Apache-2.0): `formatDuration` and `formatMessageTimestamp` from
 * `packages/app/src/utils/time.ts`, and the turn's duration from `src/timeline/turn-time.ts`. Changed:
 * times come as the timeline's ISO strings, and the clock is `toLocaleTimeString` (Hermes has no
 * reliable `Intl.DateTimeFormat`), which follows the phone's 12 or 24 hour setting on its own.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A span at a glance: whole seconds under a minute ("47s"), then "2m 12s", "1h 5m". */
export function formatTurnDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0s";
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) return `${Math.floor(totalSeconds)}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = Math.floor(totalSeconds) % 60;
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Local midnights between two instants: 0 for the same day, 1 for yesterday (rounded, so a DST day still counts as one). */
function calendarDaysBetween(earlier: Date, later: Date): number {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / DAY_MS);
}

/** The clock in the user's own style ("10:11 PM" or "22:11"). */
function clockOf(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * When a turn ended: the time alone for today, the weekday and time for the last six days, else the
 * date and time. Empty when `iso` is missing or unreadable.
 */
export function formatMessageTimestamp(iso: string | undefined, now: Date = new Date()): string {
  if (iso === undefined) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = calendarDaysBetween(date, now);
  if (days === 0) return clockOf(date);
  if (days > 0 && days < 7) return `${date.toLocaleDateString([], { weekday: "long" })} ${clockOf(date)}`;
  return `${date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}, ${clockOf(date)}`;
}

/** The turn took from the user's message to its last item; null when either time is missing. */
export function turnDurationMs(startedAt: string | undefined, endedAt: string | undefined): number | null {
  if (startedAt === undefined || endedAt === undefined) return null;
  const started = new Date(startedAt).getTime();
  const ended = new Date(endedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(ended)) return null;
  return Math.max(0, ended - started);
}

/** The label shown at rest ("Worked for 11s") and the end time it swaps to; either is empty when unknown. */
export function footerLabels(turn: { durationMs: number | null; completedAt?: string }, now?: Date): { duration: string; endedAt: string } {
  return {
    duration: turn.durationMs === null ? "" : `Worked for ${formatTurnDuration(turn.durationMs)}`,
    endedAt: formatMessageTimestamp(turn.completedAt, now),
  };
}
