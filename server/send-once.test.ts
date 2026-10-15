import { describe, expect, it, vi } from "vitest";

import type { PaseoApi } from "./host-types";
import { holdsMessage, sendChatMessageOnce } from "./send";

/** A Paseo whose timeline holds user messages under these ids, read as many times as asked. */
function paseoWith(ids: string[], options: { unreadable?: boolean } = {}) {
  const reads = vi.fn();
  const paseo = {
    agents: {
      ref: () => ({
        timeline: {
          refetch: async () => {
            reads();
            if (options.unreadable === true) throw new Error("timeline unavailable");
            return { entries: ids.map((id) => ({ item: { type: "user_message", text: "words", clientMessageId: id } })) };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  return { paseo, reads };
}

describe("sendChatMessageOnce (TR-102)", () => {
  it("sends a chat message Paseo does not hold yet", async () => {
    const { paseo } = paseoWith(["chat-other"]);
    const send = vi.fn(async () => {});
    await sendChatMessageOnce(paseo, "agent-1", "chat-a", send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("skips a message Paseo already holds: a retry after its answer was lost is not doubled", async () => {
    const { paseo } = paseoWith(["chat-a"]);
    const send = vi.fn(async () => {});
    await sendChatMessageOnce(paseo, "agent-1", "chat-a", send);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a message once when it is sent again while the first send is still on its way (an old bundle and a new one)", async () => {
    const { paseo } = paseoWith([]);
    let finish = () => {};
    const send = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const first = sendChatMessageOnce(paseo, "agent-1", "chat-a", send);
    const second = sendChatMessageOnce(paseo, "agent-1", "chat-a", send);
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish();
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shares the first send's failure with the second, and lets a later retry try again", async () => {
    const { paseo } = paseoWith([]);
    const send = vi.fn(async () => {
      throw new Error("agent not found");
    });
    const results = await Promise.allSettled([sendChatMessageOnce(paseo, "agent-1", "chat-a", send), sendChatMessageOnce(paseo, "agent-1", "chat-a", send)]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await expect(sendChatMessageOnce(paseo, "agent-1", "chat-a", send)).rejects.toThrow("agent not found");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends when the timeline cannot be read rather than lose the message", async () => {
    const { paseo } = paseoWith(["chat-a"], { unreadable: true });
    const send = vi.fn(async () => {});
    await sendChatMessageOnce(paseo, "agent-1", "chat-a", send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends the plugin's own and id-less messages straight away, without reading the timeline", async () => {
    const { paseo, reads } = paseoWith(["taro-1"]);
    const send = vi.fn(async () => {});
    await sendChatMessageOnce(paseo, "agent-1", "taro-1", send);
    await sendChatMessageOnce(paseo, "agent-1", undefined, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(reads).not.toHaveBeenCalled();
  });

  it("keeps two agents' messages of the same id apart", async () => {
    const { paseo } = paseoWith([]);
    const send = vi.fn(async () => {});
    await Promise.all([sendChatMessageOnce(paseo, "agent-1", "chat-a", send), sendChatMessageOnce(paseo, "agent-2", "chat-a", send)]);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("holdsMessage", () => {
  it("finds the user's message by its id, and nothing else", () => {
    const entries = [
      { item: { type: "assistant_message", text: "chat-a" } },
      { item: { type: "user_message", text: "hi", clientMessageId: "chat-b" } },
    ] as unknown as Parameters<typeof holdsMessage>[0];
    expect(holdsMessage(entries, "chat-b")).toBe(true);
    expect(holdsMessage(entries, "chat-a")).toBe(false);
    expect(holdsMessage([], "chat-b")).toBe(false);
  });
});
