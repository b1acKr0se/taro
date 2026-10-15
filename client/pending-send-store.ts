/**
 * The messages each chat sent or holds until the agent takes them up (TR-084), per agent. Kept on a
 * `globalThis` slot like the drafts (`draft.ts`): a held message outlives a reconnect, though not the
 * app. Bump the slot's version when `PendingSend` changes shape.
 *
 * It also sends them (TR-102): one at a time per agent, in the order sent, so several can be on their
 * way while the user types on, and none overtakes another. The sending outlives the chat that started
 * it (the user switched chat, or left the screen); a message still sending when the bundles were
 * evaluated again (a reconnect, a plugin reload) goes again, under its own id, once a chat or the
 * screen gives the agent a transport, and the plugin skips one Paseo already has (`server/send.ts`).
 */
import { failureReason, isCompactingRefusal, isPassingFailure, isWorking, nextToSend, SEND_RETRY_DELAYS_MS, type PendingSend } from "../shared/pending-sends";
import { keptMap } from "./kept";

/** Hands a message to Paseo; resolves once Paseo has it. */
export type SendTransport = (send: PendingSend) => Promise<void>;

export interface PendingSendStore {
  get(agentId: string): readonly PendingSend[];
  add(agentId: string, send: PendingSend): void;
  update(agentId: string, id: string, change: Partial<PendingSend>): void;
  remove(agentId: string, ids: readonly string[]): void;
  /** The agents with a message here. */
  agentIds(): string[];
  /**
   * Marks these messages sending, of those still held, in one change and returns them in order: a chat
   * and the screen releasing at once send each once, in order. Sends them when the agent has a transport.
   */
  claim(agentId: string, ids: readonly string[], now: number): PendingSend[];
  /** Replaces a message with a new one of the same words and attachments, held or sending; null when it is gone. */
  resend(agentId: string, id: string, again: { id: string; at: number; holds: boolean }): PendingSend | null;
  /** Sends a failed message again under its own id, and those waiting behind it after it. */
  retry(agentId: string, id: string): void;
  /** How the agent's messages reach Paseo, the latest given; sends what waits for one. */
  setTransport(agentId: string, transport: SendTransport): void;
  /** Called after every change, so a chat hears one made while it was unmounted. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

const NONE: readonly PendingSend[] = [];

export function createPendingSendStore(
  root: object,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): PendingSendStore {
  const sends = keptMap<string, readonly PendingSend[]>(root, "pending-sends.v2");
  const listeners = new Set<() => void>();
  // Not kept: a fresh bundle starts with no transport and no send under way.
  const transports = new Map<string, SendTransport>();
  const draining = new Set<string>();
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
        if (transport === undefined || next === null) return;
        try {
          await sendWithRetries(agentId, next);
          update(agentId, next.id, (send) => (send.state === "sending" ? { state: "sent", at: now() } : null));
        } catch (error) {
          // Seen in the timeline meanwhile, it was marked sent: the answer, not the message, was lost.
          // Handed back as the agent compacts, it is held until the compaction ends, as the chat holds one sent then.
          const after: Partial<PendingSend> = isCompactingRefusal(error) ? { state: "held", at: now() } : { state: "failed", error: failureReason(error) };
          update(agentId, next.id, (send) => (send.state === "sending" ? after : null));
        }
        // Marked sent or failed while it was on its way, or neither (forgotten): either way, on to the next.
        if ((sends.get(agentId) ?? NONE).some((send) => send.id === next.id && send.state === "sending")) return;
      }
    } finally {
      draining.delete(agentId);
    }
  }
  /** Sends one message, trying again after a failure that passes, with the latest transport, while it is still to send. */
  async function sendWithRetries(agentId: string, pending: PendingSend): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const transport = transports.get(agentId);
      if (transport === undefined) throw new Error("Not connected");
      try {
        return await transport(pending);
      } catch (error) {
        const delay = SEND_RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !isPassingFailure(error)) throw error;
        await wait(delay);
        const still = (sends.get(agentId) ?? NONE).find((send) => send.id === pending.id);
        if (still?.state !== "sending") return;
      }
    }
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
      const current = sends.get(agentId) ?? NONE;
      if (!current.some((send) => ids.includes(send.id))) return;
      put(agentId, current.filter((send) => !ids.includes(send.id)));
      // A failed message taken back no longer holds up those after it.
      startSending(agentId);
    },
    agentIds: () => [...sends.keys()],
    claim: (agentId, ids, now) => {
      const current = sends.get(agentId) ?? NONE;
      const claimed = current.filter((send) => send.state === "held" && ids.includes(send.id)).map((send): PendingSend => ({ ...send, state: "sending", at: now }));
      if (claimed.length === 0) return [];
      put(agentId, current.map((send) => claimed.find((each) => each.id === send.id) ?? send));
      startSending(agentId);
      return claimed;
    },
    resend: (agentId, id, again) => {
      const current = sends.get(agentId) ?? NONE;
      const old = current.find((send) => send.id === id);
      if (old === undefined) return null;
      const next: PendingSend = { ...old, id: again.id, at: again.at, state: again.holds ? "held" : "sending", error: undefined };
      put(agentId, [...current.filter((send) => send.id !== id), next]);
      if (next.state === "sending") startSending(agentId);
      return next;
    },
    retry: (agentId, id) => {
      update(agentId, id, (send) => (send.state === "failed" ? { state: "sending", error: undefined, at: now() } : null));
      startSending(agentId);
    },
    setTransport: (agentId, transport) => {
      transports.set(agentId, transport);
      startSending(agentId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const pendingSends = createPendingSendStore(globalThis);

/**
 * Sends the held messages of each agent seen stopped, oldest first (`claim`). An agent's status counts
 * only when it was read after the message was held (`updatedAt`, ms): a status read before is from the
 * turn the message waits for, or older. An agent not in `agents` keeps its own.
 */
export function releaseHeld(store: PendingSendStore, agents: ReadonlyMap<string, { status: string; updatedAt: number }>, now: number): void {
  store.agentIds().forEach((agentId) => {
    const agent = agents.get(agentId);
    if (agent === undefined || isWorking(agent.status)) return;
    const due = store.get(agentId).filter((send) => send.state === "held" && send.at <= agent.updatedAt);
    if (due.length === 0) return;
    store.claim(agentId, due.map((send) => send.id), now);
  });
}
