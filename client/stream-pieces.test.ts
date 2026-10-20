import { describe, expect, it } from "vitest";

import { drawnWithPieces, streamedPiece, turnBoundary, unreadPieces, withStreamed, type StreamedPiece } from "./stream-pieces";
import { transcriptRows, whileWriting, type TimelineEntry } from "./transcript-rows";

const EPOCH = "epoch-1";

function entry(seqStart: number, seqEnd: number, item: Record<string, unknown>, turnId = "turn-1"): TimelineEntry {
  return { provider: "claude", item, turnId, timestamp: "2026-01-01T00:00:00Z", seqStart, seqEnd, sourceSeqRanges: [{ startSeq: seqStart, endSeq: seqEnd }], collapsed: [] } as unknown as TimelineEntry;
}

function event(seq: number, text: string, epoch = EPOCH, turnId = "turn-1"): unknown {
  return { agentId: "agent-1", event: { type: "timeline", provider: "claude", item: { type: "assistant_message", text }, turnId }, timestamp: "2026-01-01T00:00:01Z", seq, epoch };
}

function piece(seq: number, text: string, epoch = EPOCH): StreamedPiece {
  const made = streamedPiece(event(seq, text, epoch));
  if (made === null) throw new Error("not a piece");
  return made;
}

const read = [entry(1, 1, { type: "user_message", text: "Tell me about the notes app." }), entry(2, 3, { type: "assistant_message", text: "The notes " })];

describe("streamedPiece", () => {
  it("takes the reply's text pieces with their place and epoch", () => {
    const made = streamedPiece(event(4, "app"));
    expect(made).toMatchObject({ epoch: EPOCH, seq: 4, entry: { seqStart: 4, seqEnd: 4, turnId: "turn-1", item: { type: "assistant_message", text: "app" } } });
  });

  it("ignores every other event, and a piece without its place", () => {
    expect(streamedPiece({ event: { type: "turn_started", provider: "claude" }, seq: 5, epoch: EPOCH })).toBeNull();
    expect(streamedPiece({ event: { type: "timeline", item: { type: "tool_call", name: "Read" } }, seq: 5, epoch: EPOCH })).toBeNull();
    expect(streamedPiece({ event: { type: "timeline", item: { type: "assistant_message", text: "x" } }, epoch: EPOCH })).toBeNull();
    expect(streamedPiece({ event: { type: "timeline", item: { type: "assistant_message", text: "x" } }, seq: 5 })).toBeNull();
    expect(streamedPiece({ event: { type: "replacement", epoch: "epoch-2" } })).toBeNull();
    expect(streamedPiece(null)).toBeNull();
    expect(streamedPiece("text")).toBeNull();
  });
});

describe("withStreamed", () => {
  it("adds the pieces that continue the read, in order, and the reply grows in one row", () => {
    const entries = withStreamed(read, EPOCH, [piece(5, " two files."), piece(4, "app has")]);
    expect(entries.map((each) => each.seqStart)).toEqual([1, 2, 4, 5]);
    expect(transcriptRows(entries).map((row) => row.text)).toEqual(["Tell me about the notes app.", "The notes app has two files."]);
    expect(transcriptRows(entries)[1]?.key).toBe("2");
  });

  it("stops at a gap: a step the read lacks comes with the next read", () => {
    expect(withStreamed(read, EPOCH, [piece(4, "app"), piece(6, " after a tool call")]).map((each) => each.seqStart)).toEqual([1, 2, 4]);
    expect(withStreamed(read, EPOCH, [piece(6, "later")])).toBe(read);
  });

  it("skips pieces the read already holds, repeats, and pieces of another epoch", () => {
    expect(withStreamed(read, EPOCH, [piece(3, "old"), piece(2, "older")])).toBe(read);
    expect(withStreamed(read, EPOCH, [piece(4, "a"), piece(4, "a")]).map((each) => each.seqStart)).toEqual([1, 2, 4]);
    expect(withStreamed(read, EPOCH, [piece(4, "a", "epoch-0")])).toBe(read);
  });

  it("adds nothing before a first read or to an empty one", () => {
    expect(withStreamed(read, null, [piece(4, "a")])).toBe(read);
    expect(withStreamed([], EPOCH, [piece(1, "a")])).toEqual([]);
    expect(withStreamed(read, EPOCH, [])).toBe(read);
  });

  it("starts a new reply in a new turn as its own paragraph", () => {
    const next = streamedPiece(event(4, "Second reply.", EPOCH, "turn-2"));
    if (next === null) throw new Error("not a piece");
    expect(transcriptRows(withStreamed(read, EPOCH, [next])).map((row) => row.text)).toEqual(["Tell me about the notes app.", "The notes\n\nSecond reply."]);
  });
});

