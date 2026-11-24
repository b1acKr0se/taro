/**
 * When the chat first saw each call running, so a call watched to its end shows how long it took:
 * Paseo's timeline keeps only when a call last changed. Lost on a reload, as the page's kept view
 * state is not worth versioning for a duration; a call not watched shows its finish time instead.
 */
const MAX_WATCHED = 500;

const watched = new Map<string, number>();

/**
 * Notes running calls: the start of each is the earlier of now and the call's own time (a running
 * call has not changed since it began), so a chat opened partway through a call does not start the
 * clock at zero. The first note wins.
 */
export function noteRunningCalls(calls: readonly { callId: string; at: string | undefined }[], now: number = Date.now()): void {
  calls.forEach(({ callId, at }) => {
    if (watched.has(callId)) return;
    const own = at === undefined ? Number.NaN : Date.parse(at);
    watched.set(callId, Number.isFinite(own) ? Math.min(now, own) : now);
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
