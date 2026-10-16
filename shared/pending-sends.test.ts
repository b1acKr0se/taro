import { describe, expect, it } from "vitest";

import {
  ChatMessageIdSchema,
  COMPACTING_REFUSAL,
  failureReason,
  isCompacting,
  isCompactingRefusal,
  isPassingFailure,
  isWorking,
  newChatMessageId,
  nextToSend,
  replacingProviders,
  STOPPED_GRACE_MS,
  steersMidTurn,
  takeBack,
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

  it("has nothing to show with nothing sent", () => {
    expect(viewSends([], [], WORKING, T0)).toEqual({ views: [], read: [], landed: [] });
  });

  it("shows a message on its way as sending, and a failed one with those after it waiting behind it (TR-102)", () => {
    const sends = [sent("chat-a", T0, "sending"), sent("chat-b", T0, "failed"), sent("chat-c", T0, "sending")];
    const { views, read, landed } = viewSends(sends, [entry("assistant_message")], WORKING, T0);
    expect(views.map((view) => [view.send.id, view.mark, view.rowKey])).toEqual([
      ["chat-a", "sending", null],
      ["chat-b", "failed", null],
      ["chat-c", "behind", null],
    ]);
    expect(read).toEqual([]);
    expect(landed).toEqual([]);
  });

  it("takes a sending or failed message found in the timeline as sent: Paseo has it, only the answer was slow or lost", () => {
    const mine = entry("user_message", T0, "chat-a");
    const theirs = entry("user_message", T0, "chat-b");
    const { views, landed } = viewSends([sent("chat-a", T0, "failed"), sent("chat-b", T0, "sending"), sent("chat-c", T0, "sending")], [mine, theirs], WORKING, T0);
    expect(views.map((view) => [view.send.id, view.mark])).toEqual([
      ["chat-a", "waiting"],
      ["chat-b", "waiting"],
      ["chat-c", "sending"],
    ]);
    expect(landed).toEqual(["chat-a", "chat-b"]);
  });

  it("never says a message on its way was not read, however long the agent has been stopped", () => {
    const { views } = viewSends([sent("chat-a", T0, "sending")], [], { stoppedAt: T0 - 100_000, hasOlder: false }, T0 + 100_000);
    expect(views[0]?.mark).toBe("sending");
  });
});

describe("nextToSend (TR-102)", () => {
  it("is the first message sending, in order", () => {
    expect(nextToSend([sent("chat-a", T0, "sending"), sent("chat-b", T0, "sending")])?.id).toBe("chat-a");
  });

  it("is none while a failed message comes first, so nothing overtakes it", () => {
    expect(nextToSend([sent("chat-a", T0, "failed"), sent("chat-b", T0, "sending")])).toBeNull();
  });

  it("is the one before a failed message, which went first", () => {
    expect(nextToSend([sent("chat-a", T0, "sending"), sent("chat-b", T0, "failed")])?.id).toBe("chat-a");
  });

  it("is none with nothing to send", () => {
    expect(nextToSend([])).toBeNull();
    expect(nextToSend([sent("chat-a"), sent("chat-b")])).toBeNull();
  });

  it("goes past messages already sent", () => {
    expect(nextToSend([sent("chat-a"), sent("chat-b", T0, "sending")])?.id).toBe("chat-b");
  });
});

describe("isPassingFailure", () => {
  it("is a dropped connection or a plugin restarting", () => {
    expect(isPassingFailure(new Error("Transport closed (code 1006)"))).toBe(true);
    expect(isPassingFailure(new Error("Request failed: Plugin is not available: taro"))).toBe(true);
    expect(isPassingFailure(new Error("Request timed out"))).toBe(true);
  });

  it("is not a refusal or a missing agent, which another try would not change", () => {
    expect(isPassingFailure(new Error("That agent is no longer running."))).toBe(false);
    expect(isPassingFailure(new Error("Say something to the Manager."))).toBe(false);
    expect(isPassingFailure(undefined)).toBe(false);
  });
});

describe("failureReason", () => {
  it("is the error's message, trimmed", () => {
    expect(failureReason(new Error("  That agent is no longer running. "))).toBe("That agent is no longer running.");
    expect(failureReason("Say something to the Manager.")).toBe("Say something to the Manager.");
  });

  it("says the connection dropped, in words, for the app's transport errors (seen end to end: code 1006)", () => {
    expect(failureReason(new Error("Transport closed (code 1006)"))).toBe("the connection to Paseo dropped.");
    expect(failureReason(new Error("Not connected"))).toBe("the connection to Paseo dropped.");
    expect(failureReason(new Error("Request timed out after 30000ms"))).toBe("the connection to Paseo dropped.");
    expect(failureReason(new Error("Timeout waiting for response"))).toBe("the connection to Paseo dropped.");
  });

  it("says Taro was restarting for a call made while the plugin reloaded (seen end to end)", () => {
    expect(failureReason(new Error("Request failed: Plugin is not available: taro requestType=plugin.rpc.invoke.request code=handler_error"))).toBe("Taro was restarting.");
  });

  it("says Paseo did not take it when the error says nothing", () => {
    expect(failureReason(new Error(""))).toBe("Paseo did not take it.");
    expect(failureReason(undefined)).toBe("Paseo did not take it.");
    expect(failureReason({ code: 1 })).toBe("Paseo did not take it.");
  });
});

