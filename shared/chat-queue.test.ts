import { describe, expect, it } from "vitest";

import {
  ChatQueueFileSchema,
  drainBlocker,
  INTERRUPT_NOTE_END,
  INTERRUPT_NOTE_START,
  routeChatMessage,
  SEND_NOW_GUARD_MS,
  stripInterruptNote,
  summarize,
  sweepDue,
  withFront,
  withInterruptNote,
  withQueued,
  type DrainCheck,
  type DrainTrigger,
  type QueuedMessage,
} from "./chat-queue";
import type { CompactionStage } from "./state";

function queued(id: string, extra: Partial<QueuedMessage> = {}): QueuedMessage {
  return { id, text: `words ${id}`, images: [], files: [], at: "2026-10-16T10:00:00.000Z", failed: null, ...extra };
}

describe("routeChatMessage", () => {
  it("sends to an idle agent at once, and queues while it works", () => {
    expect(routeChatMessage({ status: "idle" }, false)).toBe("send");
    expect(routeChatMessage({ status: "error" }, false)).toBe("send");
    expect(routeChatMessage({ status: "running" }, false)).toBe("queue");
  });

  it("queues for an agent still starting its turn", () => {
    expect(routeChatMessage({ status: "initializing" }, false)).toBe("queue");
  });

  it("sends words that answer a pending request at once, even mid-turn", () => {
    expect(routeChatMessage({ status: "running" }, true)).toBe("send");
    expect(routeChatMessage({ status: "initializing" }, true)).toBe("send");
    expect(routeChatMessage({ status: "idle" }, true)).toBe("send");
  });
});

describe("drainBlocker", () => {
  const now = 1_000_000;
  const ready: DrainCheck = { trigger: "completed", status: "idle", compaction: "none", front: { failed: null }, sendNowAt: null, now };
  const triggers: DrainTrigger[] = ["completed", "canceled", "sweep", "queued", "retry"];

  it("lets an idle agent's front go on every trigger", () => {
    for (const trigger of triggers) expect(drainBlocker({ ...ready, trigger })).toBeNull();
  });

  it("refuses an empty queue, a gone agent, and a failed front", () => {
    expect(drainBlocker({ ...ready, front: null })).toMatch(/empty/);
    expect(drainBlocker({ ...ready, status: null })).toMatch(/gone/);
    expect(drainBlocker({ ...ready, front: { failed: "Paseo did not take it." } })).toMatch(/failed/);
  });

  it("never sends into a running turn, whatever asked", () => {
    for (const trigger of triggers) {
      expect(drainBlocker({ ...ready, trigger, status: "running" })).toMatch(/working/);
      expect(drainBlocker({ ...ready, trigger, status: "initializing" })).toMatch(/working/);
    }
  });

  it("waits through each of Taro's compaction steps", () => {
    const stages: CompactionStage[] = ["handoff", "compacting", "reloading"];
    for (const compaction of stages) for (const trigger of triggers) expect(drainBlocker({ ...ready, trigger, compaction })).toMatch(/compacting/);
  });

  it("holds a canceled turn end, the sweep and a recheck inside Send now's 30 s, not a completed turn end or Retry", () => {
    const inside = { ...ready, sendNowAt: now - (SEND_NOW_GUARD_MS - 1) };
    expect(drainBlocker({ ...inside, trigger: "canceled" })).toMatch(/Send now/);
    expect(drainBlocker({ ...inside, trigger: "sweep" })).toMatch(/Send now/);
    expect(drainBlocker({ ...inside, trigger: "queued" })).toMatch(/Send now/);
    expect(drainBlocker({ ...inside, trigger: "completed" })).toBeNull();
    expect(drainBlocker({ ...inside, trigger: "retry" })).toBeNull();
  });

  it("lets a canceled turn end drain from exactly 30 s after Send now", () => {
    expect(drainBlocker({ ...ready, trigger: "canceled", sendNowAt: now - SEND_NOW_GUARD_MS })).toBeNull();
    expect(drainBlocker({ ...ready, trigger: "canceled", sendNowAt: now - SEND_NOW_GUARD_MS - 1 })).toBeNull();
    expect(drainBlocker({ ...ready, trigger: "canceled", sendNowAt: now })).toMatch(/Send now/);
  });
});

