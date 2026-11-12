/**
 * The picks on a card asking several questions (TR-207), not sent yet, per decision key: kept on
 * `globalThis` (`./kept`), so a reconnect that evaluates the bundle again keeps them, and shared by
 * every card of the same decision, so a pill picked on the board shows ticked in the chat.
 */
import { useEffect, useState } from "react";

import { keepDrafts, keptDrafts, type KeptDrafts, type SeveralDrafts } from "../shared/several-questions";
import type { DecisionQuestion } from "../shared/reports";
import { keptMap } from "./kept";

/** Versioned: a later shape of KeptDrafts takes a new slot rather than reading this one (v2 added `shape`). */
const store = keptMap<string, KeptDrafts>(globalThis, "severalAnswers.v2");
const listeners = new Set<() => void>();

function changed(): void {
  listeners.forEach((listener) => listener());
}

/** The decision's kept picks, a setter, and `forget` for when it is sent. */
export function useSeveralDrafts(decision: { key: string; status: string; questions: readonly DecisionQuestion[] }): {
  state: SeveralDrafts;
  update: (change: (state: SeveralDrafts) => SeveralDrafts) => void;
  forget: () => void;
} {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((version) => version + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const state = keptDrafts(store, decision);
  return {
    state,
    update: (change) => {
      // Read again, not the render's copy: two picks in one frame must both stay.
      keepDrafts(store, decision, change(keptDrafts(store, decision)));
      changed();
    },
    forget: () => {
      store.delete(decision.key);
      changed();
    },
  };
}

/** Drops a settled decision's picks (its card shows what became of it instead). */
export function forgetSeveralDrafts(key: string): void {
  if (store.delete(key)) changed();
}
