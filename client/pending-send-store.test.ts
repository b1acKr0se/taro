import { describe, expect, it, vi } from "vitest";

import type { PendingSend } from "../shared/pending-sends";
import { createPendingSendStore, releaseHeld } from "./pending-send-store";

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

  it("claims held messages once and in order: they are marked sent, and a second claim gets nothing", () => {
    const store = createPendingSendStore({});
    store.add("agent-1", send("chat-a", "held"));
    store.add("agent-1", send("chat-b"));
    store.add("agent-1", send("chat-c", "held"));
    expect(store.claim("agent-1", ["chat-c", "chat-b", "chat-a"], 9).map((each) => each.id)).toEqual(["chat-a", "chat-c"]);
    expect(store.get("agent-1")).toEqual([{ ...send("chat-a"), at: 9 }, send("chat-b"), { ...send("chat-c"), at: 9 }]);
    expect(store.claim("agent-1", ["chat-a"], 10)).toEqual([]);
    expect(store.claim("agent-1", ["chat-missing"], 10)).toEqual([]);
  });

  it("resends a message as a new one at the end, sent or held, and nothing for one gone", () => {
    const store = createPendingSendStore({});
    store.add("agent-1", send("chat-a"));
    store.add("agent-1", send("chat-b"));
    expect(store.resend("agent-1", "chat-a", { id: "chat-c", at: 7, holds: false })).toEqual({ ...send("chat-a"), id: "chat-c", at: 7 });
    expect(store.get("agent-1").map((each) => [each.id, each.state])).toEqual([["chat-b", "sent"], ["chat-c", "sent"]]);
    expect(store.resend("agent-1", "chat-b", { id: "chat-d", at: 8, holds: true })?.state).toBe("held");
    expect(store.resend("agent-1", "chat-gone", { id: "chat-e", at: 9, holds: false })).toBeNull();
    expect(store.get("agent-1").map((each) => each.id)).toEqual(["chat-c", "chat-d"]);
  });
});

describe("releaseHeld", () => {
  function held(id: string, at: number) {
    return { ...send(id, "held"), at };
  }

  it("sends each stopped agent's held messages, oldest first, once", () => {
    const store = createPendingSendStore({});
    store.add("agent-1", held("chat-a", 10));
    store.add("agent-1", send("chat-b"));
    store.add("agent-1", held("chat-c", 11));
    const deliver = vi.fn();
    const agents = new Map([["agent-1", { status: "idle", updatedAt: 20 }]]);
    releaseHeld(store, agents, deliver, 30);
    releaseHeld(store, agents, deliver, 31);
    expect(deliver.mock.calls).toEqual([
      ["agent-1", { ...held("chat-a", 30), state: "sent" }],
      ["agent-1", { ...held("chat-c", 30), state: "sent" }],
    ]);
  });

  it("holds while the agent works, or when its status was read before the message was held", () => {
    const store = createPendingSendStore({});
    store.add("agent-1", held("chat-a", 10));
    store.add("agent-2", held("chat-b", 10));
    const deliver = vi.fn();
    releaseHeld(store, new Map([["agent-1", { status: "running", updatedAt: 20 }], ["agent-2", { status: "idle", updatedAt: 5 }]]), deliver, 30);
    expect(deliver).not.toHaveBeenCalled();
    expect(store.get("agent-2")[0]?.state).toBe("held");
  });

  it("leaves an agent it was told nothing about to its chat", () => {
    const store = createPendingSendStore({});
    store.add("agent-1", held("chat-a", 10));
    const deliver = vi.fn();
    releaseHeld(store, new Map(), deliver, 30);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("sends a message once when a listener releases again while it releases (the screen and a chat at once)", () => {
    const store = createPendingSendStore({});
    store.add("agent-1", held("chat-a", 10));
    store.add("agent-1", held("chat-b", 11));
    const deliver = vi.fn();
    const agents = new Map([["agent-1", { status: "idle", updatedAt: 20 }]]);
    store.subscribe(() => releaseHeld(store, agents, deliver, 30));
    releaseHeld(store, agents, deliver, 30);
    expect(deliver.mock.calls.map((call) => (call[1] as { id: string }).id)).toEqual(["chat-a", "chat-b"]);
  });
});
