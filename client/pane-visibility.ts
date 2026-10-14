/**
 * Whether a kept pane is on screen, told to what is inside it without re-rendering anything
 * (TR-069): a hidden pane stays mounted, so what would have ended with it on unmount (a focused
 * field, an open tooltip and its Back step) has to end when it hides.
 */
import { createContext, useContext, useEffect, useRef } from "react";

export type PaneVisibility = {
  /** On screen: shown itself, and every pane around it shown too. */
  shown(): boolean;
  /** `listener` hears each change of `shown()`; returns how to stop. */
  listen(listener: () => void): () => void;
  /** Sets whether this pane itself is shown. */
  set(shown: boolean): void;
  /** Stops hearing the pane around it. */
  dispose(): void;
};

/** A pane's visibility inside `parent` (null outside any kept pane). */
export function paneVisibility(parent: PaneVisibility | null, initiallyShown: boolean): PaneVisibility {
  let own = initiallyShown;
  const listeners = new Set<() => void>();
  const shown = () => own && (parent === null || parent.shown());
  let last = shown();
  const changed = () => {
    const now = shown();
    if (now === last) return;
    last = now;
    Array.from(listeners).forEach((listener) => listener());
  };
  const stopParent = parent === null ? () => undefined : parent.listen(changed);
  return {
    shown,
    listen(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      own = next;
      changed();
    },
    dispose() {
      stopParent();
      listeners.clear();
    },
  };
}

/** The visibility of the kept pane around a component; null outside any. */
export const PaneVisibilityContext = createContext<PaneVisibility | null>(null);

/** Calls `onHidden` (its latest version) each time the pane around the component leaves the screen. */
export function useOnPaneHidden(onHidden: () => void): void {
  const visibility = useContext(PaneVisibilityContext);
  const latest = useRef(onHidden);
  latest.current = onHidden;
  useEffect(() => {
    if (visibility === null) return;
    return visibility.listen(() => {
      if (!visibility.shown()) latest.current();
    });
  }, [visibility]);
}
