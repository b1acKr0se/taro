/**
 * Options for a query polled every `intervalMs` (TR-069): its data counts as fresh until the next
 * poll, so a pane mounted again (a tab or ticket shown again) draws the cached data at once instead
 * of asking the daemon again. An action's refresh (`invalidateQueries`) still reads at once.
 */
export function polled(intervalMs: number): { refetchInterval: number; staleTime: number } {
  return { refetchInterval: intervalMs, staleTime: intervalMs };
}
