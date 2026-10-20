import { describe, expect, it, vi } from "vitest";

import { NOT_QUEUED } from "../shared/chat-queue";
import { afterQueueRead, chatQueueKey, EDIT_REFUSAL, editRefusal, editRemoval, queueCompacting, takenAttachments, queuePollMs, queueRowActions, queueRowText, QUEUE_POLL_BUSY_MS, QUEUE_POLL_QUIET_MS, type QueueRowMessage, sendingToQueue } from "./queue-rows";
import type { PendingSend, SendView } from "../shared/pending-sends";

function queued(change: Partial<QueueRowMessage> = {}): QueueRowMessage {
  return { id: "chat-a", text: "Also check the footer", at: "2026-10-16T14:00:00Z", imageCount: 0, fileNames: [], failed: null, ...change };
}

describe("queueRowText (TR-171)", () => {
  it("is the words alone for a message of words only", () => {
    expect(queueRowText(queued())).toEqual({ words: "Also check the footer", attachments: null, failed: null });
  });

  it("is the attachments line alone for a message of attachments only", () => {
    expect(queueRowText(queued({ text: "", imageCount: 2, fileNames: ["notes.txt"] }))).toEqual({ words: null, attachments: "2 images · notes.txt", failed: null });
    expect(queueRowText(queued({ text: "  \n ", imageCount: 1 })).words).toBeNull();
  });

  it("says one image in the singular", () => {
    expect(queueRowText(queued({ imageCount: 1 })).attachments).toBe("1 image");
  });

  it("names every file after the images, three images and two files", () => {
    expect(queueRowText(queued({ imageCount: 3, fileNames: ["notes.txt", "plan.md"] })).attachments).toBe("3 images · notes.txt · plan.md");
  });

  it("names files alone with no image", () => {
    expect(queueRowText(queued({ fileNames: ["notes.txt"] })).attachments).toBe("notes.txt");
  });

  it("keeps a 2,000-character message whole: the row draws two lines of it", () => {
    const long = "word ".repeat(400).trim();
    expect(queueRowText(queued({ text: long })).words).toBe(long);
  });

  it("has no attachments line for empty file names and no image", () => {
    expect(queueRowText(queued({ fileNames: [], imageCount: 0 })).attachments).toBeNull();
  });

  it("says why a failed send failed", () => {
    expect(queueRowText(queued({ failed: "That agent is no longer running." })).failed).toBe("Not sent: That agent is no longer running.");
  });
});

describe("queueRowActions (TR-171)", () => {
  it("offers Edit and Send now on a queued message", () => {
    expect(queueRowActions(queued(), false).map((action) => action.action)).toEqual(["edit", "send-now"]);
  });

  it("offers no Send now while the agent compacts", () => {
    expect(queueRowActions(queued(), true).map((action) => action.action)).toEqual(["edit"]);
  });

  it("offers Edit and Retry instead of Send now on a failed one, compacting or not", () => {
    expect(queueRowActions(queued({ failed: "no" }), false).map((action) => action.action)).toEqual(["edit", "retry"]);
    expect(queueRowActions(queued({ failed: "no" }), true).map((action) => action.action)).toEqual(["edit", "retry"]);
  });

  it("labels and draws each as Paseo's queue does", () => {
    expect(queueRowActions(queued(), false)).toEqual([
      { action: "edit", label: "Edit queued message", icon: "Pencil", accent: false },
      { action: "send-now", label: "Send queued message now", icon: "ArrowUp", accent: true },
    ]);
    expect(queueRowActions(queued({ failed: "no" }), false)[1]).toEqual({ action: "retry", label: "Retry queued message", icon: "RotateCcw", accent: true });
  });
});

describe("queueCompacting (TR-171)", () => {
  it("hides Send now while Claude compacts (the timeline) or Taro does (the daemon)", () => {
    expect(queueRowActions(queued(), queueCompacting(false, false)).map((action) => action.action)).toEqual(["edit", "send-now"]);
    expect(queueRowActions(queued(), queueCompacting(true, false)).map((action) => action.action)).toEqual(["edit"]);
    expect(queueRowActions(queued(), queueCompacting(false, true)).map((action) => action.action)).toEqual(["edit"]);
  });
});

