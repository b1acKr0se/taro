import { describe, expect, it, vi } from "vitest";

import type { PendingSend } from "../shared/pending-sends";
import { createPendingSendStore } from "./pending-send-store";

function send(id: string, state: PendingSend["state"] = "sent"): PendingSend {
  return { id, text: id, attachments: [], at: 1, state };
}

describe("createPendingSendStore", () => {
  it("keeps each agent's messages in order, and tells listeners of every change", () => {
    const store = createPendingSendStore({});
    const listener = vi.fn();
    store.subscribe(listener);
    store.add("agent-1", send("chat-a", "held"));
    store.add("agent-1", send("chat-b"));
    store.add("agent-2", send("chat-c"));
    store.update("agent-1", "chat-a", { state: "sent", at: 5 });
    expect(store.get("agent-1")).toEqual([{ ...send("chat-a"), at: 5 }, send("chat-b")]);
    store.remove("agent-1", ["chat-a", "chat-b"]);
    expect(store.get("agent-1")).toEqual([]);
    expect(store.get("agent-2")).toEqual([send("chat-c")]);
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it("does not tell listeners when nothing was removed", () => {
    const store = createPendingSendStore({});
    const listener = vi.fn();
    store.subscribe(listener);
    store.remove("agent-1", ["chat-a"]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("outlives the bundle: a new store on the same root reads what the last one kept", () => {
    const root = {};
    createPendingSendStore(root).add("agent-1", send("chat-a", "held"));
    expect(createPendingSendStore(root).get("agent-1")).toEqual([send("chat-a", "held")]);
  });
});
