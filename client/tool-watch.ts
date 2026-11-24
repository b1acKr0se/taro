/**
 * When the chat first saw each call running, so a call watched to its end shows how long it took:
 * Paseo's timeline keeps only when a call last changed. Lost on a reload, as the page's kept view
 * state is not worth versioning for a duration; a call not watched shows its finish time instead.
 */
const MAX_WATCHED = 500;

const watched = new Map<string, number>();

/** Notes the calls in `running` as seen at `now`, the first sighting winning. */
export function noteRunningCalls(callIds: readonly string[], now: number = Date.now()): void {
  callIds.forEach((callId) => {
    if (!watched.has(callId)) watched.set(callId, now);
  });
  while (watched.size > MAX_WATCHED) {
    const [oldest] = watched.keys();
    if (oldest === undefined) break;
    watched.delete(oldest);
  }
}

export function watchedStart(callId: string | undefined): number | undefined {
  return callId === undefined ? undefined : watched.get(callId);
}
