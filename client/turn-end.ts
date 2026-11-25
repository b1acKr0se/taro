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
  /** The chat drew the turn under way as the end came (`endFollowsWork`), decided then and kept: a read that lands later never changes it. */
  fromWork: boolean;
  /** The stream's boundaries seen so far. */
  turnCount: number;
  /** The boundaries seen when Stop was last pressed and not failed, null when it was not. */
  stoppedAtCount: number | null;
}

/**
 * Whether the chat drew a turn under way just before the stream told of its end: the stream's start
 * was still ahead of the reads, or the last read showed it working. A turn shorter than a read has
 * only the start to show for it, and a read begun before the end that lands after it must not turn
 * the hold on then: the loader would go and come back.
 */
export function endFollowsWork(ahead: TurnBoundary | null, readStatus: string | null | undefined): boolean {
  return ahead === "started" || isWorking(readStatus);
}

/**
 * Whether the chat still draws the turn as under way: the stream said it ended, the turn was drawn
 * under way as it did, and within `TURN_END_SETTLE_MS`. Never the end a Stop asked for (the stream's
 * first boundary after the press), which the chat already showed as ended at the press.
 */
export function holdsTurnEnd(end: TurnEnd, now: number): boolean {
  if (end.turn !== "ended" || end.endedAt === null || !end.fromWork) return false;
  if (end.stoppedAtCount !== null && end.turnCount === end.stoppedAtCount + 1) return false;
  return now - end.endedAt < TURN_END_SETTLE_MS;
}

/** The status the transcript draws: running while an end is held, else `status`. */
export function drawnStatus(status: string, end: TurnEnd, now: number): string {
  return holdsTurnEnd(end, now) ? "running" : status;
}
