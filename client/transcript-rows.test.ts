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
