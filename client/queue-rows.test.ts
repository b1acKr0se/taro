import { describe, expect, it } from "vitest";

import { chatQueueKey, EDIT_REFUSAL, editRefusal, takenAttachments, queuePollMs, queueRowActions, queueRowText, QUEUE_POLL_BUSY_MS, QUEUE_POLL_QUIET_MS, type QueueRowMessage } from "./queue-rows";

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
