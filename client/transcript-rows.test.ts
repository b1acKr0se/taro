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

function reply(seq: number, text: string, turnId: string, messageId?: string): TimelineEntry {
  const item = { type: "assistant_message", text, ...(messageId === undefined ? {} : { messageId }) };
  return { seqStart: seq, seqEnd: seq, turnId, item } as unknown as TimelineEntry;
}

describe("transcriptRows separate replies", () => {
  it("starts a reply with another message id on a new paragraph", () => {
    const rows = transcriptRows([reply(1, "I will ask the user", "t1", "m1"), reply(2, "ok", "t1", "m2")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "I will ask the user\n\nok" }]);
  });

  it("starts a reply from another turn on a new paragraph", () => {
    const rows = transcriptRows([reply(1, "I will ask the user", "t1"), reply(2, "ok", "t2")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "I will ask the user\n\nok" }]);
  });

  it("starts a reply after a gap in the timeline (a hidden reasoning entry) on a new paragraph", () => {
    const thinking = { seqStart: 2, seqEnd: 2, turnId: "t1", item: { type: "reasoning", text: "hm" } } as unknown as TimelineEntry;
    const rows = transcriptRows([reply(1, "I will ask the user", "t1", "m1"), thinking, reply(3, "ok", "t1", "m1")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "I will ask the user\n\nok" }]);
  });

  it("keeps one streamed reply whole, however its pieces split", () => {
    const pieces = ["Here is the pl", "an:\n\n- one", "\n- two"];
    const rows = transcriptRows(pieces.map((text, index) => reply(index + 1, text, "t1", "m1")));
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "Here is the plan:\n\n- one\n- two" }]);
  });

  it("does not add a second break when the first reply already ends in one", () => {
    const rows = transcriptRows([reply(1, "Done.\n\n", "t1", "m1"), reply(2, "ok", "t2", "m2")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "Done.\n\nok" }]);
  });
});

describe("transcriptRows times", () => {
  it("dates an agent message by its first piece, so a plan's answers can be matched after it (TR-135)", () => {
    const at = (seq: number, text: string, timestamp: string) => ({ ...said(seq, text), timestamp }) as TimelineEntry;
    const rows = transcriptRows([at(1, "Hel", "2026-01-05T10:00:00Z"), at(2, "lo", "2026-01-05T10:00:05Z")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "Hello", at: "2026-01-05T10:00:00Z" }]);
  });

  it("dates a user message by its entry, so a permission ask raised after the answer is placed after it (TR-149)", () => {
    const sent = (seq: number, timestamp?: string) =>
      ({ seqStart: seq, seqEnd: seq, ...(timestamp === undefined ? {} : { timestamp }), item: { type: "user_message", text: "Go on" } }) as unknown as TimelineEntry;
    const rows = transcriptRows([sent(1, "2026-01-05T10:00:00Z"), sent(2)]);
    expect(rows.map((row) => (row.kind === "user" ? row.at : null))).toEqual(["2026-01-05T10:00:00Z", undefined]);
  });

  it("dates a tool call by its entry, so a permission ask it raised is placed after it (TR-149)", () => {
    const call = (seq: number, timestamp?: string) =>
      ({ seqStart: seq, seqEnd: seq, ...(timestamp === undefined ? {} : { timestamp }), item: { type: "tool_call", name: "Bash", status: "completed", detail: { type: "shell", command: "ls" } } }) as unknown as TimelineEntry;
    const rows = transcriptRows([call(1, "2026-01-05T10:00:00Z"), call(2)]);
    expect(rows.map((row) => (row.kind === "tool" ? row.at : null))).toEqual(["2026-01-05T10:00:00Z", undefined]);
  });
});

function toolCall(seq: number, name: string, detail: object, status = "completed"): TimelineEntry {
  return { seqStart: seq, seqEnd: seq, item: { type: "tool_call", callId: `c${seq}`, name, status, detail, error: null } } as unknown as TimelineEntry;
}

describe("transcriptRows tool calls (TR-150)", () => {
  it("keeps each call as Paseo shows it, its path from the agent's folder, and what it counts as", () => {
    const rows = transcriptRows(
      [
        toolCall(1, "Bash", { type: "shell", command: "T=$(date -u +%Y-%m-%dT%H:%MZ); taro ticket edit NA-12 -s Done" }),
        toolCall(2, "Read", { type: "read", filePath: "/home/user/notes-app/client/notes.ts" }, "failed"),
        toolCall(3, "ExitPlanMode", { type: "plan", text: "Plan" }),
      ],
      "/home/user/notes-app",
    );
    expect(rows).toEqual([
      { key: "1", kind: "tool", text: "Shell T=$(date -u +%Y-%m-%dT%H:%MZ); taro ticket edit NA-12 -s Done", label: "Shell", summary: "T=$(date -u +%Y-%m-%dT%H:%MZ); taro ticket edit NA-12 -s Done", icon: "SquareTerminal", tally: { kind: "command" }, alone: false, status: "completed" },
      { key: "2", kind: "tool", text: "Read client/notes.ts", label: "Read", summary: "client/notes.ts", icon: "Eye", tally: { kind: "read", filePath: "/home/user/notes-app/client/notes.ts" }, alone: false, status: "failed" },
      { key: "3", kind: "tool", text: "Plan", label: "Plan", icon: "Brain", tally: { kind: "other" }, alone: true, status: "completed" },
    ]);
  });
});
