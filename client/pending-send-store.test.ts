import { describe, expect, it, vi } from "vitest";

import type { PendingSend } from "../shared/pending-sends";
import { keptMap } from "./kept";
import { createPendingSendStore, migrateKeptSends, type PendingSendStore } from "./pending-send-store";

function send(id: string, state: PendingSend["state"] = "sent"): PendingSend {
  return { id, text: id, attachments: [], at: 1, state };
}

/** A transport whose sends settle when the test says, recording each message id it was handed. */
function manualTransport() {
  const calls: { id: string; answersRequest: boolean | undefined; settle: (error?: Error) => void; queue: () => void }[] = [];
  const transport = vi.fn(
    (pending: PendingSend) =>
      new Promise<{ queued: boolean }>((resolve, reject) => {
        calls.push({
          id: pending.id,
          answersRequest: pending.answersRequest,
          settle: (error) => (error === undefined ? resolve({ queued: false }) : reject(error)),
          queue: () => resolve({ queued: true }),
        });
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
    store.add("agent-1", send("chat-a", "failed"));
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
    createPendingSendStore(root).add("agent-1", send("chat-a", "failed"));
    expect(createPendingSendStore(root).get("agent-1")).toEqual([send("chat-a", "failed")]);
  });

  it("resends a message as a new one at the end, to send, and nothing for one gone", () => {
    const store = createPendingSendStore({});
    store.add("agent-1", send("chat-a"));
    store.add("agent-1", send("chat-b"));
    expect(store.resend("agent-1", "chat-a", { id: "chat-c", at: 7 })).toEqual({ ...send("chat-a", "sending"), id: "chat-c", at: 7, error: undefined });
    expect(states(store)).toEqual(["chat-b:sent", "chat-c:sending"]);
    expect(store.resend("agent-1", "chat-b", { id: "chat-d", at: 8 })?.state).toBe("sending");
    expect(store.resend("agent-1", "chat-gone", { id: "chat-e", at: 9 })).toBeNull();
    expect(store.get("agent-1").map((each) => each.id)).toEqual(["chat-c", "chat-d"]);
    // Whether the agent works as it goes again, not as the first send found it (TR-216).
    expect(store.resend("agent-1", "chat-c", { id: "chat-f", at: 10, sentWhileIdle: true })?.sentWhileIdle).toBe(true);
    expect(store.resend("agent-1", "chat-f", { id: "chat-g", at: 11, sentWhileIdle: false })?.sentWhileIdle).toBe(false);
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
    wire.calls[0]?.settle(new Error("That agent is no longer running."));
    await settled();
    expect(wire.ids()).toEqual(["chat-a"]);
    expect(store.get("agent-1")[0]).toMatchObject({ id: "chat-a", state: "failed", error: "That agent is no longer running." });
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
    wire.calls[0]?.settle(new Error("Say something to the Manager."));
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
    wire.calls[0]?.settle(new Error("Unknown agent"));
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
    wire.calls[0]?.settle(new Error("Unknown agent"));
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

  it("tries again after a failure that passes (a dropped connection, a plugin reload), then sends the next", async () => {
    const waits: number[] = [];
    const store = createPendingSendStore({}, () => 50, async (ms) => {
      waits.push(ms);
    });
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-1", send("chat-b", "sending"));
    await settled();
    wire.calls[0]?.settle(new Error("Transport closed (code 1006)"));
    await settled();
    wire.calls[1]?.settle(new Error("Request failed: Plugin is not available: taro requestType=plugin.rpc.invoke.request code=handler_error"));
    await settled();
    // Still sending meanwhile: nothing says Not sent while it is tried again.
    expect(states(store)).toEqual(["chat-a:sending", "chat-b:sending"]);
    wire.calls[2]?.settle();
    await settled();
    expect(wire.ids()).toEqual(["chat-a", "chat-a", "chat-a", "chat-b"]);
    expect(waits).toEqual([1_000, 3_000]);
  });

  it("says Not sent, in words, once the tries run out", async () => {
    const store = createPendingSendStore({}, () => 50, async () => {});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await settled();
      wire.calls[attempt]?.settle(new Error("Transport closed (code 1006)"));
    }
    await settled();
    expect(wire.ids()).toHaveLength(4);
    expect(store.get("agent-1")[0]).toMatchObject({ state: "failed", error: "the connection to Paseo dropped." });
  });

  it("stops trying a message taken back or found in the timeline while it waited to try again", async () => {
    let release = () => {};
    const store = createPendingSendStore({}, () => 50, () => new Promise<void>((resolve) => (release = resolve)));
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-1", send("chat-b", "sending"));
    await settled();
    wire.calls[0]?.settle(new Error("Not connected"));
    await settled();
    store.update("agent-1", "chat-a", { state: "sent" });
    release();
    await settled();
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
  });

  it("does not try again after a failure that stays (the agent is gone, a refusal)", async () => {
    const waits: number[] = [];
    const store = createPendingSendStore({}, () => 50, async (ms) => {
      waits.push(ms);
    });
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    await settled();
    wire.calls[0]?.settle(new Error("That agent is no longer running."));
    await settled();
    expect(wire.ids()).toEqual(["chat-a"]);
    expect(waits).toEqual([]);
  });

  it("stops the last bundle's loop once a new one sends for the agent, so it never marks what the new one sends (a reconnect)", async () => {
    const root = {};
    const old = createPendingSendStore(root, () => 50, async () => {});
    const deadLink = manualTransport();
    old.setTransport("agent-1", deadLink.transport);
    old.add("agent-1", send("chat-a", "sending"));
    old.add("agent-1", send("chat-b", "sending"));
    await settled();
    // The bundles are evaluated again: a new store on the same root takes the agent over.
    const store = createPendingSendStore(root, () => 60);
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    await settled();
    expect(wire.ids()).toEqual(["chat-a"]);
    // The old connection's send fails late, for good: the old loop neither marks nor retries it.
    deadLink.calls[0]?.settle(new Error("Agent not found"));
    await settled();
    expect(states(store)).toEqual(["chat-a:sending", "chat-b:sending"]);
    expect(deadLink.ids()).toEqual(["chat-a"]);
    wire.calls[0]?.settle();
    await settled();
    wire.calls[1]?.settle();
    await settled();
    expect(states(store)).toEqual(["chat-a:sent", "chat-b:sent"]);
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
  });

  it("keeps each agent's sender: a second store taking one agent leaves another's sending (Taro on two hosts)", async () => {
    const root = {};
    const first = createPendingSendStore(root);
    const firstWire = manualTransport();
    first.setTransport("agent-1", firstWire.transport);
    const second = createPendingSendStore(root);
    second.setTransport("agent-2", manualTransport().transport);
    first.add("agent-1", send("chat-a", "sending"));
    await settled();
    expect(firstWire.ids()).toEqual(["chat-a"]);
  });

  it("does not send failed or already sent messages", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sent"));
    store.add("agent-1", send("chat-b", "failed"));
    await settled();
    expect(wire.ids()).toEqual([]);
  });
});

