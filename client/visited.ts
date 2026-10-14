/**
 * Which panes stay mounted (TR-069): every pane shown once stays, hidden, so returning to it shows
 * what it drew instead of building it again. Rebuilding a chat or the board on each switch is what
 * made switching slow on a phone.
 */

/** `visited` with `shown` in it; the same set when it is already there, so nothing re-renders for it. */
export function withVisited<Key>(visited: ReadonlySet<Key>, shown: Key | null): ReadonlySet<Key> {
  if (shown === null || visited.has(shown)) return visited;
  const next = new Set(visited);
  next.add(shown);
  return next;
}

/**
 * `recent` (oldest first) with `shown` moved to the end, keeping the last `limit`: the same list
 * when `shown` is already the newest or null, so nothing re-renders for it.
 */
export function withRecent<Key>(recent: readonly Key[], shown: Key | null, limit: number): readonly Key[] {
  if (shown === null || recent[recent.length - 1] === shown) return recent;
  const next = [...recent.filter((key) => key !== shown), shown];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
