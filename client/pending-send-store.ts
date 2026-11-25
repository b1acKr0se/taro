/**
 * The messages each chat sent until the agent takes them up (TR-084), per agent. Kept on a
 * `globalThis` slot like the drafts (`draft.ts`): a message on its way outlives a reconnect, though not
 * the app. Bump the slot's version when `PendingSend` changes shape, and read the last ones
 * (`migrateKeptSends`). One the daemon queued (the agent works, TR-171) is kept, marked "queued", until
 * the timeline shows it or it is known gone (`settleQueued`): its row stays one row, drawn finished at once.
 *
 * It also sends them (TR-102): one at a time per agent, in the order sent, so several can be on their
 * way while the user types on, and none overtakes another. The sending outlives the chat that started
 * it (the user switched chat, or left the screen); a message still sending when the bundles were
 * evaluated again (a reconnect, a plugin reload) goes again, under its own id, once a chat or the
 * screen gives the agent a transport, and the plugin skips one Paseo already has (`server/send.ts`).
 *
 * Edit and Send now on a message it holds act at once (`takeOut`, `sendNow`): one still on its way is
 * marked, and what the chat does next waits behind the scenes for its send to answer.
 */
import { isPassingFailure, failureReason, nextToSend, SEND_RETRY_DELAYS_MS, type PendingSend } from "../shared/pending-sends";
import { keptMap } from "./kept";

/** Hands a message to the plugin; resolves once Paseo has it, or the daemon queued it (`queued`). */
export type SendTransport = (send: PendingSend) => Promise<{ queued: boolean }>;

/**
 * What became of a message Edit took out of the store: "never-sent" (the plugin never had it),
 * "queued" (the daemon holds it), "sent" (Paseo has it), "maybe-queued" (its send went unanswered, so
 * the daemon may hold it).
 */
export type TakeOutcome = "never-sent" | "queued" | "sent" | "maybe-queued";

/** Where a message stands once it is no longer on its way; "gone" when the store no longer holds it. */
export type SendSettled = "queued" | "sent" | "failed" | "gone";

