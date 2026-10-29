/**
 * One press guard per call shown on several surfaces at once (TR-191): a ticket's acceptance sits on the
 * Needs you card, in the owner's chat and in the composer's row, a decision on the card, in the chat and
 * in the Ticket tab. Each surface's buttons for that call read the same guard, so a press on one makes
 * the others busy too, instead of leaving them live until the next poll. Pure.
 */

import { createPressGuard, type PressGuard, type PressGuardOptions, type PressShown } from "./press-guard";

export interface SharedPresses {
  /** The call's guard, made when first asked for. */
  guardFor(call: string): PressGuard;
  /** The call's pressed button now; null when idle. */
  shown(call: string): PressShown | null;
  /** Told each time the call's pressed button changes; returns the unsubscribe. */
  subscribe(call: string, listener: (shown: PressShown | null) => void): () => void;
  /** Calls with a guard kept, for tests. */
  size(): number;
}

interface Entry {
  guard: PressGuard;
  listeners: Set<(shown: PressShown | null) => void>;
}

export function createSharedPresses(options: Omit<PressGuardOptions, "onChange"> = {}): SharedPresses {
  const entries = new Map<string, Entry>();

  // A guard nobody shows and nothing holds is dropped; one holding after its surface left (an Accept whose card
  // went) stays until it settles, so a surface opened meanwhile still sees it busy.
  function prune(call: string): void {
    const entry = entries.get(call);
    if (entry === undefined || entry.listeners.size > 0 || entry.guard.locked() || entry.guard.shown() !== null) return;
    entry.guard.dispose();
    entries.delete(call);
  }

  function entryFor(call: string): Entry {
    const known = entries.get(call);
    if (known !== undefined) return known;
    const listeners = new Set<(shown: PressShown | null) => void>();
    const guard = createPressGuard({
      ...options,
      onChange: (shown) => {
        listeners.forEach((listener) => listener(shown));
        if (shown === null) prune(call);
      },
    });
    const made = { guard, listeners };
    entries.set(call, made);
    return made;
  }

  return {
    guardFor: (call) => entryFor(call).guard,
    shown: (call) => entries.get(call)?.guard.shown() ?? null,
    subscribe(call, listener) {
      const entry = entryFor(call);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
        prune(call);
      };
    },
    size: () => entries.size,
  };
}

/** The call a ticket's Accept and Request changes answer. */
export function acceptanceCall(project: string, ticket: string): string {
  return `acceptance:${project}/${ticket}`;
}

/**
 * The call a decision's buttons answer: one asking of it. An owner asking again reuses the key in a later turn,
 * and that asking starts idle rather than inheriting the last answer's hold.
 */
export function decisionCall(decision: { key: string; turn: string | null }): string {
  return `decision:${decision.key}@${decision.turn ?? ""}`;
}

/** The press key of a decision's option, the same on every surface so the pressed one spins on each. */
export function optionPress(label: string): string {
  return `option:${label}`;
}

/**
 * The look of a decision's Submit: its own press spins. While another surface answers the decision it spins
 * too, as nothing is picked here to spin instead (TR-191). A press on Dismiss leaves it greyed, not spinning
 * (TR-240): Dismiss spins alone.
 */
export function submitLook(own: "busy" | "done" | undefined, busy: boolean, dismissing: boolean): "busy" | "done" | undefined {
  if (own !== undefined) return own;
  return busy && !dismissing ? "busy" : undefined;
}

let shared: SharedPresses | null = null;

/** The app's one registry, made on first use. A reload starts a fresh one: a hold lost then only ends early. */
export function sharedPresses(): SharedPresses {
  if (shared === null) shared = createSharedPresses();
  return shared;
}