describe("editRemoval (TR-171)", () => {
  it("reads 'no longer queued' as sent meanwhile, the words kept", () => {
    expect(editRemoval(NOT_QUEUED, "chat-a", ["chat-b"])).toBe("sent-meanwhile");
    expect(editRemoval(NOT_QUEUED, "chat-a", null)).toBe("sent-meanwhile");
  });

  it("reads another failure with the message still listed as still queued: the box goes back", () => {
    expect(editRemoval("Transport closed (code 1006)", "chat-a", ["chat-a", "chat-b"])).toBe("still-queued");
  });

  it("reads another failure with the message gone from the queue as a removal whose answer was lost: the words stay (N1)", () => {
    expect(editRemoval("Transport closed (code 1006)", "chat-a", ["chat-b"])).toBe("removed");
    expect(editRemoval("Transport closed (code 1006)", "chat-a", [])).toBe("removed");
  });

  it("keeps the words when the queue cannot be read again either: a copy in the box, never a loss (N1)", () => {
    expect(editRemoval("Transport closed (code 1006)", "chat-a", null)).toBe("unknown");
  });
});

describe("editRefusal (TR-171)", () => {
  const withAttachments = queued({ imageCount: 1 });
  const withFiles = queued({ fileNames: ["notes.txt"] });

  it("lets Edit through into an empty box, or one holding words", () => {
    for (const message of [queued(), withAttachments, withFiles]) {
      expect(editRefusal({ text: "", attachments: 0 }, message)).toBeNull();
      expect(editRefusal({ text: "typed since", attachments: 0 }, message)).toBeNull();
    }
  });

  it("lets a message of words only into a box with attachments", () => {
    expect(editRefusal({ text: "", attachments: 2 }, queued())).toBeNull();
  });

  it("refuses when both the box and the queued message hold attachments, so none is lost", () => {
    expect(editRefusal({ text: "", attachments: 1 }, withAttachments)).toBe(EDIT_REFUSAL);
    expect(editRefusal({ text: "typed", attachments: 1 }, withFiles)).toBe(EDIT_REFUSAL);
    expect(EDIT_REFUSAL).toBe("Remove the attachments from the box first");
  });
});

describe("queuePollMs (TR-171)", () => {
  it("polls every 2 s while the queue is not empty or the agent works", () => {
    expect(QUEUE_POLL_BUSY_MS).toBe(2_000);
    expect(queuePollMs({ queued: 1, working: false })).toBe(QUEUE_POLL_BUSY_MS);
    expect(queuePollMs({ queued: 0, working: true })).toBe(QUEUE_POLL_BUSY_MS);
    expect(queuePollMs({ queued: 3, working: true })).toBe(QUEUE_POLL_BUSY_MS);
  });

  it("polls slower with an empty queue and an idle agent", () => {
    expect(queuePollMs({ queued: 0, working: false })).toBe(QUEUE_POLL_QUIET_MS);
    expect(QUEUE_POLL_QUIET_MS).toBeGreaterThan(QUEUE_POLL_BUSY_MS);
  });
});

describe("takenAttachments (TR-171)", () => {
  it("gives Edit's images and files back as the box holds them, each with its own id", () => {
    const taken = { images: [{ mimeType: "image/png", data: "AAAA" }], files: [{ fileName: "notes.txt", mimeType: "text/plain", data: "BBBB" }] };
    expect(takenAttachments("chat-a", taken)).toEqual([
      { id: "chat-a-image-0", kind: "image", fileName: "image-1.png", mimeType: "image/png", data: "AAAA" },
      { id: "chat-a-file-0", kind: "file", fileName: "notes.txt", mimeType: "text/plain", data: "BBBB" },
    ]);
    expect(takenAttachments("chat-a", { images: [], files: [] })).toEqual([]);
  });
});

