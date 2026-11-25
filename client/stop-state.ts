/**
 * The stop button's press, held as the turn's end until the daemon's reads catch up: Stop turns into
 * Send at once and the working line ends, rather than spinning until `taro.agent.stop` answers and
 * then showing the red square again until the stream's turn end. Pure, for vitest.
 */
import type { PendingSend } from "../shared/pending-sends";

/** How long after the stop answered the chat goes on holding the turn as ended, at most. */
export const STOP_SETTLE_MS = 4_000;

export interface StopPress {
  agentId: string;
  /** When Stop (or Escape) was pressed (ms). */
  pressedAt: number;
  /** The stream's turn boundaries seen at the press (`useAgentTimeline`'s `turnCount`). */
  turnCountAtPress: number;
  /** When `taro.agent.stop` answered, null while it is on its way. */
  answeredAt: number | null;
  /** The stop failed: Stop and the working line come back. */
  failed: boolean;
}

/**
 * Whether the chat still shows this agent idle after a stop. `working` is the status before the hold
 * is applied. Released once the agent reads as not working, the stream reports any turn boundary
 * after the press (a count that went back to 0 when the timeline started over counts too), the stop
 * failed, or `STOP_SETTLE_MS` after it answered: a turn the queue starts after the stop then shows.
 */
export function stopHolds(press: StopPress | null, agent: { agentId: string; working: boolean; turnCount: number }, now: number): boolean {
  if (press === null || press.failed || press.agentId !== agent.agentId) return false;
  if (!agent.working || agent.turnCount !== press.turnCountAtPress) return false;
  return press.answeredAt === null || now - press.answeredAt < STOP_SETTLE_MS;
}

/** The messages sent during a failed stop's hold as if to an idle agent: they lose that mark and go to the queue track. */
export function heldSends(sends: readonly PendingSend[], pressedAt: number): string[] {
  return sends.filter((send) => send.at >= pressedAt && (send.state === "sending" || send.state === "queued") && send.sentWhileIdle === true).map((send) => send.id);
}
