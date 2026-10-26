/**
 * Where the chat stands on a question the user asked to see, from a Needs you card (TR-234): the
 * question is gone (answered or withdrawn since the tap), its card is not drawn yet, or it is there
 * to measure and scroll to.
 */
export type FocusState = { kind: "gone" } | { kind: "waiting" } | { kind: "ready" };

export function focusState(key: string, openKeys: readonly string[], drawnKeys: ReadonlySet<string>): FocusState {
  if (!openKeys.includes(key)) return { kind: "gone" };
  return drawnKeys.has(key) ? { kind: "ready" } : { kind: "waiting" };
}
