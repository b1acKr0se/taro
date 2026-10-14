import { describe, expect, it } from "vitest";

import {
  ChatMessageIdSchema,
  handBack,
  heldToRelease,
  isWorking,
  newChatMessageId,
  STOPPED_GRACE_MS,
  steersMidTurn,
  viewSends,
  type PendingSend,
  type SendTimelineEntry,
} from "./pending-sends";

const T0 = Date.parse("2026-10-14T18:00:00Z");

function sent(id: string, at = T0, state: PendingSend["state"] = "sent"): PendingSend {
  return { id, text: `words of ${id}`, attachments: [], at, state };
}

let seq = 0;
function entry(type: string, at = T0, clientMessageId?: string): SendTimelineEntry {
  seq += 1;
  return { seqStart: seq * 10, timestamp: new Date(at).toISOString(), item: { type, ...(clientMessageId === undefined ? null : { clientMessageId }) } };
}

function tool(detail: string, status = "completed"): SendTimelineEntry {
  return { ...entry("tool_call"), item: { type: "tool_call", status, detail: { type: detail } } };
}

const WORKING = { stoppedAt: null, hasOlder: false };

describe("viewSends", () => {
  it("marks a message the agent has not taken up yet as waiting, on its timeline row", () => {
    const tool = entry("tool_call");
    const mine = entry("user_message", T0, "chat-a");
    const { views, read } = viewSends([sent("chat-a")], [tool, mine], WORKING, T0 + 60_000);
    expect(read).toEqual([]);
    expect(views).toEqual([{ send: sent("chat-a"), mark: "waiting", rowKey: String(mine.seqStart) }]);
  });

  it("draws a sent message not in the timeline yet itself", () => {
    const { views } = viewSends([sent("chat-a")], [entry("assistant_message")], WORKING, T0);
    expect(views.map((view) => [view.mark, view.rowKey])).toEqual([["waiting", null]]);
  });

  it("reads a message once the agent takes a step after it: a reply, reasoning or a tool call", () => {
    for (const step of ["assistant_message", "reasoning", "tool_call"]) {
      const { views, read } = viewSends([sent("chat-a")], [entry("user_message", T0, "chat-a"), entry(step)], WORKING, T0);
      expect(views).toEqual([]);
      expect(read).toEqual(["chat-a"]);
    }
  });

  it("does not count what an interrupt leaves after the message as reading it (seen end to end)", () => {
    // A Claude owner running a shell command, a message steered in, then the agent stopped: Paseo adds
    // the command's label as it ends and an empty failed call, and the agent never read the message.
    const entries = [entry("user_message"), tool("shell", "canceled"), entry("user_message", T0, "chat-a"), tool("plain_text"), tool("unknown", "failed")];
    const { views, read } = viewSends([sent("chat-a")], entries, { stoppedAt: T0, hasOlder: false }, T0 + STOPPED_GRACE_MS);
    expect(read).toEqual([]);
    expect(views.map((view) => view.mark)).toEqual(["unread"]);
  });

  it("counts a real tool call after the message as reading it, even a failed one", () => {
    for (const step of [tool("shell"), tool("edit", "failed"), tool("unknown")]) {
      expect(viewSends([sent("chat-a")], [entry("user_message", T0, "chat-a"), step], WORKING, T0).read).toEqual(["chat-a"]);
    }
  });

  it("does not count the agent's steps before the message, other messages or errors as reading it", () => {
    const entries = [entry("assistant_message"), entry("tool_call"), entry("user_message", T0, "chat-a"), entry("user_message", T0, "chat-b"), entry("error"), entry("notification")];
    const { views, read } = viewSends([sent("chat-a"), sent("chat-b")], entries, WORKING, T0);
    expect(read).toEqual([]);
    expect(views.map((view) => view.mark)).toEqual(["waiting", "waiting"]);
  });

  it("keeps several queued messages in order and reads them together with the step after the last", () => {
    const sends = [sent("chat-a"), sent("chat-b", T0 + 1), sent("chat-c", T0 + 2)];
    const queued = [entry("tool_call"), entry("user_message", T0, "chat-a"), entry("user_message", T0 + 1, "chat-b"), entry("user_message", T0 + 2, "chat-c")];
    expect(viewSends(sends, queued, WORKING, T0 + 3).views.map((view) => view.send.id)).toEqual(["chat-a", "chat-b", "chat-c"]);
    expect(viewSends(sends, [...queued, entry("assistant_message")], WORKING, T0 + 3).read).toEqual(["chat-a", "chat-b", "chat-c"]);
  });

  it("reads only the earlier messages when the agent stepped between them", () => {
    const sends = [sent("chat-a"), sent("chat-b", T0 + 1)];
    const entries = [entry("user_message", T0, "chat-a"), entry("tool_call"), entry("user_message", T0 + 1, "chat-b")];
    const { views, read } = viewSends(sends, entries, WORKING, T0 + 2);
    expect(read).toEqual(["chat-a"]);
    expect(views.map((view) => view.send.id)).toEqual(["chat-b"]);
  });

  it("says a message was not read once the agent has been stopped for the grace period without a step", () => {
    const entries = [entry("user_message", T0, "chat-a")];
    const stopped = { stoppedAt: T0 + 1_000, hasOlder: false };
    expect(viewSends([sent("chat-a")], entries, stopped, T0 + 1_000 + STOPPED_GRACE_MS - 1).views[0]?.mark).toBe("waiting");
    expect(viewSends([sent("chat-a")], entries, stopped, T0 + 1_000 + STOPPED_GRACE_MS).views[0]?.mark).toBe("unread");
  });

  it("counts the grace period from the send when the agent was already stopped (sent to an idle agent that never started)", () => {
    const stopped = { stoppedAt: T0 - 600_000, hasOlder: false };
    expect(viewSends([sent("chat-a")], [], stopped, T0 + STOPPED_GRACE_MS - 1).views[0]?.mark).toBe("waiting");
    expect(viewSends([sent("chat-a")], [], stopped, T0 + STOPPED_GRACE_MS).views[0]?.mark).toBe("unread");
  });

  it("forgets a message older than the timeline's tail, and keeps one the tail may still be missing", () => {
    const later = [entry("assistant_message", T0 + 60_000)];
    expect(viewSends([sent("chat-a")], later, { stoppedAt: null, hasOlder: true }, T0 + 60_000).read).toEqual(["chat-a"]);
    expect(viewSends([sent("chat-a")], later, { stoppedAt: null, hasOlder: false }, T0 + 60_000).read).toEqual([]);
    expect(viewSends([sent("chat-a", T0 + 120_000)], later, { stoppedAt: null, hasOlder: true }, T0 + 120_000).read).toEqual([]);
  });

  it("shows a held message as held, drawn by the chat, whatever the agent does", () => {
    const held = sent("chat-a", T0, "held");
    const { views } = viewSends([held], [entry("assistant_message")], { stoppedAt: T0 - 100_000, hasOlder: false }, T0 + 100_000);
    expect(views).toEqual([{ send: held, mark: "held", rowKey: null }]);
  });

  it("has nothing to show with nothing sent", () => {
    expect(viewSends([], [], WORKING, T0)).toEqual({ views: [], read: [] });
  });
});

