import { describe, expect, it } from "vitest";

import { INTERRUPT_NOTE_END, INTERRUPT_NOTE_START } from "../shared/chat-queue";
import { compactionState, endStoppedTools, transcriptRows, withoutOpenTurn, type TimelineEntry, type TranscriptRow } from "./transcript-rows";

/** The rows without their turn footers, which have tests of their own below. */
function rowsOf(entries: readonly TimelineEntry[], cwd?: string | null): TranscriptRow[] {
  return transcriptRows(entries, cwd).map((row) => {
    if (row.kind !== "agent") return row;
    const { turn: _turn, ...rest } = row;
    return rest;
  });
}

const IMAGE = "![Image](file:///tmp/paseo-attachments-x1/ab.png)";

function said(seq: number, text: string): TimelineEntry {
  return { seqStart: seq, seqEnd: seq, item: { type: "assistant_message", text } } as unknown as TimelineEntry;
}

describe("transcriptRows images", () => {
  it("puts an image message between text on its own line, a blank line on each side", () => {
    const rows = rowsOf([said(1, "Here is the page:"), said(2, IMAGE), said(3, "The header is cut off.")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: `Here is the page:\n\n${IMAGE}\n\nThe header is cut off.` }]);
  });

  it("keeps streamed pieces of text glued as before", () => {
    expect(rowsOf([said(1, "Hel"), said(2, "lo")])).toEqual([{ key: "1", kind: "agent", text: "Hello" }]);
  });

  it("starts a row with an image and keeps consecutive images apart", () => {
    const rows = rowsOf([said(1, IMAGE), said(2, IMAGE), said(3, "Two shots.")]);
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
    expect(rowsOf([compaction(1, "loading")]).map((row) => row.text)).toEqual(["Compacting context…"]);
    expect(rowsOf([compaction(1, "loading"), compaction(2, "completed")]).map((row) => row.text)).toEqual(["Context compacted"]);
  });

  it("says a compaction stopped when the agent replied after it without its end (seen end to end: a message sent during it)", () => {
    const rows = rowsOf([compaction(1, "loading"), user(2, "a message"), said(3, "Compaction canceled.")]);
    expect(rows.map((row) => row.text)).toEqual(["Compaction stopped before it finished", "a message", "Compaction canceled."]);
  });

  it("keeps compacting while only the user has spoken since", () => {
    expect(rowsOf([compaction(1, "loading"), user(2, "a message")]).map((row) => row.text)).toEqual(["Compacting context…", "a message"]);
  });
});

function reply(seq: number, text: string, turnId: string, messageId?: string): TimelineEntry {
  const item = { type: "assistant_message", text, ...(messageId === undefined ? {} : { messageId }) };
  return { seqStart: seq, seqEnd: seq, turnId, item } as unknown as TimelineEntry;
}

describe("transcriptRows separate replies", () => {
  it("starts a reply with another message id on a new paragraph", () => {
    const rows = rowsOf([reply(1, "I will ask the user", "t1", "m1"), reply(2, "ok", "t1", "m2")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "I will ask the user\n\nok" }]);
  });

  it("starts a reply from another turn on a new paragraph", () => {
    const rows = rowsOf([reply(1, "I will ask the user", "t1"), reply(2, "ok", "t2")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "I will ask the user\n\nok" }]);
  });

  it("starts a reply after a gap in the timeline (a hidden reasoning entry) on a new paragraph", () => {
    const thinking = { seqStart: 2, seqEnd: 2, turnId: "t1", item: { type: "reasoning", text: "hm" } } as unknown as TimelineEntry;
    const rows = rowsOf([reply(1, "I will ask the user", "t1", "m1"), thinking, reply(3, "ok", "t1", "m1")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "I will ask the user\n\nok" }]);
  });

  it("keeps one streamed reply whole, however its pieces split", () => {
    const pieces = ["Here is the pl", "an:\n\n- one", "\n- two"];
    const rows = rowsOf(pieces.map((text, index) => reply(index + 1, text, "t1", "m1")));
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "Here is the plan:\n\n- one\n- two" }]);
  });

  it("does not add a second break when the first reply already ends in one", () => {
    const rows = rowsOf([reply(1, "Done.\n\n", "t1", "m1"), reply(2, "ok", "t2", "m2")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "Done.\n\nok" }]);
  });
});

