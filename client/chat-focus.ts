import type { LayoutRectangle } from "react-native";

/**
 * Where the chat stands on a question the user asked to see, from a Needs you card (TR-234): the
 * question is gone (answered or withdrawn since the tap), its card is not laid out yet, or it is
 * there to scroll to.
 */
export type FocusState = { kind: "gone" } | { kind: "waiting" } | { kind: "ready"; layout: LayoutRectangle };

export function focusState(key: string, openKeys: readonly string[], layouts: ReadonlyMap<string, LayoutRectangle>): FocusState {
  if (!openKeys.includes(key)) return { kind: "gone" };
  const layout = layouts.get(key);
  return layout === undefined ? { kind: "waiting" } : { kind: "ready", layout };
}