describe("chatQueueKey", () => {
  it("is one agent's queue under every agent's, so one refresh can reach them all", () => {
    expect(chatQueueKey("agent-1").slice(0, 2)).toEqual(chatQueueKey());
  });
});

describe("messages on their way to a working agent (TR-171)", () => {
  const at = Date.parse("2026-10-16T10:00:00.000Z");
  const view = (id: string, mark: SendView["mark"], rowKey: string | null = null, attachments: PendingSend["attachments"] = []): SendView => ({
    send: { id, text: `words ${id}`, attachments, at, state: mark === "failed" ? "failed" : "sending" },
    mark,
    rowKey,
  });

  it("go to the queue track while the agent works, with their attachments counted", () => {
    const attachments = [
      { id: "a", kind: "image" as const, fileName: "shot.png", mimeType: "image/png", data: "x" },
      { id: "b", kind: "file" as const, fileName: "notes.txt", mimeType: "text/plain", data: "y" },
    ];
    expect(sendingToQueue([view("chat-a", "sending", null, attachments), view("chat-b", "behind")], true)).toEqual([
      { id: "chat-a", text: "words chat-a", at: "2026-10-16T10:00:00.000Z", imageCount: 1, fileNames: ["notes.txt"], failed: null },
      { id: "chat-b", text: "words chat-b", at: "2026-10-16T10:00:00.000Z", imageCount: 0, fileNames: [], failed: null },
    ]);
  });

  it("stay in the transcript when the agent is idle, failed, waiting, or already in the timeline", () => {
    expect(sendingToQueue([view("chat-a", "sending")], false)).toEqual([]);
    expect(sendingToQueue([view("chat-a", "failed"), view("chat-b", "waiting"), view("chat-c", "unread"), view("chat-d", "sending", "12")], true)).toEqual([]);
    expect(sendingToQueue([], true)).toEqual([]);
  });

  it("stay in the transcript when sent to an idle agent, though its turn now shows as working (TR-216)", () => {
    const idle = view("chat-a", "sending");
    const sentIdle: SendView = { ...idle, send: { ...idle.send, sentWhileIdle: true } };
    expect(sendingToQueue([sentIdle, view("chat-b", "behind")], true).map((row) => row.id)).toEqual(["chat-b"]);
    expect(sendingToQueue([{ ...sentIdle, mark: "behind" }], true)).toEqual([]);
  });
});

describe("afterQueueRead (TR-188)", () => {
  const never = () => new Promise<void>(() => {});
  const flush = async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve();
  };

  it("answers a send that went at once without reading the queue", async () => {
    const readQueue = vi.fn(() => Promise.resolve());
    await expect(afterQueueRead({ queued: false }, readQueue, never)).resolves.toEqual({ queued: false });
    expect(readQueue).not.toHaveBeenCalled();
  });

  it("answers a queued send only once the queue was read", async () => {
    let readDone = () => {};
    let answered = false;
    void afterQueueRead({ queued: true }, () => new Promise<void>((resolve) => (readDone = resolve)), never).then(() => (answered = true));
    await flush();
    expect(answered).toBe(false);
    readDone();
    await flush();
    expect(answered).toBe(true);
  });

  it("answers anyway when the read fails", async () => {
    await expect(afterQueueRead({ queued: true }, () => Promise.reject(new Error("Not connected")), never)).resolves.toEqual({ queued: true });
  });

  it("answers anyway once the wait runs out on a read that never lands, waiting QUEUE_READ_WAIT_MS", async () => {
    const waits: number[] = [];
    let waited = () => {};
    let answered = false;
    void afterQueueRead({ queued: true }, never, (ms) => {
      waits.push(ms);
      return new Promise<void>((resolve) => (waited = resolve));
    }).then(() => (answered = true));
    await flush();
    expect(answered).toBe(false);
    expect(waits).toEqual([3_000]);
    waited();
    await flush();
    expect(answered).toBe(true);
  });
});