export interface PendingSendStore {
  get(agentId: string): readonly PendingSend[];
  add(agentId: string, send: PendingSend): void;
  update(agentId: string, id: string, change: Partial<PendingSend>): void;
  remove(agentId: string, ids: readonly string[]): void;
  /** Replaces a message with a new one of the same words and attachments, to send; null when it is gone. */
  resend(agentId: string, id: string, again: { id: string; at: number; sentWhileIdle?: boolean }): PendingSend | null;
  /** Sends a failed message again under its own id, and those waiting behind it after it. */
  retry(agentId: string, id: string): void;
  /**
   * Edit on a message this store holds: taken out at once when the plugin never had it, else marked and
   * taken out once its send answers; resolves with what the chat must still undo on the daemon.
   */
  takeOut(agentId: string, id: string): Promise<TakeOutcome>;
  /** Resolves once the message is no longer on its way: at once when it is not, "gone" when forgotten. */
  whenSettled(agentId: string, id: string): Promise<SendSettled>;
  /** Send now on a message this store holds: drawn as the transcript's echo, still sent in order; resolves as `whenSettled`. */
  sendNow(agentId: string, id: string): Promise<SendSettled>;
  /** How the agent's messages reach Paseo, the latest given; sends what waits for one. */
  setTransport(agentId: string, transport: SendTransport): void;
  /** Called after every change, so a chat hears one made while it was unmounted. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

const NONE: readonly PendingSend[] = [];

/** The slot's current name, and the earlier versions' (v3 had no "queued"; v2 had "held", dropped by TR-171). */
const SLOT = "pending-sends.v4";
const EARLIER_SLOTS: readonly string[] = ["pending-sends.v3", "pending-sends.v2"];

/**
 * An earlier version's messages as this one keeps them: one held for the turn end is sent now, and the
 * daemon queues it if the agent still works; anything not shaped as a message is dropped.
 */
export function migrateKeptSends(old: unknown): PendingSend[] {
  if (!Array.isArray(old)) return [];
  return old.flatMap((each: unknown): PendingSend[] => {
    if (each === null || typeof each !== "object") return [];
    const { id, text, attachments, at, state, error, answersRequest, sentWhileIdle } = each as Record<string, unknown>;
    if (typeof id !== "string" || typeof text !== "string" || !Array.isArray(attachments) || typeof at !== "number") return [];
    const flags = { ...(answersRequest === true ? { answersRequest: true } : {}), ...(typeof sentWhileIdle === "boolean" ? { sentWhileIdle } : {}) };
    if (state === "held") return [{ id, text, attachments, at, state: "sending", ...flags }];
    if (state !== "sending" && state !== "sent" && state !== "failed") return [];
    return [typeof error === "string" ? { id, text, attachments, at, state, error, ...flags } : { id, text, attachments, at, state, ...flags }];
  });
}

/**
 * The kept messages as a new bundle starts them: one marked for Edit is in the box and never sent again;
 * one marked for Send now is drawn as a queue row again, as its call's answer was lost with the bundle.
 */
function afterReload(kept: readonly PendingSend[]): PendingSend[] {
  return kept.flatMap((send) => (send.handedOver === "edit" ? [] : send.handedOver === "send-now" ? [{ ...send, handedOver: undefined }] : [send]));
}

/**
 * One send's end, as the sending loop reads it. `mayHaveLanded`: a try failed in passing, so the daemon
 * may hold it; "moot": no longer to send (taken back, or found in the timeline); "stopped": another store
 * sends the agent's messages now.
 */
type Attempt = { kind: "answer"; queued: boolean } | { kind: "failed"; error: unknown; mayHaveLanded: boolean } | { kind: "moot" } | { kind: "stopped" };

export function createPendingSendStore(
  root: object,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): PendingSendStore {
  const sends = keptMap<string, readonly PendingSend[]>(root, SLOT);
  sends.forEach((kept, agentId) => {
    const cleaned = afterReload(kept);
    if (cleaned.length === 0) sends.delete(agentId);
    else sends.set(agentId, cleaned);
  });
  EARLIER_SLOTS.forEach((slot) => {
    const earlier = keptMap<string, unknown>(root, slot);
    earlier.forEach((old, agentId) => {
      const moved = migrateKeptSends(old);
      if (moved.length > 0) sends.set(agentId, [...(sends.get(agentId) ?? NONE), ...moved]);
    });
    earlier.clear();
  });
  const listeners = new Set<() => void>();
  // Not kept: a fresh bundle starts with no transport and no send under way.
  const transports = new Map<string, SendTransport>();
  const draining = new Set<string>();
  // The message each agent's loop is sending now, retry waits included: Edit on it waits for its answer.
  const inFlight = new Map<string, string>();
  // Per agent, checks run after every change of its list until each says it is done (`takeOut`, `whenSettled`).
  const waiters = new Map<string, Set<() => boolean>>();
  // What the loop found of a send marked for Edit that it took out itself, for that Edit's wait.
  const takenOutcomes = new Map<string, TakeOutcome>();
  // Which store sends each agent's messages: the last given its transport. The last bundle's loop may
  // still await a dead connection after a reconnect; it stops rather than mark what this one sends.
  // Per agent, not per store: Taro on two hosts runs two bundles at once, each with its own agents.
  const owners = keptMap<string, object>(root, "pending-sends.owners");
  const self = {};
  const owns = (agentId: string) => owners.get(agentId) === self;
  const outcomeKey = (agentId: string, id: string) => `${agentId}\n${id}`;
  function find(agentId: string, id: string): PendingSend | undefined {
    return (sends.get(agentId) ?? NONE).find((send) => send.id === id);
  }
  function put(agentId: string, next: readonly PendingSend[]): void {
    if (next.length === 0) sends.delete(agentId);
    else sends.set(agentId, next);
    listeners.forEach((listener) => listener());
    checkWaiters(agentId);
  }
  function checkWaiters(agentId: string): void {
    const checks = waiters.get(agentId);
    if (checks === undefined) return;
    [...checks].forEach((check) => {
      // Out of the set while it runs: one that changes the list (Edit's take-out) is not run again inside its own change.
      if (!checks.delete(check)) return;
      if (!check()) checks.add(check);
    });
    if (checks.size === 0) waiters.delete(agentId);
  }
  function waitFor(agentId: string, check: () => boolean): void {
    if (check()) return;
    const checks = waiters.get(agentId) ?? new Set<() => boolean>();
    checks.add(check);
    waiters.set(agentId, checks);
  }
  function update(agentId: string, id: string, change: (send: PendingSend) => Partial<PendingSend> | null): void {
    const current = sends.get(agentId) ?? NONE;
    let changed = false;
    const next = current.map((send) => {
      const patch = send.id === id ? change(send) : null;
      if (patch === null) return send;
      changed = true;
      return { ...send, ...patch };
    });
    if (changed) put(agentId, next);
  }
  /** Sends the agent's messages one after another until none is ready, or a send fails. */
  async function drain(agentId: string): Promise<void> {
    if (draining.has(agentId)) return;
    draining.add(agentId);
    try {
      for (;;) {
        const transport = transports.get(agentId);
        const next = nextToSend(sends.get(agentId) ?? NONE);
        if (transport === undefined || next === null || !owns(agentId)) return;
        inFlight.set(agentId, next.id);
        let attempt: Attempt;
        try {
          attempt = await sendWithRetries(agentId, next);
        } finally {
          if (inFlight.get(agentId) === next.id) inFlight.delete(agentId);
        }
        if (!owns(agentId) || attempt.kind === "stopped") return;
        // "moot" (taken back, or found in the timeline while it waited to try again) changes nothing: on to the next.
        if (attempt.kind === "answer") {
          // Queued on the daemon: kept, so its row stays one row until the timeline has it (`settleQueued`).
          const answer = attempt;
          update(agentId, next.id, (send) => (send.state !== "sending" ? null : answer.queued ? { state: "queued", queuedAt: now() } : { state: "sent", at: now() }));
        } else if (attempt.kind === "failed") {
          const still = find(agentId, next.id);
          if (still?.state === "sending" && still.handedOver === "edit") {
            // In the box now: never Not sent, never tried again. The daemon may hold it after a try that failed in passing.
            takenOutcomes.set(outcomeKey(agentId, next.id), attempt.mayHaveLanded || isPassingFailure(attempt.error) ? "maybe-queued" : "never-sent");
            forget(agentId, [next.id]);
          } else {
            const reason = failureReason(attempt.error);
            // Seen in the timeline meanwhile, it was marked sent: the answer, not the message, was lost.
            update(agentId, next.id, (send) => (send.state === "sending" ? { state: "failed", error: reason } : null));
          }
        }
        // Marked sent or failed while it was on its way, or neither (forgotten): either way, on to the next.
        if (find(agentId, next.id)?.state === "sending") return;
      }
    } finally {
      draining.delete(agentId);
    }
  }
  /**
   * Sends one message, trying again after a failure that passes, with the latest transport, while it is
   * still to send and not marked for Edit.
   */
  async function sendWithRetries(agentId: string, pending: PendingSend): Promise<Attempt> {
    let mayHaveLanded = false;
    for (let attempt = 0; ; attempt += 1) {
      const transport = transports.get(agentId);
      if (transport === undefined) return { kind: "failed", error: new Error("Not connected"), mayHaveLanded };
      try {
        const answer = await transport(pending);
        return { kind: "answer", queued: answer.queued };
      } catch (error) {
        const passing = isPassingFailure(error);
        mayHaveLanded = mayHaveLanded || passing;
        const delay = SEND_RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !passing || find(agentId, pending.id)?.handedOver === "edit") return { kind: "failed", error, mayHaveLanded };
        await wait(delay);
        if (!owns(agentId)) return { kind: "stopped" };
        const still = find(agentId, pending.id);
        if (still?.state !== "sending") return { kind: "moot" };
        if (still.handedOver === "edit") return { kind: "failed", error, mayHaveLanded };
      }
    }
  }
  function forget(agentId: string, ids: readonly string[]): void {
    const current = sends.get(agentId) ?? NONE;
    if (current.some((send) => ids.includes(send.id))) put(agentId, current.filter((send) => !ids.includes(send.id)));
  }
  function startSending(agentId: string): void {
    void drain(agentId);
  }
  function whenSettled(agentId: string, id: string): Promise<SendSettled> {
    return new Promise((resolve) =>
      waitFor(agentId, () => {
        const send = find(agentId, id);
        if (send === undefined) resolve("gone");
        else if (send.state === "sending") return false;
        else resolve(send.state);
        return true;
      }),
    );
  }
  /** Edit's wait on a message marked while on its way: taken out as its send answers, or as the timeline shows it. */
  function takenOnceSettled(agentId: string, id: string): Promise<TakeOutcome> {
    return new Promise((resolve) =>
      waitFor(agentId, () => {
        const key = outcomeKey(agentId, id);
        const found = takenOutcomes.get(key);
        if (found !== undefined) {
          takenOutcomes.delete(key);
          resolve(found);
          return true;
        }
        const send = find(agentId, id);
        if (send?.state === "sending") return false;
        if (send === undefined) resolve("maybe-queued");
        else if (send.state === "sent") {
          // Paseo has it: kept, so the transcript shows it until the timeline does.
          update(agentId, id, () => ({ handedOver: undefined }));
          resolve("sent");
        } else {
          forget(agentId, [id]);
          resolve(send.state === "queued" ? "queued" : "maybe-queued");
        }
        return true;
      }),
    );
  }
  return {
    get: (agentId) => sends.get(agentId) ?? NONE,
    add: (agentId, send) => {
      put(agentId, [...(sends.get(agentId) ?? NONE), send]);
      if (send.state === "sending") startSending(agentId);
    },
    update: (agentId, id, change) => {
      update(agentId, id, () => change);
      // A failed message found in the timeline after all no longer holds up those after it.
      startSending(agentId);
    },
    remove: (agentId, ids) => {
      if (!(sends.get(agentId) ?? NONE).some((send) => ids.includes(send.id))) return;
      forget(agentId, ids);
      // A failed message taken back no longer holds up those after it.
      startSending(agentId);
    },
    resend: (agentId, id, again) => {
      const current = sends.get(agentId) ?? NONE;
      const old = current.find((send) => send.id === id);
      if (old === undefined) return null;
      const next: PendingSend = { ...old, id: again.id, at: again.at, state: "sending", error: undefined, sentWhileIdle: again.sentWhileIdle };
      put(agentId, [...current.filter((send) => send.id !== id), next]);
      startSending(agentId);
      return next;
    },
    retry: (agentId, id) => {
      update(agentId, id, (send) => (send.state === "failed" ? { state: "sending", error: undefined, at: now() } : null));
      startSending(agentId);
    },
    takeOut: (agentId, id) => {
      const send = find(agentId, id);
      // Gone already (read, or forgotten): the daemon may still list it, so the chat removes it there.
      if (send === undefined) return Promise.resolve("maybe-queued");
      if (send.state === "sent") return Promise.resolve("sent");
      if (send.state === "sending" && inFlight.get(agentId) === id) {
        update(agentId, id, () => ({ handedOver: "edit" }));
        return takenOnceSettled(agentId, id);
      }
      forget(agentId, [id]);
      startSending(agentId);
      // Waiting its turn, it never reached the plugin; a failed one may have, after a try that failed in passing.
      return Promise.resolve(send.state === "queued" ? "queued" : send.state === "failed" ? "maybe-queued" : "never-sent");
    },
    whenSettled,
    sendNow: (agentId, id) => {
      const send = find(agentId, id);
      if (send?.state === "sending" || send?.state === "queued") update(agentId, id, () => ({ handedOver: "send-now" }));
      return whenSettled(agentId, id);
    },
    setTransport: (agentId, transport) => {
      transports.set(agentId, transport);
      owners.set(agentId, self);
      startSending(agentId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const pendingSends = createPendingSendStore(globalThis);
