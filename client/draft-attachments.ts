/**
 * The attachments waiting in each agent's composer (TR-036), kept like the words beside them
 * (`draft.ts`): on a `globalThis` slot, so they outlast the app re-evaluating the bundle, and with
 * listeners, so a failed send can put them back after its chat was unmounted.
 */
import type { DraftAttachment } from "../shared/attachments";

export interface AttachmentDraftStore {
  get(key: string): readonly DraftAttachment[];
  /** An empty list is forgotten rather than kept. */
  set(key: string, attachments: readonly DraftAttachment[]): void;
  subscribe(listener: () => void): () => void;
}

const SLOT = Symbol.for("paseo.taro.draft-attachments");
const NONE: readonly DraftAttachment[] = [];

export function createAttachmentDraftStore(root: object): AttachmentDraftStore {
  let kept = Reflect.get(root, SLOT) as Map<string, readonly DraftAttachment[]> | undefined;
  if (!(kept instanceof Map)) {
    kept = new Map<string, readonly DraftAttachment[]>();
    Reflect.set(root, SLOT, kept);
  }
  const store = kept;
  const listeners = new Set<() => void>();
  return {
    get: (key) => store.get(key) ?? NONE,
    set: (key, attachments) => {
      if (attachments.length === 0) store.delete(key);
      else store.set(key, attachments);
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const draftAttachments = createAttachmentDraftStore(globalThis);
