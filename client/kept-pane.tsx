/**
 * A pane that stays mounted once shown (TR-069), hidden while another shows: switching back to it
 * draws nothing new. Hidden by `display: "none"`, which lays out nothing and keeps the pane's state,
 * scroll position and subscriptions; what is inside hears it hide through `useOnPaneHidden`.
 */
import { memo, useContext, useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";

import { paneVisibility, PaneVisibilityContext, type PaneVisibility } from "./pane-visibility";
import { withRecent, withVisited } from "./visited";

export function KeptPane({
  shown,
  live = false,
  children,
}: {
  shown: boolean;
  /** Redrawn while hidden too, for a pane told it is no longer the one showing (a project's view). */
  live?: boolean;
  children: ReactNode;
}) {
  const parent = useContext(PaneVisibilityContext);
  const visibility = useRef<PaneVisibility | null>(null);
  if (visibility.current === null) visibility.current = paneVisibility(parent, shown);
  const own = visibility.current;
  useEffect(() => own.set(shown), [own, shown]);
  useEffect(() => () => own.dispose(), [own]);
  return (
    <View style={shown ? FILL : HIDDEN}>
      <PaneVisibilityContext.Provider value={own}>{live ? children : <Still shown={shown}>{children}</Still>}</PaneVisibilityContext.Provider>
    </View>
  );
}

/**
 * Its children as last drawn while the pane is hidden: hiding the pane, or a redraw of the screen
 * around it, draws nothing inside it (a hidden chat is not drawn again for the tab that replaced
 * it); showing it draws them as they are now. Their own state and queries still update them.
 */
const Still = memo(
  function Still({ children }: { shown: boolean; children: ReactNode }) {
    return <>{children}</>;
  },
  (_previous, next) => !next.shown,
);

const FILL = { flex: 1, minHeight: 0 } as const;
const HIDDEN = { display: "none" } as const;

/** The keys shown so far, `shown` among them: the panes to keep mounted. */
export function useVisited<Key>(shown: Key | null): ReadonlySet<Key> {
  const visited = useRef<ReadonlySet<Key>>(new Set());
  visited.current = withVisited(visited.current, shown);
  return visited.current;
}

/** The last `limit` keys shown, `shown` among them: the panes to keep mounted when each is large. */
export function useRecent<Key>(shown: Key | null, limit: number): ReadonlySet<Key> {
  const recent = useRef<readonly Key[]>([]);
  const kept = useRef<ReadonlySet<Key>>(new Set());
  const next = withRecent(recent.current, shown, limit);
  if (next !== recent.current) {
    recent.current = next;
    kept.current = new Set(next);
  }
  return kept.current;
}