describe("transcriptRows times", () => {
  it("dates an agent message by its first piece, so a plan's answers can be matched after it (TR-135)", () => {
    const at = (seq: number, text: string, timestamp: string) => ({ ...said(seq, text), timestamp }) as TimelineEntry;
    const rows = rowsOf([at(1, "Hel", "2026-01-05T10:00:00Z"), at(2, "lo", "2026-01-05T10:00:05Z")]);
    expect(rows).toEqual([{ key: "1", kind: "agent", text: "Hello", at: "2026-01-05T10:00:00Z" }]);
  });

  it("dates a user message by its entry, so a permission ask raised after the answer is placed after it (TR-149)", () => {
    const sent = (seq: number, timestamp?: string) =>
      ({ seqStart: seq, seqEnd: seq, ...(timestamp === undefined ? {} : { timestamp }), item: { type: "user_message", text: "Go on" } }) as unknown as TimelineEntry;
    const rows = rowsOf([sent(1, "2026-01-05T10:00:00Z"), sent(2)]);
    expect(rows.map((row) => (row.kind === "user" ? row.at : null))).toEqual(["2026-01-05T10:00:00Z", undefined]);
  });

  it("dates a tool call by its entry, so a permission ask it raised is placed after it (TR-149)", () => {
    const call = (seq: number, timestamp?: string) =>
      ({ seqStart: seq, seqEnd: seq, ...(timestamp === undefined ? {} : { timestamp }), item: { type: "tool_call", name: "Bash", status: "completed", detail: { type: "shell", command: "ls" } } }) as unknown as TimelineEntry;
    const rows = rowsOf([call(1, "2026-01-05T10:00:00Z"), call(2)]);
    expect(rows.map((row) => (row.kind === "tool" ? row.at : null))).toEqual(["2026-01-05T10:00:00Z", undefined]);
  });
});

function toolCall(seq: number, name: string, detail: object, status = "completed"): TimelineEntry {
  return { seqStart: seq, seqEnd: seq, item: { type: "tool_call", callId: `c${seq}`, name, status, detail, error: null } } as unknown as TimelineEntry;
}

