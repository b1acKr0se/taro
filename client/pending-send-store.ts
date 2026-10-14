/**
 * The messages each chat sent or holds until the agent takes them up (TR-084), per agent. Kept on a
 * `globalThis` slot like the drafts (`draft.ts`): a held message outlives a reconnect, though not the
 * app. Bump the slot's version when `PendingSend` changes shape.
 */
import type { PendingSend } from "../shared/pending-sends";
import { keptMap } from "./kept";

export interface PendingSendStore {
  get(agentId: string): readonly PendingSend[];
  add(agentId: string, send: PendingSend): void;
  update(agentId: string, id: string, change: Partial<PendingSend>): void;
  remove(agentId: string, ids: readonly string[]): void;
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
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const pendingSends = createPendingSendStore(globalThis);