describe("heldToRelease", () => {
  const sends = [sent("chat-a", T0, "held"), sent("chat-b", T0 + 1), sent("chat-c", T0 + 2, "held")];

  it("holds while the agent works", () => {
    expect(heldToRelease(sends, true)).toEqual([]);
  });

  it("releases every held message, oldest first, once it stops", () => {
    expect(heldToRelease(sends, false).map((send) => send.id)).toEqual(["chat-a", "chat-c"]);
  });
});

describe("steersMidTurn", () => {
  it("takes Paseo's steering providers, a plugin's or custom provider, and an agent not read yet, as steering", () => {
    // `claude-work`: a custom provider extending claude under its own id, which Paseo steers like claude.
    for (const provider of ["claude", "codex", "opencode", "pi", "omp", "claude-work", "my-plugin-agent", null, undefined]) expect(steersMidTurn(provider)).toBe(true);
  });

  it("takes Copilot and the ACP agents as replacing the turn", () => {
    for (const provider of ["copilot", "acp", "cursor", "kimi", "kiro", "traecli"]) expect(steersMidTurn(provider)).toBe(false);
  });
});

describe("handBack", () => {
  const image = { id: "image-1", kind: "image" as const, fileName: "screen.png", mimeType: "image/png", data: "iVBORw0KGgo=" };
  const failed: PendingSend = { ...sent("chat-a"), text: "Please also check the phone layout", attachments: [image] };

  it("puts the words and attachments back into an empty composer", () => {
    expect(handBack({ text: "  ", attachments: [] }, failed)).toEqual({ text: failed.text, attachments: [image] });
  });

  it("keeps what was written or attached since", () => {
    expect(handBack({ text: "a new thought", attachments: [] }, failed)).toEqual({ text: null, attachments: [image] });
    expect(handBack({ text: "", attachments: [image] }, failed)).toEqual({ text: failed.text, attachments: null });
  });

  it("puts nothing back for what the message did not have", () => {
    expect(handBack({ text: "", attachments: [] }, { ...failed, text: "", attachments: [] })).toEqual({ text: null, attachments: null });
  });
});

describe("isWorking", () => {
  it("is true while a turn runs or starts", () => {
    expect([isWorking("running"), isWorking("initializing")]).toEqual([true, true]);
    expect([isWorking("idle"), isWorking("error"), isWorking("closed"), isWorking(null)]).toEqual([false, false, false, false]);
  });
});

describe("chat message ids", () => {
  it("are accepted by the contracts and never look like the plugin's own", () => {
    const id = newChatMessageId(T0, () => 0.5);
    expect(ChatMessageIdSchema.safeParse(id).success).toBe(true);
    expect(id.startsWith("taro-")).toBe(false);
    expect(newChatMessageId(T0, () => 0.25)).not.toBe(id);
  });

  it("refuse anything else", () => {
    for (const id of ["taro-1", "chat-", "chat-A B", `chat-${"a".repeat(65)}`]) expect(ChatMessageIdSchema.safeParse(id).success).toBe(false);
  });
});