describe("the chat queue on the daemon (TR-171, TR-287)", () => {
  it("queued answer keeps the message, marked queued with when the answer came, and sends the next", async () => {
    let clock = 1000;
    const store = createPendingSendStore({}, () => clock);
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-1", send("chat-b", "sending"));
    await settled();
    clock = 5000;
    wire.calls[0]?.queue();
    await settled();
    expect(store.get("agent-1")[0]).toMatchObject({ id: "chat-a", state: "queued", queuedAt: 5000 });
    expect(states(store)).toEqual(["chat-a:queued", "chat-b:sending"]);
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
    wire.calls[1]?.settle();
    await settled();
    expect(states(store)).toEqual(["chat-a:queued", "chat-b:sent"]);
  });

  it("hands the transport whether the message answers a pending request", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", { ...send("chat-a", "sending"), answersRequest: true });
    await settled();
    expect(wire.calls[0]?.answersRequest).toBe(true);
  });
});

describe("takeOut (TR-287)", () => {
  async function inFlight(retryWait: (ms: number) => Promise<void> = async () => {}) {
    const store = createPendingSendStore({}, () => 50, retryWait);
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    store.add("agent-1", send("chat-b", "sending"));
    await settled();
    return { store, wire };
  }
  function outcomeOf(promise: Promise<string>) {
    const seen: { value: string | null } = { value: null };
    void promise.then((value) => (seen.value = value));
    return seen;
  }

  it("takes one waiting its turn out at once: never handed to the plugin", async () => {
    const { store, wire } = await inFlight();
    await expect(store.takeOut("agent-1", "chat-b")).resolves.toBe("never-sent");
    expect(states(store)).toEqual(["chat-a:sending"]);
    wire.calls[0]?.settle();
    await settled();
    expect(wire.ids()).toEqual(["chat-a"]);
  });

  it("marks one in flight for Edit, drawn nowhere, then takes it out when the daemon queued it", async () => {
    const { store, wire } = await inFlight();
    const outcome = outcomeOf(store.takeOut("agent-1", "chat-a"));
    await settled();
    expect(store.get("agent-1")[0]).toMatchObject({ id: "chat-a", handedOver: "edit", state: "sending" });
    expect(outcome.value).toBeNull();
    wire.calls[0]?.queue();
    await settled();
    expect(outcome.value).toBe("queued");
    expect(states(store)).toEqual(["chat-b:sending"]);
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
  });

  it("keeps one in flight that was sent at once as sent, its mark cleared", async () => {
    const { store, wire } = await inFlight();
    const outcome = outcomeOf(store.takeOut("agent-1", "chat-a"));
    wire.calls[0]?.settle();
    await settled();
    expect(outcome.value).toBe("sent");
    expect(store.get("agent-1")[0]).toMatchObject({ id: "chat-a", state: "sent", handedOver: undefined });
  });

  it("takes out one in flight refused on its first try: the plugin never had it, and it is not Not sent", async () => {
    const { store, wire } = await inFlight();
    const outcome = outcomeOf(store.takeOut("agent-1", "chat-a"));
    wire.calls[0]?.settle(new Error("That agent is no longer running."));
    await settled();
    expect(outcome.value).toBe("never-sent");
    expect(states(store)).toEqual(["chat-b:sending"]);
  });

  it("stops trying one in flight when a try fails in passing: the daemon may hold it", async () => {
    const waits: number[] = [];
    const { store, wire } = await inFlight(async (ms) => {
      waits.push(ms);
    });
    const outcome = outcomeOf(store.takeOut("agent-1", "chat-a"));
    wire.calls[0]?.settle(new Error("Transport closed (code 1006)"));
    await settled();
    expect(outcome.value).toBe("maybe-queued");
    expect(waits).toEqual([]);
    // No further try of chat-a: the next one goes instead.
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
    expect(states(store)).toEqual(["chat-b:sending"]);
  });

  it("stops trying one marked while it waited to try again after a failure in passing", async () => {
    let release = () => {};
    const { store, wire } = await inFlight(() => new Promise<void>((resolve) => (release = resolve)));
    wire.calls[0]?.settle(new Error("Transport closed (code 1006)"));
    await settled();
    const outcome = outcomeOf(store.takeOut("agent-1", "chat-a"));
    release();
    await settled();
    expect(outcome.value).toBe("maybe-queued");
    expect(wire.ids()).toEqual(["chat-a", "chat-b"]);
  });

  it("takes out one already queued at once", async () => {
    const store = createPendingSendStore({});
    store.add("agent-1", { ...send("chat-c", "queued"), queuedAt: 5 });
    await expect(store.takeOut("agent-1", "chat-c")).resolves.toBe("queued");
    expect(store.get("agent-1")).toEqual([]);
  });

  it("answers sent for one landed in the timeline before its answer, its mark cleared", async () => {
    const { store, wire } = await inFlight();
    const outcome = outcomeOf(store.takeOut("agent-1", "chat-a"));
    store.update("agent-1", "chat-a", { state: "sent", error: undefined });
    await settled();
    expect(outcome.value).toBe("sent");
    expect(store.get("agent-1")[0]).toMatchObject({ id: "chat-a", state: "sent", handedOver: undefined });
    // Its late answer changes nothing.
    wire.calls[0]?.queue();
    await settled();
    expect(store.get("agent-1")[0]).toMatchObject({ id: "chat-a", state: "sent" });
  });

  it("settles when the message is forgotten while it waits", async () => {
    const { store } = await inFlight();
    const outcome = outcomeOf(store.takeOut("agent-1", "chat-a"));
    store.remove("agent-1", ["chat-a"]);
    await settled();
    expect(outcome.value).toBe("maybe-queued");
  });
});

