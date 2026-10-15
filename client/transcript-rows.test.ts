import { describe, expect, it } from "vitest";

import { transcriptRows, type TimelineEntry } from "./transcript-rows";

const IMAGE = "![Image](file:///tmp/paseo-attachments-x1/ab.png)";

function said(seq: number, text: string): TimelineEntry {
  return { seqStart: seq, seqEnd: seq, item: { type: "assistant_message", text } } as unknown as TimelineEntry;
}

describe("transcriptRows images", () => {
  it("puts an image message between text on its own line, a blank line on each side", () => {
    const rows = transcriptRows([said(1, "Here is the page:"), said(2, IMAGE), said(3, "The header is cut off.")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: `Here is the page:\n\n${IMAGE}\n\nThe header is cut off.` }]);
  });

  it("keeps streamed pieces of text glued as before", () => {
    expect(transcriptRows([said(1, "Hel"), said(2, "lo")])).toEqual([{ key: "1", kind: "agent", text: "Hello" }]);
  });

  it("starts a row with an image and keeps consecutive images apart", () => {
    const rows = transcriptRows([said(1, IMAGE), said(2, IMAGE), said(3, "Two shots.")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: `${IMAGE}\n\n${IMAGE}\n\nTwo shots.` }]);
  });
});

function compaction(seq: number, status: "loading" | "completed"): TimelineEntry {
  return { seqStart: seq, seqEnd: seq, item: { type: "compaction", status } } as unknown as TimelineEntry;
}

function user(seq: number, text: string): TimelineEntry {
  return { seqStart: seq, seqEnd: seq, item: { type: "user_message", text, clientMessageId: `chat-${seq}` } } as unknown as TimelineEntry;
}

describe("transcriptRows compactions (TR-102)", () => {
  it("says compacting while a compaction runs, and compacted once it ends", () => {
    expect(transcriptRows([compaction(1, "loading")]).map((row) => row.text)).toEqual(["Compacting context…"]);
    expect(transcriptRows([compaction(1, "loading"), compaction(2, "completed")]).map((row) => row.text)).toEqual(["Context compacted"]);
  });

  it("says a compaction stopped when the agent replied after it without its end (seen end to end: a message sent during it)", () => {
    const rows = transcriptRows([compaction(1, "loading"), user(2, "a message"), said(3, "Compaction canceled.")]);
    expect(rows.map((row) => row.text)).toEqual(["Compaction stopped before it finished", "a message", "Compaction canceled."]);
  });

  it("keeps compacting while only the user has spoken since", () => {
    expect(transcriptRows([compaction(1, "loading"), user(2, "a message")]).map((row) => row.text)).toEqual(["Compacting context…", "a message"]);
  });
});
