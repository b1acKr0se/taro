import { describe, expect, it, vi } from "vitest";

import type { PendingSend } from "../shared/pending-sends";
import { createPendingSendStore, releaseHeld, type PendingSendStore } from "./pending-send-store";

function send(id: string, state: PendingSend["state"] = "sent"): PendingSend {
  return { id, text: id, attachments: [], at: 1, state };
}

/** A transport whose sends settle when the test says, recording each message id it was handed. */
function manualTransport() {
  const calls: { id: string; settle: (error?: Error) => void }[] = [];
  const transport = vi.fn(
    (pending: PendingSend) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ id: pending.id, settle: (error) => (error === undefined ? resolve() : reject(error)) });
      }),
  );
  return { transport, calls, ids: () => calls.map((call) => call.id) };
}

/** Lets the store's sending loop run its awaited steps. */
async function settled(): Promise<void> {
  for (let step = 0; step < 10; step += 1) await Promise.resolve();
}

function states(store: PendingSendStore, agentId = "agent-1") {
  return store.get(agentId).map((each) => `${each.id}:${each.state}`);
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

  it("claims held messages once and in order: they are marked sending, and a second claim gets nothing", () => {
    const store = createPendingSendStore({});
    store.add("agent-1", send("chat-a", "held"));
    store.add("agent-1", send("chat-b"));
    store.add("agent-1", send("chat-c", "held"));
    expect(store.claim("agent-1", ["chat-c", "chat-b", "chat-a"], 9).map((each) => each.id)).toEqual(["chat-a", "chat-c"]);
    expect(store.get("agent-1")).toEqual([{ ...send("chat-a", "sending"), at: 9 }, send("chat-b"), { ...send("chat-c", "sending"), at: 9 }]);
    expect(store.claim("agent-1", ["chat-a"], 10)).toEqual([]);
    expect(store.claim("agent-1", ["chat-missing"], 10)).toEqual([]);
  });

  it("resends a message as a new one at the end, sending or held, and nothing for one gone", () => {
    const store = createPendingSendStore({});
    store.add("agent-1", send("chat-a"));
    store.add("agent-1", send("chat-b"));
    expect(store.resend("agent-1", "chat-a", { id: "chat-c", at: 7, holds: false })).toEqual({ ...send("chat-a", "sending"), id: "chat-c", at: 7, error: undefined });
    expect(states(store)).toEqual(["chat-b:sent", "chat-c:sending"]);
    expect(store.resend("agent-1", "chat-b", { id: "chat-d", at: 8, holds: true })?.state).toBe("held");
    expect(store.resend("agent-1", "chat-gone", { id: "chat-e", at: 9, holds: false })).toBeNull();
    expect(store.get("agent-1").map((each) => each.id)).toEqual(["chat-c", "chat-d"]);
  });
});