describe("drawnWithPieces", () => {
  it("leaves the chat as it is when a piece arrives before the first read, so the cached conversation stays", () => {
    expect(drawnWithPieces([], null, [piece(4, "app")])).toBeNull();
  });

  it("leaves it as it is when no piece continues the read, and draws the read with them otherwise", () => {
    expect(drawnWithPieces(read, EPOCH, [piece(6, "after a gap")])).toBeNull();
    expect(drawnWithPieces(read, EPOCH, [])).toBeNull();
    expect(drawnWithPieces(read, EPOCH, [piece(4, "app")])?.map((each) => each.seqStart)).toEqual([1, 2, 4]);
  });
});

describe("unreadPieces", () => {
  it("keeps only the pieces after the new read, of its epoch", () => {
    const pieces = [piece(3, "a"), piece(4, "b"), piece(5, "c", "epoch-0")];
    expect(unreadPieces(pieces, EPOCH, read).map((each) => each.seq)).toEqual([4]);
    expect(unreadPieces(pieces, "epoch-2", read)).toEqual([]);
    expect(unreadPieces(pieces, EPOCH, [])).toEqual([]);
    expect(unreadPieces(pieces, null, read)).toEqual([]);
  });
});

describe("whileWriting", () => {
  const rows = transcriptRows([...read, entry(4, 4, { type: "assistant_message", text: "app.\n\n```decision\nid: a" })]);

  it("holds the newest reply's unfinished block only while the agent writes", () => {
    expect(whileWriting(rows, true)[1]).toMatchObject({ text: "The notes app.", asking: true });
    expect(whileWriting(rows, false)).toBe(rows);
  });

  it("leaves rows alone when the last row is not a reply, or nothing is held", () => {
    const tool = transcriptRows([...read, entry(4, 4, { type: "tool_call", name: "Read", status: "running", detail: { type: "read", filePath: "/home/user/project/a.ts" } })]);
    expect(whileWriting(tool, true)).toBe(tool);
    const plain = transcriptRows(read);
    expect(whileWriting(plain, true)).toBe(plain);
    expect(whileWriting([], true)).toEqual([]);
  });
});

describe("turnBoundary (TR-201)", () => {
  const stream = (inner: unknown) => ({ agentId: "agent-1", event: inner, timestamp: "2026-01-01T00:00:00Z" });

  it("reads a turn's start", () => {
    expect(turnBoundary(stream({ type: "turn_started", provider: "claude", turnId: "turn-2" }))).toBe("started");
  });

  it("reads a turn's end however it ended: completed, failed or stopped", () => {
    for (const type of ["turn_completed", "turn_failed", "turn_canceled"]) expect(turnBoundary(stream({ type, provider: "claude" }))).toBe("ended");
  });

  it("is null for every other event, and for what is not an event", () => {
    expect(turnBoundary(event(3, "Hello"))).toBeNull();
    for (const inner of [{ type: "timeline", item: { type: "tool_call" } }, { type: "replacement", epoch: "e" }, { type: "subscription_restored" }, { type: "error", error: "x" }, { type: "attention_required" }, {}, null, "turn_started"]) {
      expect(turnBoundary(stream(inner))).toBeNull();
    }
    for (const value of [null, undefined, "turn_started", 3, {}]) expect(turnBoundary(value)).toBeNull();
  });
});