describe("transcriptRows tool calls (TR-150)", () => {
  it("keeps each call as Paseo shows it, its path from the agent's folder, and what it counts as", () => {
    const rows = rowsOf(
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

describe("transcriptRows Send now messages (TR-171)", () => {
  const note = `${INTERRUPT_NOTE_START}\nThe user cut your last step off; check what it left.\n${INTERRUPT_NOTE_END}`;

  it("never shows the note a Send now puts before the user's words", () => {
    const words = "Stop, **use the other branch**:\n\n- `main`\n- not `dev`";
    expect(rowsOf([user(1, `${note}\n\n${words}`)])).toEqual([{ key: "1", kind: "user", text: words }]);
  });

  it("says attachments for a Send now of attachments alone", () => {
    expect(rowsOf([user(1, note)]).map((row) => row.text)).toEqual(["(attachments)"]);
  });

  it("keeps a message of words only as it is", () => {
    expect(rowsOf([user(1, "Plain words")])).toEqual([{ key: "1", kind: "user", text: "Plain words" }]);
  });
});

describe("endStoppedTools (TR-190)", () => {
  const statuses = (rows: ReturnType<typeof transcriptRows>) => rows.map((row) => (row.kind === "tool" ? row.status : row.kind));
  // As Paseo replays a Claude agent's history: its calls read "running" again, whatever they ended as.
  const replayed = [user(1, "List the notes"), toolCall(2, "Bash", { type: "shell", command: "ls" }, "running"), said(3, "Two notes."), user(4, "Read the first"), toolCall(5, "Read", { type: "read", filePath: "/home/user/notes-app/a.md" }, "running")];

  it("draws every call still running as finished once the agent stopped working", () => {
    expect(statuses(endStoppedTools(rowsOf(replayed), false))).toEqual(["user", "completed", "agent", "user", "completed"]);
  });

  it("keeps the current turn's running call while the agent works, and finishes an earlier turn's", () => {
    expect(statuses(endStoppedTools(rowsOf(replayed), true))).toEqual(["user", "completed", "agent", "user", "running"]);
  });

  it("leaves failed and cancelled calls as they are", () => {
    const rows = rowsOf([toolCall(1, "Bash", { type: "shell", command: "ls" }, "failed"), toolCall(2, "Bash", { type: "shell", command: "ls" }, "canceled")]);
    expect(statuses(endStoppedTools(rows, false))).toEqual(["failed", "canceled"]);
  });

  it("returns no rows for none", () => {
    expect(endStoppedTools([], false)).toEqual([]);
  });
});

function userSaid(seq: number, text: string, timestamp?: string): TimelineEntry {
  return { seqStart: seq, seqEnd: seq, ...(timestamp === undefined ? {} : { timestamp }), item: { type: "user_message", text } } as unknown as TimelineEntry;
}
function agentSaid(seq: number, text: string, timestamp: string, turnId = "t1"): TimelineEntry {
  return { seqStart: seq, seqEnd: seq, turnId, timestamp, item: { type: "assistant_message", text } } as unknown as TimelineEntry;
}
function ranTool(seq: number, timestamp: string): TimelineEntry {
  return { seqStart: seq, seqEnd: seq, timestamp, item: { type: "tool_call", name: "Bash", status: "completed", detail: { type: "shell", command: "ls" } } } as unknown as TimelineEntry;
}

describe("transcriptRows turn footers (TR-202)", () => {
  it("puts the footer on a turn's last reply, timed from the user's message to the turn's last item", () => {
    const rows = transcriptRows([userSaid(1, "Fix it", "2026-10-20T10:00:00Z"), agentSaid(2, "Looking.", "2026-10-20T10:00:03Z"), ranTool(3, "2026-10-20T10:00:08Z"), agentSaid(5, "Done.", "2026-10-20T10:00:11Z")]);
    const replies = rows.filter((row) => row.kind === "agent");
    expect(replies.map((row) => row.kind === "agent" && row.turn !== undefined)).toEqual([false, true]);
    expect(replies[1]).toMatchObject({ turn: { copyText: "Looking.\n\nDone.", completedAt: "2026-10-20T10:00:11Z", durationMs: 11_000, newest: true } });
  });

  it("gives each turn its own footer and marks only the newest", () => {
    const rows = transcriptRows([userSaid(1, "A", "2026-10-20T10:00:00Z"), agentSaid(2, "One", "2026-10-20T10:00:05Z"), userSaid(3, "B", "2026-10-20T10:01:00Z"), agentSaid(4, "Two", "2026-10-20T10:01:20Z", "t2")]);
    const turns = rows.flatMap((row) => (row.kind === "agent" && row.turn !== undefined ? [row.turn] : []));
    expect(turns.map((turn) => [turn.copyText, turn.durationMs, turn.newest])).toEqual([["One", 5000, false], ["Two", 20_000, true]]);
  });

  it("has no duration when the turn's user message is out of view", () => {
    const [row] = transcriptRows([agentSaid(2, "Hi", "2026-10-20T10:00:05Z")]);
    expect(row).toMatchObject({ turn: { copyText: "Hi", durationMs: null, completedAt: "2026-10-20T10:00:05Z" } });
  });

  it("gives a turn without words no footer", () => {
    const rows = transcriptRows([userSaid(1, "A", "2026-10-20T10:00:00Z"), ranTool(2, "2026-10-20T10:00:02Z")]);
    expect(rows.some((row) => row.kind === "agent")).toBe(false);
  });

  it("drops the newest turn's footer while the agent works, and nothing else", () => {
    const rows = transcriptRows([userSaid(1, "A", "2026-10-20T10:00:00Z"), agentSaid(2, "One", "2026-10-20T10:00:05Z"), userSaid(3, "B", "2026-10-20T10:01:00Z"), agentSaid(4, "Two", "2026-10-20T10:01:20Z", "t2")]);
    const footers = (list: TranscriptRow[]) => list.filter((row) => row.kind === "agent").map((row) => row.kind === "agent" && row.turn !== undefined);
    expect(footers(withoutOpenTurn(rows, true))).toEqual([true, false]);
    expect(withoutOpenTurn(rows, false)).toBe(rows);
  });
});

describe("transcriptRows received messages (TR-218)", () => {
  const sent = (seq: number, agentMessage: unknown): TimelineEntry =>
    ({ seqStart: seq, seqEnd: seq, timestamp: "2026-01-05T10:00:00Z", item: { type: "tool_call", callId: `paseo-agent-message:${seq}`, name: "agent_message", status: "completed", detail: { type: "plain_text", text: "x" }, agentMessage } }) as unknown as TimelineEntry;

  it("shows a starting prompt as a message from its sender, not a tool call", () => {
    const rows = rowsOf([sent(1, { event: "message", sender: { id: "m1", title: "notes-app · Manager" }, text: "  You are the task owner.\n\nTicket NA-1  " }), said(2, "On it.")]);
    expect(rows).toEqual([
      { key: "1", kind: "received", sender: "notes-app · Manager", text: "You are the task owner.\n\nTicket NA-1", at: "2026-01-05T10:00:00Z" },
      { key: "2", kind: "agent", text: "On it." },
    ]);
  });

  it("names an unnamed sender and skips an empty or malformed message", () => {
    expect(rowsOf([sent(1, { event: "message", sender: {}, text: "Hi" })])).toMatchObject([{ kind: "received", sender: "another agent", text: "Hi" }]);
    expect(rowsOf([sent(1, { event: "message", text: "  " })]).map((row) => row.kind)).toEqual(["tool"]);
    expect(rowsOf([sent(1, "nope")]).map((row) => row.kind)).toEqual(["tool"]);
  });
});

describe("transcriptRows plugin messages (TR-228)", () => {
  const withId = (seq: number, text: string, clientMessageId?: string): TimelineEntry =>
    ({ seqStart: seq, seqEnd: seq, timestamp: "2026-01-05T10:00:00Z", item: { type: "user_message", text, ...(clientMessageId === undefined ? {} : { clientMessageId }) } }) as unknown as TimelineEntry;

  it("shows a message the plugin sent as received from Plugin", () => {
    expect(rowsOf([withId(1, "Report from your **reviewer**\n\n- done\n", "taro-6f1c")])).toEqual([
      { key: "1", kind: "received", sender: "Plugin", text: "Report from your **reviewer**\n\n- done", at: "2026-01-05T10:00:00Z" },
    ]);
  });

  it("keeps the user's own words, with or without an id, as the user's bubble", () => {
    expect(rowsOf([withId(1, "hello", "chat-abc"), withId(2, "hi")]).map((row) => row.kind)).toEqual(["user", "user"]);
  });

  it("shows an answer the user gave on a decision card as the user's own bubble", () => {
    expect(rowsOf([withId(1, "Approve the plan for TR-1", "taro-answer-6f1c")]).map((row) => row.kind)).toEqual(["user"]);
  });

  it("still folds a plugin watch note into an event line", () => {
    expect(rowsOf([withId(1, "<taro>\nAgent 3f2a finished.\n</taro>", "taro-1")]).map((row) => row.kind)).toEqual(["event"]);
  });

  it("skips an empty plugin message as a user row", () => {
    expect(rowsOf([withId(1, "  ", "taro-2")]).map((row) => row.kind)).toEqual(["user"]);
  });
});

describe("compactionState", () => {
  it("names only a compaction's own lines, so other notices keep the notice style", () => {
    expect(compactionState("Compacting context…")).toBe("running");
    expect(compactionState("Context compacted")).toBe("done");
    expect(compactionState("Compaction stopped before it finished")).toBe("stopped");
    expect(compactionState("Agent notice")).toBeNull();
  });
});
