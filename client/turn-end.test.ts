import { describe, expect, it } from "vitest";

import { turnTracker } from "./stream-pieces";
import { drawnStatus, endFollowsWork, holdsTurnEnd, readEndsHold, TURN_END_SETTLE_MS, type TurnEnd } from "./turn-end";

/** The chat's turn end as `useAgentTimeline` keeps it, event by event: boundaries, reads begun and landed. */
function replay() {
  const turns = turnTracker();
  let readStatus = "idle";
  let fromWork = false;
  let startedAtCount = 0;
  let endedAt: number | null = null;
  return {
    boundary(turn: "started" | "ended", at: number): void {
      fromWork = turn === "ended" && endFollowsWork(turns.current(), readStatus);
      turns.boundary(turn);
      if (turn === "started") startedAtCount = turns.count();
      if (turn === "ended") endedAt = at;
    },
    readStarts: () => turns.readStarted(),
    lands(token: number, status: string): void {
      turns.readLanded(token);
      readStatus = status;
      if (fromWork && readEndsHold(token, startedAtCount, status)) fromWork = false;
    },
    held: (now: number) => holdsTurnEnd({ turn: turns.current(), endedAt, fromWork, turnCount: turns.count(), stoppedAtCount: null }, now),
  };
}

const ended = (change: Partial<TurnEnd> = {}): TurnEnd => ({ turn: "ended", endedAt: 1_000, fromWork: true, turnCount: 3, stoppedAtCount: null, ...change });

describe("holding a turn's end until a read shows it (TR-291)", () => {
  it("holds an end the stream told of while the chat drew the turn under way", () => {
    expect(holdsTurnEnd(ended(), 1_000)).toBe(true);
    expect(holdsTurnEnd(ended(), 1_500)).toBe(true);
  });

  it("lets go once a read begun after the end landed, as the timeline then clears the boundary", () => {
    expect(holdsTurnEnd(ended({ turn: null }), 1_100)).toBe(false);
  });

  it("holds nothing for a turn start, or an end the chat did not draw as under way", () => {
    expect(holdsTurnEnd(ended({ turn: "started" }), 1_100)).toBe(false);
    expect(holdsTurnEnd(ended({ fromWork: false }), 1_100)).toBe(false);
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
  it("is running while an end is held, and the chat's own otherwise", () => {
    expect(drawnStatus("idle", ended(), 1_100)).toBe("running");
    expect(drawnStatus("idle", ended({ turn: null }), 1_100)).toBe("idle");
    expect(drawnStatus("running", ended({ turn: "started", fromWork: false }), 1_100)).toBe("running");
    expect(drawnStatus("idle", ended({ fromWork: false }), 1_100)).toBe("idle");
  });
});

describe("a read that lets a held end go", () => {
  it("is one begun once the turn's start was seen, showing the agent not working", () => {
    expect(readEndsHold(1, 1, "idle")).toBe(true);
    expect(readEndsHold(2, 1, "error")).toBe(true);
    expect(readEndsHold(2, 1, undefined)).toBe(true);
  });

  it("is not one showing the agent still working, nor one begun before the start", () => {
    expect(readEndsHold(1, 1, "running")).toBe(false);
    expect(readEndsHold(1, 1, "initializing")).toBe(false);
    expect(readEndsHold(0, 1, "idle")).toBe(false);
  });
});

describe("what a turn's end follows, decided as it comes", () => {
  it("is work when the stream's start was still ahead of the reads, or the last read showed the turn working", () => {
    expect(endFollowsWork("started", "idle")).toBe(true);
    expect(endFollowsWork("started", undefined)).toBe(true);
    expect(endFollowsWork(null, "running")).toBe(true);
    expect(endFollowsWork(null, "initializing")).toBe(true);
  });

  it("is not when nothing showed the turn: the last read idle and no start ahead of it", () => {
    expect(endFollowsWork(null, "idle")).toBe(false);
    expect(endFollowsWork(null, undefined)).toBe(false);
    // An end after an end the reads have not caught up with: the chat already drew the agent stopped.
    expect(endFollowsWork("ended", "idle")).toBe(false);
  });

  it("holds a turn shorter than a read from its end until a read begun after the end lands, never letting go and back (review F1)", () => {
    const chat = replay();
    chat.boundary("started", 1_000);
    const readAtStart = chat.readStarts();
    chat.boundary("ended", 1_200);
    const shown = [chat.held(1_200)];
    // The read begun at the start lands still showing the turn running; the end is still ahead of it.
    chat.lands(readAtStart, "running");
    shown.push(chat.held(1_500));
    // The read begun at the end lands, with the reply.
    chat.lands(chat.readStarts(), "idle");
    shown.push(chat.held(1_800));
    expect(shown).toEqual([true, true, false]);
  });

  it("lets go with a read begun before the end that already shows the agent stopped, as it holds the reply (review F3)", () => {
    const chat = replay();
    chat.boundary("started", 1_000);
    const readInTurn = chat.readStarts();
    chat.boundary("ended", 1_200);
    const shown = [chat.held(1_200)];
    chat.lands(readInTurn, "idle");
    shown.push(chat.held(1_300));
    expect(shown).toEqual([true, false]);
  });

  it("keeps holding when a read begun before the turn's start lands idle after its end: it lacks the turn's words", () => {
    const chat = replay();
    const readBeforeStart = chat.readStarts();
    chat.boundary("started", 1_000);
    chat.boundary("ended", 1_200);
    chat.lands(readBeforeStart, "idle");
    expect(chat.held(1_300)).toBe(true);
  });
});
