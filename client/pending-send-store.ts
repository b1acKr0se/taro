/**
 * The messages each chat sent until the agent takes them up (TR-084), per agent. Kept on a
 * `globalThis` slot like the drafts (`draft.ts`): a message on its way outlives a reconnect, though not
 * the app. Bump the slot's version when `PendingSend` changes shape, and read the last one
 * (`migrateKeptSends`). One the daemon queued (the agent works, TR-171) is forgotten on that answer,
 * which its transport gives once the daemon's queue was read again (TR-188): the queue shows it from
 * then on.
 *
 * It also sends them (TR-102): one at a time per agent, in the order sent, so several can be on their
 * way while the user types on, and none overtakes another. The sending outlives the chat that started
 * it (the user switched chat, or left the screen); a message still sending when the bundles were
 * evaluated again (a reconnect, a plugin reload) goes again, under its own id, once a chat or the
 * screen gives the agent a transport, and the plugin skips one Paseo already has (`server/send.ts`).
 */
import { failureReason, isPassingFailure, nextToSend, SEND_RETRY_DELAYS_MS, type PendingSend } from "../shared/pending-sends";
import { keptMap } from "./kept";

/** Hands a message to the plugin; resolves once Paseo has it, or the daemon queued it (`queued`). */
export type SendTransport = (send: PendingSend) => Promise<{ queued: boolean }>;

export interface PendingSendStore {
  get(agentId: string): readonly PendingSend[];
  add(agentId: string, send: PendingSend): void;
  update(agentId: string, id: string, change: Partial<PendingSend>): void;
  remove(agentId: string, ids: readonly string[]): void;
  /** Replaces a message with a new one of the same words and attachments, to send; null when it is gone. */
  resend(agentId: string, id: string, again: { id: string; at: number }): PendingSend | null;
  /** Sends a failed message again under its own id, and those waiting behind it after it. */
  retry(agentId: string, id: string): void;
  /** How the agent's messages reach Paseo, the latest given; sends what waits for one. */
  setTransport(agentId: string, transport: SendTransport): void;
  /** Called after every change, so a chat hears one made while it was unmounted. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

const NONE: readonly PendingSend[] = [];

/** The slot's current name, and the last version's (TR-171 dropped "held" and `heldUntil`). */
const SLOT = "pending-sends.v3";
const LAST_SLOT = "pending-sends.v2";

/**
 * The last version's messages as this one keeps them: one held for the turn end is sent now, and the
 * daemon queues it if the agent still works; anything not shaped as a message is dropped.
 */
export function migrateKeptSends(old: unknown): PendingSend[] {
  if (!Array.isArray(old)) return [];
  return old.flatMap((each: unknown): PendingSend[] => {
    if (each === null || typeof each !== "object") return [];
    const { id, text, attachments, at, state, error } = each as Record<string, unknown>;
    if (typeof id !== "string" || typeof text !== "string" || !Array.isArray(attachments) || typeof at !== "number") return [];
    if (state === "held") return [{ id, text, attachments, at, state: "sending" }];
    if (state !== "sending" && state !== "sent" && state !== "failed") return [];
    return [typeof error === "string" ? { id, text, attachments, at, state, error } : { id, text, attachments, at, state }];
  });
}

export function createPendingSendStore(
  root: object,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): PendingSendStore {
  const sends = keptMap<string, readonly PendingSend[]>(root, SLOT);
  const last = keptMap<string, unknown>(root, LAST_SLOT);
  last.forEach((old, agentId) => {
    const moved = migrateKeptSends(old);
    if (moved.length > 0) sends.set(agentId, [...(sends.get(agentId) ?? NONE), ...moved]);
  });
  last.clear();
  const listeners = new Set<() => void>();
  // Not kept: a fresh bundle starts with no transport and no send under way.
  const transports = new Map<string, SendTransport>();
  const draining = new Set<string>();
  // Which store sends each agent's messages: the last given its transport. The last bundle's loop may
  // still await a dead connection after a reconnect; it stops rather than mark what this one sends.
  // Per agent, not per store: Taro on two hosts runs two bundles at once, each with its own agents.
  const owners = keptMap<string, object>(root, "pending-sends.owners");
  const self = {};
  const owns = (agentId: string) => owners.get(agentId) === self;
  function put(agentId: string, next: readonly PendingSend[]): void {
    if (next.length === 0) sends.delete(agentId);
    else sends.set(agentId, next);
    listeners.forEach((listener) => listener());
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
        try {
          const answer = await sendWithRetries(agentId, next);
          if (!owns(agentId)) return;
          // Queued on the daemon: its row above the composer shows it, not a mark here.
          if (answer?.queued === true) forget(agentId, [next.id]);
          else update(agentId, next.id, (send) => (send.state === "sending" ? { state: "sent", at: now() } : null));
        } catch (error) {
          if (!owns(agentId)) return;
          // Seen in the timeline meanwhile, it was marked sent: the answer, not the message, was lost.
          update(agentId, next.id, (send) => (send.state === "sending" ? { state: "failed", error: failureReason(error) } : null));
        }
        // Marked sent or failed while it was on its way, or neither (forgotten): either way, on to the next.
        if ((sends.get(agentId) ?? NONE).some((send) => send.id === next.id && send.state === "sending")) return;
      }
    } finally {
      draining.delete(agentId);
    }
  }
  /**
   * Sends one message, trying again after a failure that passes, with the latest transport, while it is
   * still to send; the plugin's answer, or null when it stopped trying.
   */
  async function sendWithRetries(agentId: string, pending: PendingSend): Promise<{ queued: boolean } | null> {
    for (let attempt = 0; ; attempt += 1) {
      const transport = transports.get(agentId);
      if (transport === undefined) throw new Error("Not connected");
      try {
        return await transport(pending);
      } catch (error) {
        const delay = SEND_RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !isPassingFailure(error)) throw error;
        await wait(delay);
        if (!owns(agentId)) return null;
        const still = (sends.get(agentId) ?? NONE).find((send) => send.id === pending.id);
        if (still?.state !== "sending") return null;
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
      const next: PendingSend = { ...old, id: again.id, at: again.at, state: "sending", error: undefined };
      put(agentId, [...current.filter((send) => send.id !== id), next]);
      startSending(agentId);
      return next;
    },
    retry: (agentId, id) => {
      update(agentId, id, (send) => (send.state === "failed" ? { state: "sending", error: undefined, at: now() } : null));
      startSending(agentId);
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
