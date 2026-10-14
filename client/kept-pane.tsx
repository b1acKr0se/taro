/**
 * A pane that stays mounted once shown (TR-069), hidden while another shows: switching back to it
 * draws nothing new. Hidden by `display: "none"`, which lays out nothing and keeps the pane's state,
 * scroll position and subscriptions.
 */
import { useRef, type ReactNode } from "react";
import { View } from "react-native";

import { withVisited } from "./visited";

export function KeptPane({ shown, children }: { shown: boolean; children: ReactNode }) {
  return <View style={shown ? FILL : HIDDEN}>{children}</View>;
}

const FILL = { flex: 1, minHeight: 0 } as const;
const HIDDEN = { display: "none" } as const;

/** The keys shown so far, `shown` among them: the panes to keep mounted. */
export function useVisited<Key>(shown: Key | null): ReadonlySet<Key> {
  const visited = useRef<ReadonlySet<Key>>(new Set());
  visited.current = withVisited(visited.current, shown);
  return visited.current;
}