function compaction(status: "loading" | "completed"): SendTimelineEntry {
  return { ...entry("compaction"), item: { type: "compaction", status } };
}

describe("isCompacting (TR-102)", () => {
  it("is true from a compaction's start until its end", () => {
    expect(isCompacting([entry("assistant_message"), compaction("loading")])).toBe(true);
    expect(isCompacting([compaction("loading"), compaction("completed")])).toBe(false);
  });

  it("stays true with only the user's messages since: they wait for the compaction", () => {
    expect(isCompacting([compaction("loading"), entry("user_message", T0, "chat-a")])).toBe(true);
  });

  it("is false once the agent took a step after a compaction that never ended (one cancelled)", () => {
    expect(isCompacting([compaction("loading"), entry("user_message"), entry("assistant_message")])).toBe(false);
    expect(isCompacting([compaction("loading"), tool("shell")])).toBe(false);
  });

  it("is false with no compaction", () => {
    expect(isCompacting([])).toBe(false);
    expect(isCompacting([entry("assistant_message")])).toBe(false);
  });
});

describe("isCompactingRefusal", () => {
  it("recognises the plugin's answer through Paseo's wrapping, and nothing else", () => {
    expect(isCompactingRefusal(new Error(`Request failed: ${COMPACTING_REFUSAL} code=handler_error`))).toBe(true);
    expect(isCompactingRefusal(new Error("Transport closed (code 1006)"))).toBe(false);
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

describe("replacingProviders", () => {
  it("adds a custom provider extending an ACP one, directly or through another custom one", () => {
    const config = { agents: { providers: { gemini: { extends: "acp", command: ["gemini", "--acp"] }, "gemini-work": { extends: "gemini" }, "pilot": { extends: "copilot" } } } };
    const replacing = replacingProviders(config);
    for (const provider of ["gemini", "gemini-work", "pilot", "copilot", "acp"]) expect(steersMidTurn(provider, replacing)).toBe(false);
  });

  it("keeps a custom provider extending a steering one, an override of a built-in, and a loop steering", () => {
    const config = { agents: { providers: { "claude-work": { extends: "claude" }, codex: { enabled: false }, loop: { extends: "loop-back" }, "loop-back": { extends: "loop" } } } };
    const replacing = replacingProviders(config);
    for (const provider of ["claude-work", "codex", "loop", "loop-back"]) expect(steersMidTurn(provider, replacing)).toBe(true);
  });

  it("is the built-in list for a config without providers, or one that is not an object", () => {
    for (const config of [{}, { agents: {} }, { agents: { providers: [] } }, null, "text", { agents: { providers: { odd: { extends: 3 } } } }]) {
      expect([...replacingProviders(config)].sort()).toEqual(["acp", "copilot", "cursor", "kimi", "kiro", "traecli"]);
    }
  });
});

describe("takeBack (TR-102)", () => {
  const image = { id: "a1", kind: "image" as const, mimeType: "image/png", data: "AAAA", fileName: "shot.png" };
  const file = { id: "a2", kind: "file" as const, mimeType: "text/plain", data: "BBBB", fileName: "notes.txt" };

  it("puts the words and attachments of a message not sent into an empty box", () => {
    expect(takeBack({ text: "  ", attachments: [] }, { ...sent("chat-a"), text: "hello", attachments: [image] })).toEqual({ text: "hello", attachments: [image] });
  });

  it("puts them ahead of what was written or attached since, losing neither (seen end to end: a half-typed reply)", () => {
    expect(takeBack({ text: "half-typed reply ", attachments: [file] }, { ...sent("chat-a"), text: "first", attachments: [image] })).toEqual({
      text: "first\n\nhalf-typed reply ",
      attachments: [image, file],
    });
  });

  it("takes a message out of the daemon's queue as it takes back one not sent (TR-171)", () => {
    expect(takeBack({ text: "typed", attachments: [] }, { text: "queued words", attachments: [file] })).toEqual({ text: "queued words\n\ntyped", attachments: [file] });
  });

  it("keeps the box as it is for a message of attachments alone", () => {
    expect(takeBack({ text: "typed", attachments: [] }, { ...sent("chat-a"), text: "", attachments: [image] })).toEqual({ text: "typed", attachments: [image] });
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
