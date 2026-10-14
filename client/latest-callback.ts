import { useRef } from "react";

/**
 * A function that keeps its identity across renders and always calls the latest `callback`, so a
 * memoised row or card handed it is not redrawn for a new closure, nor calls a stale one (TR-069).
 */
export function useLatestCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result): (...args: Args) => Result {
  const latest = useRef(callback);
  latest.current = callback;
  const stable = useRef<((...args: Args) => Result) | null>(null);
  if (stable.current === null) stable.current = (...args: Args) => latest.current(...args);
  return stable.current;
}
