/**
 * A wait's spinner, shown only once the wait has lasted a moment: a call that answers sooner shows
 * none, so a quick answer never blinks a spinner in and out.
 */
import { useEffect, useRef, useState } from "react";

/** How long a wait lasts before its spinner shows. */
export const SPINNER_DELAY_MS = 500;

/** Whether a flag on since `since` (ms, null while off) shows at `now`. */
export function shownAfter(flag: boolean, since: number | null, now: number, delayMs = SPINNER_DELAY_MS): boolean {
  return flag && since !== null && now - since >= delayMs;
}

/** `flag`, once it has been on for `delayMs`; false again the moment it turns off. */
export function useDelayedFlag(flag: boolean, delayMs = SPINNER_DELAY_MS): boolean {
  const since = useRef<number | null>(null);
  if (!flag) since.current = null;
  else if (since.current === null) since.current = Date.now();
  const [, redraw] = useState(0);
  const shown = shownAfter(flag, since.current, Date.now(), delayMs);
  useEffect(() => {
    if (!flag || shown || since.current === null) return;
    const timer = setTimeout(() => redraw((count) => count + 1), Math.max(0, since.current + delayMs - Date.now()));
    return () => clearTimeout(timer);
  }, [flag, shown, delayMs]);
  return shown;
}
