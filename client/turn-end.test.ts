import { describe, expect, it } from "vitest";

import { drawnStatus, holdsTurnEnd, TURN_END_SETTLE_MS, type TurnEnd } from "./turn-end";

const ended = (change: Partial<TurnEnd> = {}): TurnEnd => ({ turn: "ended", endedAt: 1_000, readStatus: "running", turnCount: 3, stoppedAtCount: null, ...change });

describe("holding a turn's end until a read shows it (TR-291)", () => {
  it("holds an end the stream told of while the last read still shows the turn working", () => {
    expect(holdsTurnEnd(ended(), 1_000)).toBe(true);
    expect(holdsTurnEnd(ended({ readStatus: "initializing" }), 1_500)).toBe(true);
  });

  it("lets go once a read begun after the end landed, as the timeline then clears the boundary", () => {
    expect(holdsTurnEnd(ended({ turn: null }), 1_100)).toBe(false);
  });

  it("holds nothing for a turn start, or when the last read already shows the agent stopped", () => {
    expect(holdsTurnEnd(ended({ turn: "started" }), 1_100)).toBe(false);
    expect(holdsTurnEnd(ended({ readStatus: "idle" }), 1_100)).toBe(false);
    expect(holdsTurnEnd(ended({ readStatus: null }), 1_100)).toBe(false);
    expect(holdsTurnEnd(ended({ endedAt: null }), 1_100)).toBe(false);
  });

  it("lets go after the cap, so a read that never lands does not leave a finished agent looking busy", () => {
    expect(holdsTurnEnd(ended(), 1_000 + TURN_END_SETTLE_MS - 1)).toBe(true);
    expect(holdsTurnEnd(ended(), 1_000 + TURN_END_SETTLE_MS)).toBe(false);
  });

  it("never holds the end a Stop asked for: the stopped turn showed as ended at the press", () => {
    // Stop pressed at 2 boundaries seen; the stream's next boundary, the third, is the stopped turn's end.
    expect(holdsTurnEnd(ended({ stoppedAtCount: 2 }), 1_100)).toBe(false);
    // A later turn the queue started after the stop ends as any other.
    expect(holdsTurnEnd(ended({ stoppedAtCount: 2, turnCount: 5 }), 1_100)).toBe(true);
  });
});

describe("the status the chat draws", () => {
  it("is the last read's while an end is held, and the chat's own otherwise", () => {
    expect(drawnStatus("idle", ended(), 1_100)).toBe("running");
    expect(drawnStatus("idle", ended({ turn: null }), 1_100)).toBe("idle");
    expect(drawnStatus("running", ended({ turn: "started", readStatus: "idle" }), 1_100)).toBe("running");
  });
});
