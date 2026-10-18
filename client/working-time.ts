/**
 * The time beside the loader at the end of a working agent's chat (TR-183): "<1m" for the first
 * minute, "1m"–"59m", then "2h" and "3d 4h". Rounded down, so each figure changes exactly on its
 * boundary, and with the delay until it next changes, so the chat redraws it once a minute or once
 * an hour instead of every second as Paseo's own does.
 */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Null when the turn's start is unknown or unreadable: no time beats a wrong one. A start ahead of this clock reads "<1m". */
export function workingElapsed(turnStartedAt: string | null | undefined, now: number): { text: string; nextChangeMs: number } | null {
  const started = Date.parse(turnStartedAt ?? "");
  if (!Number.isFinite(started)) return null;
  const elapsed = now - started;
  if (elapsed < MINUTE_MS) return { text: "<1m", nextChangeMs: MINUTE_MS - elapsed };
  const minutes = Math.floor(elapsed / MINUTE_MS);
  if (minutes < 60) return { text: `${minutes}m`, nextChangeMs: (minutes + 1) * MINUTE_MS - elapsed };
  const hours = Math.floor(elapsed / HOUR_MS);
  const nextChangeMs = (hours + 1) * HOUR_MS - elapsed;
  return { text: hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d ${hours % 24}h`, nextChangeMs };
}