describe("whenSettled (TR-287)", () => {
  it("resolves once a send in flight is queued", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    await settled();
    let result: string | null = null;
    void store.whenSettled("agent-1", "chat-a").then((value) => (result = value));
    await settled();
    expect(result).toBeNull();
    wire.calls[0]?.queue();
    await settled();
    expect(result).toBe("queued");
  });

  it("resolves at once for one already sent, failed or queued, and gone for one unknown", async () => {
    const store = createPendingSendStore({});
    store.add("agent-1", send("chat-a", "sent"));
    store.add("agent-1", send("chat-b", "failed"));
    store.add("agent-1", send("chat-c", "queued"));
    await expect(store.whenSettled("agent-1", "chat-a")).resolves.toBe("sent");
    await expect(store.whenSettled("agent-1", "chat-b")).resolves.toBe("failed");
    await expect(store.whenSettled("agent-1", "chat-c")).resolves.toBe("queued");
    await expect(store.whenSettled("agent-1", "chat-zzz")).resolves.toBe("gone");
  });

  it("landed before the answer → sent", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    await settled();
    const result = store.whenSettled("agent-1", "chat-a");
    store.update("agent-1", "chat-a", { state: "sent", error: undefined });
    await expect(result).resolves.toBe("sent");
  });

  it("forgotten while waiting → gone", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    await settled();
    const result = store.whenSettled("agent-1", "chat-a");
    store.remove("agent-1", ["chat-a"]);
    await expect(result).resolves.toBe("gone");
  });

  it("resolves failed once the tries run out", async () => {
    const store = createPendingSendStore({}, () => 50, async () => {});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    await settled();
    const result = store.whenSettled("agent-1", "chat-a");
    wire.calls[0]?.settle(new Error("That agent is no longer running."));
    await expect(result).resolves.toBe("failed");
  });
});

