import { describe, expect, it } from "vitest";

import type { DraftAttachment } from "../shared/attachments";
import { NOT_QUEUED } from "../shared/chat-queue";
import {
  afterSendNow,
  afterTakeOut,
  boxAfterTake,
  chatQueueKey,
  EDIT_REFUSAL,
  editRefusal,
  editRemoval,
  heldAttachments,
  hiddenAfterRead,
  mayAct,
  queueCallFailure,
  queueCompacting,
  takenAttachments,
  queuePollMs,
  queueRowActions,
  queueRowText,
  QUEUE_POLL_BUSY_MS,
  QUEUE_POLL_QUIET_MS,
  type QueueRowMessage,
  sendingToQueue,
  sendsAsIdle,
  handedOverSend,
  trackRows,
  waitsForFreshReads,
  withoutTaken,
} from "./queue-rows";
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

  it("offers Edit alone on one of this app's rows behind a failed message: it cannot go before it (TR-287)", () => {
    expect(queueRowActions(queued({ behind: true }), false).map((action) => action.action)).toEqual(["edit"]);
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

describe("this app's messages in the queue track (TR-171, TR-287)", () => {
  const at = Date.parse("2026-10-16T10:00:00.000Z");
  const view = (id: string, mark: SendView["mark"], rowKey: string | null = null, attachments: PendingSend["attachments"] = [], change: Partial<PendingSend> = {}): SendView => ({
    send: { id, text: `words ${id}`, attachments, at, state: mark === "failed" ? "failed" : mark === "queued" ? "queued" : "sending", ...change },
    mark,
    rowKey,
  });

  it("go to the queue track, with their attachments counted, those behind a failed one marked", () => {
    const attachments = [
      { id: "a", kind: "image" as const, fileName: "shot.png", mimeType: "image/png", data: "x" },
      { id: "b", kind: "file" as const, fileName: "notes.txt", mimeType: "text/plain", data: "y" },
    ];
    expect(sendingToQueue([view("chat-a", "sending", null, attachments), view("chat-b", "behind"), view("chat-c", "queued")])).toEqual([
      { id: "chat-a", text: "words chat-a", at: "2026-10-16T10:00:00.000Z", imageCount: 1, fileNames: ["notes.txt"], failed: null },
      { id: "chat-b", text: "words chat-b", at: "2026-10-16T10:00:00.000Z", imageCount: 0, fileNames: [], failed: null, behind: true },
      { id: "chat-c", text: "words chat-c", at: "2026-10-16T10:00:00.000Z", imageCount: 0, fileNames: [], failed: null },
    ]);
  });

  it("are drawn by how they were sent, not by the agent's status now: no status is read", () => {
    // Drawn whether the chat shows the agent working or idle (the old `working: false` case): the status is not an input.
    expect(sendingToQueue([view("chat-a", "sending"), view("chat-b", "queued")]).map((row) => row.id)).toEqual(["chat-a", "chat-b"]);
  });

  it("stay in the transcript when failed, waiting, unread, or already in the timeline", () => {
    expect(sendingToQueue([view("chat-a", "failed"), view("chat-b", "waiting"), view("chat-c", "unread"), view("chat-d", "sending", "12"), view("chat-e", "queued", "14")])).toEqual([]);
    expect(sendingToQueue([])).toEqual([]);
  });

  it("stay in the transcript when sent to an idle agent, though its turn now shows as working (TR-216)", () => {
    const idle = view("chat-a", "sending", null, [], { sentWhileIdle: true });
    expect(sendingToQueue([idle, view("chat-b", "behind")]).map((row) => row.id)).toEqual(["chat-b"]);
    expect(sendingToQueue([{ ...idle, mark: "behind" }, view("chat-c", "queued", null, [], { sentWhileIdle: true })])).toEqual([]);
  });

  it("are not drawn once handed over to Edit or Send now", () => {
    expect(sendingToQueue([view("chat-a", "sending", null, [], { handedOver: "send-now" }), view("chat-b", "queued", null, [], { handedOver: "send-now" }), view("chat-c", "sending", null, [], { handedOver: "edit" })])).toEqual([]);
  });

  it("draw one held as sent to an idle agent that the daemon failed, once its mark is cleared, as the daemon's row with Not sent", () => {
    const cleared = view("chat-d", "queued", null, [], { sentWhileIdle: false });
    const result = trackRows({ daemon: [queued({ id: "chat-d", failed: "the agent is gone" })], local: sendingToQueue([cleared]), hidden: new Set(), inTimeline: new Set(), retrying: new Set() });
    expect(result.map((row) => [row.message.id, row.local, row.message.failed])).toEqual([["chat-d", false, "the agent is gone"]]);
  });
});

describe("trackRows (TR-287)", () => {
  const none = new Set<string>();
  const rows = (input: Partial<Parameters<typeof trackRows>[0]>) => trackRows({ daemon: [], local: [], hidden: none, inTimeline: none, retrying: none, ...input });

  it("draws the daemon's rows in order, then this app's it does not list, each message once", () => {
    const result = rows({ daemon: [queued({ id: "A" })], local: [queued({ id: "A" }), queued({ id: "B" })] });
    expect(result.map((row) => [row.message.id, row.local, row.retrying])).toEqual([
      ["A", false, false],
      ["B", true, false],
    ]);
  });

  it("draws first this app's row that left the daemon's queue, which drains its front", () => {
    const result = rows({ daemon: [queued({ id: "B" })], local: [queued({ id: "A", left: true }), queued({ id: "B" }), queued({ id: "C" })] });
    expect(result.map((row) => [row.message.id, row.local])).toEqual([
      ["A", true],
      ["B", false],
      ["C", true],
    ]);
  });

  it("draws first, on the very render of the read that omits it, a queued row the daemon drained", () => {
    const at = Date.parse("2026-10-16T10:00:00.000Z");
    const queuedView = (id: string): SendView => ({ send: { id, text: id, attachments: [], at, state: "queued", queuedAt: 1000 }, mark: "queued", rowKey: null });
    // No leftQueueAt stored yet: the read alone says A left.
    const read = { ids: ["B"], startedAt: 1000 };
    const local = sendingToQueue([queuedView("A"), queuedView("B")], read);
    expect(local.map((row) => [row.id, row.left === true])).toEqual([
      ["A", true],
      ["B", false],
    ]);
    expect(rows({ daemon: [queued({ id: "B" })], local }).map((row) => row.message.id)).toEqual(["A", "B"]);
    // A read begun before the daemon had it proves nothing.
    expect(sendingToQueue([queuedView("A")], { ids: [], startedAt: 900 })[0]?.left).toBeUndefined();
  });

  it("marks a local row that left the queue", () => {
    const at = Date.parse("2026-10-16T10:00:00.000Z");
    const view: SendView = { send: { id: "chat-a", text: "a", attachments: [], at, state: "queued", queuedAt: at, leftQueueAt: at + 1 }, mark: "queued", rowKey: null };
    expect(sendingToQueue([view])[0]?.left).toBe(true);
  });

  it("keeps this app's row when the daemon's read does not list it yet, under the same id", () => {
    expect(rows({ local: [queued({ id: "A" })] }).map((row) => [row.message.id, row.local])).toEqual([["A", true]]);
  });

  it("hides a row the timeline shows: it is the transcript's then", () => {
    expect(rows({ daemon: [queued({ id: "A" })], inTimeline: new Set(["A"]) })).toEqual([]);
    expect(rows({ local: [queued({ id: "A" })], inTimeline: new Set(["A"]) })).toEqual([]);
  });

  it("hides handed-over ids, and the daemon's row of a message held as sent to an idle agent", () => {
    expect(rows({ daemon: [queued({ id: "A" })], hidden: new Set(["A"]) })).toEqual([]);
    expect(rows({ daemon: [queued({ id: "A" }), queued({ id: "B" })], local: [queued({ id: "C" })], hidden: new Set(["A", "C"]) }).map((row) => row.message.id)).toEqual(["B"]);
  });

  it("draws a retrying row without its Not sent line, flagged retrying", () => {
    expect(rows({ daemon: [queued({ id: "A", failed: "no connection" })], retrying: new Set(["A"]) })).toEqual([{ message: queued({ id: "A", failed: null }), local: false, retrying: true }]);
  });
});

describe("waitsForFreshReads (TR-287)", () => {
  const mountedAt = 10_000;
  const kept: PendingSend = { id: "chat-a", text: "a", attachments: [], at: 1, state: "queued", queuedAt: 5_000 };
  const read = (ids: string[], answeredAt: number) => ({ ids, startedAt: answeredAt - 100, answeredAt });

  it("holds a queued message kept from before the mount until this mount's first queue read answered", () => {
    expect(waitsForFreshReads(kept, mountedAt, { queue: null, timelineStartedAt: null })).toBe(true);
    // A cached read from before the mount does not count.
    expect(waitsForFreshReads(kept, mountedAt, { queue: read(["chat-a"], 9_000), timelineStartedAt: 10_050 })).toBe(true);
    expect(waitsForFreshReads(kept, mountedAt, { queue: read(["chat-a"], 10_500), timelineStartedAt: null })).toBe(false);
  });

  it("holds one that read omits until a timeline read begun once it answered: the agent may have taken it meanwhile", () => {
    expect(waitsForFreshReads(kept, mountedAt, { queue: read([], 10_500), timelineStartedAt: null })).toBe(true);
    // The mount's first timeline read began before the queue read answered: it may predate the removal or the drain.
    expect(waitsForFreshReads(kept, mountedAt, { queue: read([], 10_500), timelineStartedAt: 10_050 })).toBe(true);
    expect(waitsForFreshReads(kept, mountedAt, { queue: read([], 10_500), timelineStartedAt: 10_500 })).toBe(false);
    expect(waitsForFreshReads(kept, mountedAt, { queue: read([], 10_500), timelineStartedAt: 10_600 })).toBe(false);
    // Once noted, dated by the read that first omitted it, not by a later poll's answer.
    expect(waitsForFreshReads({ ...kept, leftQueueAt: 10_500 }, mountedAt, { queue: read([], 12_500), timelineStartedAt: 10_600 })).toBe(false);
  });

  it("draws at once one queued after mounting, and anything not queued", () => {
    expect(waitsForFreshReads({ ...kept, queuedAt: 10_001 }, mountedAt, { queue: null, timelineStartedAt: null })).toBe(false);
    expect(waitsForFreshReads({ ...kept, state: "sending", queuedAt: undefined }, mountedAt, { queue: null, timelineStartedAt: null })).toBe(false);
  });
});

describe("sendsAsIdle (TR-287)", () => {
  it("is idle only as the chat shows it, with no queue row and no compaction", () => {
    expect(sendsAsIdle(false, 0, false)).toBe(true);
    expect(sendsAsIdle(false, 2, false)).toBe(false);
    expect(sendsAsIdle(false, 0, true)).toBe(false);
    expect(sendsAsIdle(true, 0, false)).toBe(false);
  });
});

describe("afterTakeOut (TR-287)", () => {
  it("does nothing more for one the plugin never had", () => {
    expect(afterTakeOut("never-sent", null, false)).toBe("done");
  });

  it("removes one the daemon queued, or may hold", () => {
    expect(afterTakeOut("queued", null, false)).toBe("remove");
    expect(afterTakeOut("maybe-queued", null, false)).toBe("remove");
    expect(afterTakeOut("queued", "ok", false)).toBe("done");
  });

  it("says one Paseo already had was sent meanwhile", () => {
    expect(afterTakeOut("sent", null, true)).toBe("sent-meanwhile");
    expect(afterTakeOut("sent", null, false)).toBe("sent-meanwhile");
    expect(afterTakeOut("queued", "not-queued", false)).toBe("sent-meanwhile");
  });

  it("reads 'no longer queued' on one whose send went unanswered by the timeline", () => {
    expect(afterTakeOut("maybe-queued", "not-queued", true)).toBe("sent-meanwhile");
    expect(afterTakeOut("maybe-queued", "not-queued", false)).toBe("done");
  });

  it("reads the queue again after any other failure of the removal", () => {
    expect(afterTakeOut("queued", "other-error", false)).toBe("still-queued-check");
    expect(afterTakeOut("maybe-queued", "other-error", true)).toBe("still-queued-check");
  });

  it("tells 'no longer queued' from any other failure", () => {
    expect(queueCallFailure(NOT_QUEUED)).toBe("not-queued");
    expect(queueCallFailure("Transport closed (code 1006)")).toBe("other-error");
  });
});

describe("afterSendNow (TR-287)", () => {
  it("calls Send now on the daemon once it holds the message, and marks it sent on its answer", () => {
    expect(afterSendNow("queued", null)).toBe("call");
    expect(afterSendNow("queued", "ok")).toBe("sent");
    expect(afterSendNow("queued", "not-queued")).toBe("sent");
    expect(afterSendNow("queued", "other-error")).toBe("row-back");
  });

  it("shows a failed send as any other, and does nothing for one sent at once or gone", () => {
    expect(afterSendNow("failed", null)).toBe("failed");
    expect(afterSendNow("sent", null)).toBe("nothing");
    expect(afterSendNow("gone", null)).toBe("nothing");
  });
});

describe("hiddenAfterRead (TR-287)", () => {
  it("keeps an id while its action is under way, and until a read that began after its answer", () => {
    const underWay = new Map([["A", null]]);
    expect(hiddenAfterRead(underWay, 5000)).toBe(underWay);
    const answered = new Map([["A", 4000]]);
    expect(hiddenAfterRead(answered, 3900)).toBe(answered);
    expect(hiddenAfterRead(answered, null)).toBe(answered);
    expect([...hiddenAfterRead(answered, 4100)]).toEqual([]);
  });

  it("releases on a read begun in the same millisecond as the answer: the refresh it starts reaches the daemon after it", () => {
    expect([...hiddenAfterRead(new Map([["A", 4000]]), 4000)]).toEqual([]);
  });

  it("releases only those answered before the read", () => {
    expect([...hiddenAfterRead(new Map<string, number | null>([["A", 4000], ["B", null], ["C", 6000]]), 5000)]).toEqual([
      ["B", null],
      ["C", 6000],
    ]);
  });
});

describe("mayAct (TR-287)", () => {
  it("holds up presses on the busy row alone", () => {
    expect(mayAct(new Map([["A", "send-now" as const]]), "B")).toBe(true);
    expect(mayAct(new Map([["A", "send-now" as const]]), "A")).toBe(false);
    expect(mayAct(new Map([["A", "edit" as const]]), "A")).toBe(false);
    expect(mayAct(new Map(), "A")).toBe(true);
  });
});

describe("box helpers (TR-287)", () => {
  const image = (id: string): DraftAttachment => ({ id, kind: "image", fileName: "shot.png", mimeType: "image/png", data: "AAAA" });
  const empty = { text: "", attachments: [] };

  it("takes Edit's block of words out of the box, keeping the rest", () => {
    expect(withoutTaken({ text: "fix the bug\n\nand tests", attachments: [] }, { messageId: "chat-a", text: "fix the bug" })).toEqual({ text: "and tests", attachments: [] });
    expect(withoutTaken({ text: "fix the bug", attachments: [] }, { messageId: "chat-a", text: "fix the bug" })).toEqual({ text: "", attachments: [] });
    expect(withoutTaken({ text: "and tests\n\nfix the bug", attachments: [] }, { messageId: "chat-a", text: "fix the bug" })).toEqual({ text: "and tests", attachments: [] });
  });

  it("is null when the words no longer stand there intact: the box is kept", () => {
    expect(withoutTaken({ text: "and tests", attachments: [] }, { messageId: "chat-a", text: "fix the bug" })).toBeNull();
    expect(withoutTaken({ text: "fix the bugs", attachments: [] }, { messageId: "chat-a", text: "fix the bug" })).toBeNull();
    expect(withoutTaken({ text: "", attachments: [image("x")] }, { messageId: "chat-a", text: "" })).toBeNull();
  });

  it("takes the message's attachments out by their ids, keeping the box's own", () => {
    const box = { text: "look\n\nmine", attachments: [image("chat-a-image-0"), image("chat-a-file-0"), image("own-1"), image("chat-ab-image-0")] };
    expect(withoutTaken(box, { messageId: "chat-a", text: "look" })).toEqual({ text: "mine", attachments: [image("own-1"), image("chat-ab-image-0")] });
    expect(withoutTaken({ text: "", attachments: [image("chat-a-image-0")] }, { messageId: "chat-a", text: "" })).toEqual({ text: "", attachments: [] });
  });

  it("two takes answer in turn → both messages' words in the box", () => {
    const first = boxAfterTake(empty, queued({ id: "chat-a" }), { text: "first", images: [], files: [] });
    if (!("box" in first)) throw new Error("refused");
    const second = boxAfterTake(first.box, queued({ id: "chat-b" }), { text: "second", images: [], files: [] });
    if (!("box" in second)) throw new Error("refused");
    expect(second.box.text).toBe("second\n\nfirst");
  });

  it("two Edits, A then B, with A still queued → A's block removed, B's kept", () => {
    const afterB = { text: "words of B\n\nwords of A", attachments: [] };
    expect(withoutTaken(afterB, { messageId: "chat-a", text: "words of A" })).toEqual({ text: "words of B", attachments: [] });
  });

  it("still-queued with words typed meanwhile → box kept", () => {
    // The user typed into Edit's words: they no longer stand intact, so nothing is thrown away.
    expect(withoutTaken({ text: "fix the bug please, and the footer", attachments: [] }, { messageId: "chat-a", text: "fix the bug" })).toBeNull();
    // Typed after them as a block of their own: only Edit's words leave.
    expect(withoutTaken({ text: "fix the bug\n\nalso the footer", attachments: [] }, { messageId: "chat-a", text: "fix the bug" })).toEqual({ text: "also the footer", attachments: [] });
  });

  it("take answers with attachments over the limit → refused, not removed", () => {
    const many = Array.from({ length: 11 }, () => ({ mimeType: "image/png", data: "AAAA" }));
    const result = boxAfterTake(empty, queued({ id: "chat-a", imageCount: 11 }), { text: "", images: many, files: [] });
    expect("refused" in result ? result.refused : null).toMatch(/at most 10/);
    expect(boxAfterTake({ text: "", attachments: [image("own")] }, queued({ id: "chat-a", imageCount: 1 }), { text: "", images: [{ mimeType: "image/png", data: "AAAA" }], files: [] })).toEqual({ refused: EDIT_REFUSAL });
  });

  it("puts a held message's attachments in the box under ids that say whose they are", () => {
    const file: DraftAttachment = { id: "own-2", kind: "file", fileName: "notes.txt", mimeType: "text/plain", data: "BBBB" };
    expect(heldAttachments("chat-a", [image("own-1"), file]).map((attachment) => attachment.id)).toEqual(["chat-a-image-0", "chat-a-file-0"]);
  });
});

describe("Send now's handover (TR-249)", () => {
  it("echoes a queued message in the transcript at once, not in the queue track", () => {
    const echo = handedOverSend(queued(), 5);
    expect(echo).toEqual({ id: "chat-a", text: "Also check the footer", attachments: [], at: 5, state: "sent", sentWhileIdle: true });
    const shown: SendView = { send: echo as PendingSend, mark: "waiting", rowKey: null };
    expect(sendingToQueue([shown])).toEqual([]);
  });

  it("keeps the row of a message whose attachments the client does not hold", () => {
    expect(handedOverSend(queued({ imageCount: 1 }), 5)).toBeNull();
    expect(handedOverSend(queued({ fileNames: ["notes.txt"] }), 5)).toBeNull();
  });
});