describe("sending (TR-102)", () => {
  it("sends several messages added back to back one at a time, in the order sent", async () => {
    const store = createPendingSendStore({}, () => 50);
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    ["chat-a", "chat-b", "chat-c"].forEach((id) => store.add("agent-1", send(id, "sending")));
    await settled();
    // Only the first is on its way; the others wait their turn, shown as sending.
    expect(wire.ids()).toEqual(["chat-a"]);
    expect(states(store)).toEqual(["chat-a:sending", "chat-b:sending", "chat-c:sending"]);
    wire.calls[0]?.settle();
    await settled();
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
    wire.calls[1]?.settle();
    await settled();
    store.add("agent-1", send("chat-d", "sending"));
    wire.calls[2]?.settle();
    await settled();
    wire.calls[3]?.settle();
    await settled();
    expect(wire.ids()).toEqual(["chat-a", "chat-b", "chat-c", "chat-d"]);
    expect(states(store)).toEqual(["chat-a:sent", "chat-b:sent", "chat-c:sent", "chat-d:sent"]);
    expect(store.get("agent-1")[0]?.at).toBe(50);
  });

  it("keeps each agent's line apart: one agent's slow send does not hold up another's", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.setTransport("agent-2", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-2", send("chat-b", "sending"));
    await settled();
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
  });

  it("marks a failed message with the reason and sends nothing after it, so nothing overtakes it", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-1", send("chat-b", "sending"));
    await settled();
    wire.calls[0]?.settle(new Error("Not connected"));
    await settled();
    expect(wire.ids()).toEqual(["chat-a"]);
    expect(store.get("agent-1")[0]).toMatchObject({ id: "chat-a", state: "failed", error: "Not connected" });
    // A message sent while one failed waits behind it too.
    store.add("agent-1", send("chat-c", "sending"));
    await settled();
    expect(wire.ids()).toEqual(["chat-a"]);
    expect(states(store)).toEqual(["chat-a:failed", "chat-b:sending", "chat-c:sending"]);
  });

  it("retries a failed message under its own id, then sends those behind it in order", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-1", send("chat-b", "sending"));
    await settled();
    wire.calls[0]?.settle(new Error("Not connected"));
    await settled();
    store.retry("agent-1", "chat-a");
    await settled();
    expect(store.get("agent-1")[0]).toMatchObject({ id: "chat-a", state: "sending", error: undefined });
    wire.calls[1]?.settle();
    await settled();
    wire.calls[2]?.settle();
    await settled();
    expect(wire.ids()).toEqual(["chat-a", "chat-a", "chat-b"]);
    expect(states(store)).toEqual(["chat-a:sent", "chat-b:sent"]);
  });

  it("sends those behind once a failed message is taken back (Edit)", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-1", send("chat-b", "sending"));
    await settled();
    wire.calls[0]?.settle(new Error("That agent is no longer running."));
    await settled();
    store.remove("agent-1", ["chat-a"]);
    await settled();
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
  });

  it("sends those behind once a failed message turns out to be in the timeline after all", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-1", send("chat-b", "sending"));
    await settled();
    wire.calls[0]?.settle(new Error("Request timed out"));
    await settled();
    store.update("agent-1", "chat-a", { state: "sent", error: undefined });
    await settled();
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
  });

  it("keeps a message seen in the timeline sent when its own answer fails afterwards (a lost answer)", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-1", send("chat-b", "sending"));
    await settled();
    store.update("agent-1", "chat-a", { state: "sent" });
    wire.calls[0]?.settle(new Error("Connection lost"));
    await settled();
    expect(states(store)).toEqual(["chat-a:sent", "chat-b:sending"]);
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
  });

  it("waits for a transport, then sends: a message left sending by the last bundle goes again under its id", async () => {
    const root = {};
    createPendingSendStore(root).add("agent-1", send("chat-a", "sending"));
    // The bundles were evaluated again (a reconnect or a plugin reload): a new store, no transport yet.
    const store = createPendingSendStore(root);
    const wire = manualTransport();
    await settled();
    expect(wire.ids()).toEqual([]);
    store.setTransport("agent-1", wire.transport);
    await settled();
    expect(wire.ids()).toEqual(["chat-a"]);
  });

  it("uses the latest transport given, and goes on with the next message after the chat that sent it left", async () => {
    const store = createPendingSendStore({});
    const chat = manualTransport();
    const screen = manualTransport();
    store.setTransport("agent-1", screen.transport);
    store.setTransport("agent-1", chat.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-1", send("chat-b", "sending"));
    await settled();
    // The screen renders again after the chat closed, and gives its own.
    store.setTransport("agent-1", screen.transport);
    chat.calls[0]?.settle();
    await settled();
    expect(chat.ids()).toEqual(["chat-a"]);
    expect(screen.ids()).toEqual(["chat-b"]);
  });

  it("does not send held or already sent messages", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "held"));
    store.add("agent-1", send("chat-b", "sent"));
    await settled();
    expect(wire.ids()).toEqual([]);
  });
});

describe("releaseHeld", () => {
  function held(id: string, at: number) {
    return { ...send(id, "held"), at };
  }

  it("sends each stopped agent's held messages, oldest first, once", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", held("chat-a", 10));
    store.add("agent-1", send("chat-b"));
    store.add("agent-1", held("chat-c", 11));
    const agents = new Map([["agent-1", { status: "idle", updatedAt: 20 }]]);
    releaseHeld(store, agents, 30);
    releaseHeld(store, agents, 31);
    await settled();
    wire.calls[0]?.settle();
    await settled();
    expect(wire.ids()).toEqual(["chat-a", "chat-c"]);
    expect(store.get("agent-1")[2]).toMatchObject({ id: "chat-c", state: "sending", at: 30 });
  });

  it("holds while the agent works, or when its status was read before the message was held", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.setTransport("agent-2", wire.transport);
    store.add("agent-1", held("chat-a", 10));
    store.add("agent-2", held("chat-b", 10));
    releaseHeld(store, new Map([["agent-1", { status: "running", updatedAt: 20 }], ["agent-2", { status: "idle", updatedAt: 5 }]]), 30);
    await settled();
    expect(wire.ids()).toEqual([]);
    expect(store.get("agent-2")[0]?.state).toBe("held");
  });

  it("leaves an agent it was told nothing about to its chat", () => {
    const store = createPendingSendStore({});
    store.add("agent-1", held("chat-a", 10));
    releaseHeld(store, new Map(), 30);
    expect(store.get("agent-1")[0]?.state).toBe("held");
  });

  it("sends a message once when a listener releases again while it releases (the screen and a chat at once)", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", held("chat-a", 10));
    store.add("agent-1", held("chat-b", 11));
    const agents = new Map([["agent-1", { status: "idle", updatedAt: 20 }]]);
    store.subscribe(() => releaseHeld(store, agents, 30));
    releaseHeld(store, agents, 30);
    await settled();
    wire.calls[0]?.settle();
    await settled();
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
  });
});