describe("sendNow (TR-287)", () => {
  it("marks one in flight for Send now, still sent in order, and settles queued", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    await settled();
    const result = store.sendNow("agent-1", "chat-a");
    expect(store.get("agent-1")[0]).toMatchObject({ handedOver: "send-now", state: "sending" });
    wire.calls[0]?.queue();
    await expect(result).resolves.toBe("queued");
    expect(store.get("agent-1")[0]).toMatchObject({ handedOver: "send-now", state: "queued" });
  });

  it("settles queued at once for one already queued", async () => {
    const store = createPendingSendStore({});
    store.add("agent-1", send("chat-c", "queued"));
    await expect(store.sendNow("agent-1", "chat-c")).resolves.toBe("queued");
    expect(store.get("agent-1")[0]?.handedOver).toBe("send-now");
  });

  it("settles failed for a send that fails, and gone for one unknown", async () => {
    const store = createPendingSendStore({});
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    store.add("agent-1", send("chat-a", "sending"));
    await settled();
    const result = store.sendNow("agent-1", "chat-a");
    wire.calls[0]?.settle(new Error("That agent is no longer running."));
    await expect(result).resolves.toBe("failed");
    await expect(store.sendNow("agent-1", "chat-zzz")).resolves.toBe("gone");
  });
});

describe("reconnect (TR-287)", () => {
  it("seed v4 with an Edit-marked send, create the store and give it the agent → it is not sent; a Send-now mark is cleared", async () => {
    const root = {};
    keptMap<string, unknown>(root, "pending-sends.v4").set("agent-1", [
      { ...send("chat-a", "sending"), handedOver: "edit" },
      { ...send("chat-b", "queued"), queuedAt: 3, handedOver: "send-now" },
      send("chat-c", "sending"),
    ]);
    const store = createPendingSendStore(root);
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    expect(store.get("agent-1").map((each) => [each.id, each.state, each.handedOver])).toEqual([
      ["chat-b", "queued", undefined],
      ["chat-c", "sending", undefined],
    ]);
    await settled();
    expect(wire.ids()).toEqual(["chat-c"]);
  });

  it("leaves a live store's Edit alone when a second store is created on the same root (Taro on two hosts)", async () => {
    const root = {};
    const first = createPendingSendStore(root);
    const wire = manualTransport();
    first.setTransport("agent-1", wire.transport);
    first.add("agent-1", send("chat-a", "sending"));
    await settled();
    let outcome: string | null = null;
    void first.takeOut("agent-1", "chat-a").then((value) => (outcome = value));
    const second = createPendingSendStore(root);
    second.setTransport("agent-2", manualTransport().transport);
    expect(first.get("agent-1")[0]).toMatchObject({ id: "chat-a", handedOver: "edit" });
    wire.calls[0]?.queue();
    await settled();
    expect(outcome).toBe("queued");
  });

  it("cleans an agent's kept sends when a second store takes that agent over, and sends none marked for Edit", async () => {
    const root = {};
    const first = createPendingSendStore(root);
    first.setTransport("agent-1", manualTransport().transport);
    first.add("agent-1", send("chat-a", "sending"));
    await settled();
    void first.takeOut("agent-1", "chat-a");
    const second = createPendingSendStore(root);
    expect(second.get("agent-1").map((each) => each.handedOver)).toEqual(["edit"]);
    const wire = manualTransport();
    second.setTransport("agent-1", wire.transport);
    await settled();
    expect(second.get("agent-1")).toEqual([]);
    expect(wire.ids()).toEqual([]);
    // Taking it again changes nothing more.
    second.setTransport("agent-1", wire.transport);
    expect(second.get("agent-1")).toEqual([]);
  });
});