describe("sweepDue", () => {
  const now = Date.parse("2026-10-16T10:00:10.000Z");

  it("waits until 10 s after the last turn end", () => {
    expect(sweepDue({ queued: 1, status: "idle", idleSince: "2026-10-16T10:00:01.000Z", now })).toBe(false);
    expect(sweepDue({ queued: 1, status: "idle", idleSince: "2026-10-16T10:00:00.000Z", now })).toBe(true);
  });

  it("skips an empty queue, a working agent and a gone one", () => {
    expect(sweepDue({ queued: 0, status: "idle", idleSince: null, now })).toBe(false);
    expect(sweepDue({ queued: 2, status: "running", idleSince: "2026-10-16T09:00:00.000Z", now })).toBe(false);
    expect(sweepDue({ queued: 2, status: null, idleSince: "2026-10-16T09:00:00.000Z", now })).toBe(false);
  });

  it("takes an agent whose turn end was never seen as idle long enough", () => {
    expect(sweepDue({ queued: 1, status: "idle", idleSince: null, now })).toBe(true);
    expect(sweepDue({ queued: 1, status: "idle", idleSince: "not a time", now })).toBe(true);
  });
});

describe("the interrupt note", () => {
  const note = "The user interrupted your turn. Check what the cut-off step left.";

  it("leaves text without a note as it is", () => {
    expect(stripInterruptNote("just words")).toBe("just words");
    expect(stripInterruptNote("")).toBe("");
  });

  it("goes before the words, between the markers, and comes off whole", () => {
    const text = withInterruptNote(note, "Stop and use **sqlite** instead:\n\n- one\n- `two`");
    expect(text.startsWith(`${INTERRUPT_NOTE_START}\n${note}\n${INTERRUPT_NOTE_END}\n\n`)).toBe(true);
    expect(stripInterruptNote(text)).toBe("Stop and use **sqlite** instead:\n\n- one\n- `two`");
  });

  it("keeps words that themselves contain the markers", () => {
    const words = `quote: ${INTERRUPT_NOTE_START} x ${INTERRUPT_NOTE_END}\n${INTERRUPT_NOTE_END}`;
    expect(stripInterruptNote(withInterruptNote(note, words))).toBe(words);
    // Words that merely start with the marker but were never wrapped stay too, when it is not closed.
    expect(stripInterruptNote(`${INTERRUPT_NOTE_START} unclosed`)).toBe(`${INTERRUPT_NOTE_START} unclosed`);
  });

  it("is the whole text for a message of attachments alone", () => {
    const text = withInterruptNote(note, "");
    expect(text).toBe(`${INTERRUPT_NOTE_START}\n${note}\n${INTERRUPT_NOTE_END}`);
    expect(stripInterruptNote(text)).toBe("");
  });
});

describe("queue edits", () => {
  it("adds at the back, oldest first, and keeps one copy of an id", () => {
    const first = withQueued([], queued("chat-a"));
    const second = withQueued(first, queued("chat-b"));
    expect(withQueued(second, queued("chat-a", { text: "again" })).map((message) => [message.id, message.text])).toEqual([
      ["chat-a", "words chat-a"],
      ["chat-b", "words chat-b"],
    ]);
  });

  it("puts a message back at the front without a second copy", () => {
    expect(withFront([queued("chat-a"), queued("chat-b")], queued("chat-b", { failed: "x" })).map((message) => message.id)).toEqual(["chat-b", "chat-a"]);
  });

  it("summarizes without attachment data", () => {
    const message = queued("chat-a", { images: [{ mimeType: "image/png", data: "AAAA" }], files: [{ fileName: "a.txt", mimeType: "text/plain", data: "BBBB" }] });
    expect(summarize(message)).toEqual({ id: "chat-a", text: "words chat-a", at: message.at, imageCount: 1, fileNames: ["a.txt"], failed: null });
  });

  it("reads a file of another version as not one it knows", () => {
    expect(ChatQueueFileSchema.safeParse({ version: 2, messages: [] }).success).toBe(false);
    expect(ChatQueueFileSchema.parse({ version: 1, messages: [queued("chat-a")] }).messages).toHaveLength(1);
  });
});
