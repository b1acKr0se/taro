import { useEffect, useState } from "react";

import { workingElapsed } from "./working-time";

/** Room after the next change before redrawing, so a timer firing a little early still sees the new text. */
const CHANGE_MARGIN_MS = 50;

/**
 * The turn's time, redrawn when its text changes: once a minute, then once an hour. The clock is
 * read again when the turn's start changes: a new turn can begin while the row stays up (a queued
 * message sent as the last turn ends), and the last reading may be most of an hour old.
 */
export function useWorkingElapsed(turnStartedAt: string | null | undefined): string | null {
  const [clock, setClock] = useState(() => ({ turnStartedAt, now: Date.now() }));
  // During render, as React allows for state that follows a prop: the stale reading is never drawn.
  if (clock.turnStartedAt !== turnStartedAt) setClock({ turnStartedAt, now: Date.now() });
  const elapsed = workingElapsed(turnStartedAt, clock.now);
  const nextChangeMs = elapsed?.nextChangeMs ?? null;
  useEffect(() => {
    if (nextChangeMs === null) return;
    const timer = setTimeout(() => setClock({ turnStartedAt, now: Date.now() }), nextChangeMs + CHANGE_MARGIN_MS);
    return () => clearTimeout(timer);
  }, [nextChangeMs, clock, turnStartedAt]);
  return elapsed?.text ?? null;
}
