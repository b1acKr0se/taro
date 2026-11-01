/**
 * The phone shimmer's band position, ticking outside React state (TR-246): the tool line does not
 * render on a tick, only the words that subscribed.
 */
export type BandClock = { position: number; listeners: Set<() => void> };

export function createBandClock(from: number): BandClock {
  return { position: from, listeners: new Set() };
}

function notify(clock: BandClock): void {
  clock.listeners.forEach((listener) => listener());
}

/** Puts the band at `from` and, while `running`, moves it to `to` every `durationMs`, ticking each `frameMs`; the returned function stops it. */
export function runBandClock(clock: BandClock, running: boolean, from: number, to: number, durationMs: number, frameMs: number, now: () => number = Date.now): () => void {
  clock.position = from;
  notify(clock);
  if (!running) return () => undefined;
  const startedAt = now();
  const timer = setInterval(() => {
    clock.position = from + (to - from) * (((now() - startedAt) % durationMs) / durationMs);
    notify(clock);
  }, frameMs);
  return () => clearInterval(timer);
}

/** Whether two paintings are the same runs: a tick that moves no letter's shade renders nothing. */
export function sameRuns(left: { text: string; level: number }[], right: { text: string; level: number }[]): boolean {
  return left.length === right.length && left.every((run, index) => run.level === right[index]!.level && run.text === right[index]!.text);
}
