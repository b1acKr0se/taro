/**
 * The messages each chat sent or holds until the agent takes them up (TR-084), per agent. Kept on a
 * `globalThis` slot like the drafts (`draft.ts`): a held message outlives a reconnect, though not the
 * app. Bump the slot's version when `PendingSend` changes shape.
 */
import { isWorking, type PendingSend } from "../shared/pending-sends";
import { keptMap } from "./kept";

export interface PendingSendStore {
  get(agentId: string): readonly PendingSend[];
  add(agentId: string, send: PendingSend): void;
  update(agentId: string, id: string, change: Partial<PendingSend>): void;
  remove(agentId: string, ids: readonly string[]): void;
  /** The agents with a message here. */
  agentIds(): string[];
  /**
   * Marks these messages sent, of those still held, in one change and returns them in order: whoever
   * claims a message sends it, so a chat and the screen releasing at once send it once, in order.
   */
  claim(agentId: string, ids: readonly string[], now: number): PendingSend[];
  /** Replaces a message with a new one of the same words and attachments, held or sent; null when it is gone. */
  resend(agentId: string, id: string, again: { id: string; at: number; holds: boolean }): PendingSend | null;
  /** Called after every change, so a chat hears one made while it was unmounted. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

const NONE: readonly PendingSend[] = [];

export function createPendingSendStore(root: object): PendingSendStore {
  const sends = keptMap<string, readonly PendingSend[]>(root, "pending-sends.v1");
  const listeners = new Set<() => void>();
  function put(agentId: string, next: readonly PendingSend[]): void {
    if (next.length === 0) sends.delete(agentId);
    else sends.set(agentId, next);
    listeners.forEach((listener) => listener());
  }
  return {
    get: (agentId) => sends.get(agentId) ?? NONE,
    add: (agentId, send) => put(agentId, [...(sends.get(agentId) ?? NONE), send]),
    update: (agentId, id, change) => put(agentId, (sends.get(agentId) ?? NONE).map((send) => (send.id === id ? { ...send, ...change } : send))),
    remove: (agentId, ids) => {
      const current = sends.get(agentId) ?? NONE;
      if (!current.some((send) => ids.includes(send.id))) return;
      put(agentId, current.filter((send) => !ids.includes(send.id)));
    },
    agentIds: () => [...sends.keys()],
    claim: (agentId, ids, now) => {
      const current = sends.get(agentId) ?? NONE;
      const claimed = current.filter((send) => send.state === "held" && ids.includes(send.id)).map((send): PendingSend => ({ ...send, state: "sent", at: now }));
      if (claimed.length === 0) return [];
      put(agentId, current.map((send) => claimed.find((each) => each.id === send.id) ?? send));
      return claimed;
    },
    resend: (agentId, id, again) => {
      const current = sends.get(agentId) ?? NONE;
      const old = current.find((send) => send.id === id);
      if (old === undefined) return null;
      const next: PendingSend = { ...old, id: again.id, at: again.at, state: again.holds ? "held" : "sent" };
      put(agentId, [...current.filter((send) => send.id !== id), next]);
      return next;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const pendingSends = createPendingSendStore(globalThis);

/**
 * Sends the held messages of each agent seen stopped, oldest first, through `deliver`. An agent's
 * status counts only when it was read after the message was held (`updatedAt`, ms): a status read
 * before is from the turn the message waits for, or older. An agent not in `agents` keeps its own.
 */
export function releaseHeld(
  store: PendingSendStore,
  agents: ReadonlyMap<string, { status: string; updatedAt: number }>,
  deliver: (agentId: string, send: PendingSend) => void,
  now: number,
): void {
  store.agentIds().forEach((agentId) => {
    const agent = agents.get(agentId);
    if (agent === undefined || isWorking(agent.status)) return;
    const due = store.get(agentId).filter((send) => send.state === "held" && send.at <= agent.updatedAt);
    if (due.length === 0) return;
    store.claim(agentId, due.map((send) => send.id), now).forEach((sent) => deliver(agentId, sent));
  });
}