describe("migrateKeptSends (TR-171, TR-287)", () => {
  it("turns a held message into one to send, which the daemon queues, and keeps the rest as they were", () => {
    const old = [
      { id: "chat-a", text: "a", attachments: [], at: 1, state: "held" },
      { id: "chat-b", text: "b", attachments: [], at: 2, state: "held", heldUntil: 9 },
      { id: "chat-c", text: "c", attachments: [], at: 3, state: "failed", error: "no" },
      { id: "chat-d", text: "d", attachments: [], at: 4, state: "sent" },
    ];
    expect(migrateKeptSends(old)).toEqual([
      { id: "chat-a", text: "a", attachments: [], at: 1, state: "sending" },
      { id: "chat-b", text: "b", attachments: [], at: 2, state: "sending" },
      { id: "chat-c", text: "c", attachments: [], at: 3, state: "failed", error: "no" },
      { id: "chat-d", text: "d", attachments: [], at: 4, state: "sent" },
    ]);
  });

  it("keeps v3's sending, sent and failed messages with their flags", () => {
    const v3 = [
      { id: "chat-a", text: "a", attachments: [], at: 1, state: "sending", sentWhileIdle: true, answersRequest: true },
      { id: "chat-b", text: "b", attachments: [], at: 2, state: "sent", sentWhileIdle: false },
      { id: "chat-c", text: "c", attachments: [], at: 3, state: "failed", error: "no" },
    ];
    expect(migrateKeptSends(v3)).toEqual([
      { id: "chat-a", text: "a", attachments: [], at: 1, state: "sending", sentWhileIdle: true, answersRequest: true },
      { id: "chat-b", text: "b", attachments: [], at: 2, state: "sent", sentWhileIdle: false },
      { id: "chat-c", text: "c", attachments: [], at: 3, state: "failed", error: "no" },
    ]);
  });

  it("drops what is not a message", () => {
    expect(migrateKeptSends([null, 3, { id: "chat-a" }, { id: "chat-b", text: "b", attachments: [], at: 2, state: "lost" }])).toEqual([]);
    expect(migrateKeptSends("not a list")).toEqual([]);
  });

  it("reads the earlier versions' slots once, so messages left by the last bundle are sent, not dropped", async () => {
    const root = {};
    const v2 = keptMap<string, unknown>(root, "pending-sends.v2");
    v2.set("agent-1", [{ id: "chat-a", text: "a", attachments: [], at: 1, state: "held" }, { id: "chat-b", text: "b", attachments: [], at: 2, state: "sent" }]);
    const v3 = keptMap<string, unknown>(root, "pending-sends.v3");
    v3.set("agent-2", [{ id: "chat-c", text: "c", attachments: [], at: 3, state: "sending" }]);
    const store = createPendingSendStore(root);
    expect(states(store)).toEqual(["chat-a:sending", "chat-b:sent"]);
    expect(states(store, "agent-2")).toEqual(["chat-c:sending"]);
    expect(v2.size).toBe(0);
    expect(v3.size).toBe(0);
    const wire = manualTransport();
    store.setTransport("agent-1", wire.transport);
    await settled();
    expect(wire.ids()).toEqual(["chat-a"]);
    // A second store on the same root finds nothing more to move.
    expect(states(createPendingSendStore(root))).toEqual(["chat-a:sending", "chat-b:sent"]);
  });
});
