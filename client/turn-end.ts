/**
 * A turn's end drawn when the read that shows it lands, not when the stream tells of it (TR-291).
 *
 * The stream says a turn ended at once (TR-201), but a reply written after a tool call reaches the
 * chat only with the next read (`stream-pieces.ts` draws pieces only straight after the read). Ending
 * the loader on the stream's word left the chat on a bare tool call, then the reply and its footer
 * jumped in a read's round trip later. Stop and Send still follow the stream at once: only what the
 * transcript draws (the loader, the newest footer, a running call) waits. Pure, for vitest.
 */
import { isWorking, type TurnBoundary } from "../shared/pending-sends";

/** How long after the stream's end the chat goes on drawing the turn, at most, when no read lands. */
export const TURN_END_SETTLE_MS = 5_000;

export interface TurnEnd {
  /** The stream's boundary still ahead of the last read (`useAgentTimeline`'s `turn`). */
  turn: TurnBoundary | null;
  /** When the stream told of it (ms). */
  endedAt: number | null;
  /** The agent's status in the last read: a read begun before the end. */
  readStatus: string | null | undefined;
  /** The stream's boundaries seen so far. */
  turnCount: number;
  /** The boundaries seen when Stop was last pressed and not failed, null when it was not. */
  stoppedAtCount: number | null;
}

/**
 * Whether the chat still draws the turn as under way: the stream said it ended, the last read still
 * shows it working, and within `TURN_END_SETTLE_MS`. Never the end a Stop asked for (the stream's
 * first boundary after the press), which the chat already showed as ended at the press.
 */
export function holdsTurnEnd(end: TurnEnd, now: number): boolean {
  if (end.turn !== "ended" || end.endedAt === null || !isWorking(end.readStatus)) return false;
  if (end.stoppedAtCount !== null && end.turnCount === end.stoppedAtCount + 1) return false;
  return now - end.endedAt < TURN_END_SETTLE_MS;
}

/** The status the transcript draws: the last read's while an end is held, else `status`. */
export function drawnStatus(status: string, end: TurnEnd, now: number): string {
  return holdsTurnEnd(end, now) ? (end.readStatus ?? status) : status;
}
