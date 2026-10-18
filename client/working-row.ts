/**
 * The row at the bottom of an agent's chat while its turn runs (TR-176): "Working…" and how long the
 * turn has run, so a quiet agent still shows it is at work. Pure; the drawing is `working-indicator.tsx`.
 */
import { isWorking } from "../shared/pending-sends";
import { formatDuration } from "./format";

export const WORKING_LABEL = "Working…";

/** The row's two parts, or null when no turn runs. The time is null when the turn's start is unknown or in the future: no time beats a wrong one. */
export function workingRow(status: string | null | undefined, turnStartedAt: string | null | undefined, now: number): { label: string; elapsed: string | null } | null {
  if (!isWorking(status)) return null;
  const started = Date.parse(turnStartedAt ?? "");
  const elapsed = Number.isFinite(started) && now > started ? formatDuration(now - started) : null;
  return { label: WORKING_LABEL, elapsed };
}

/**
 * How bright letter `index` of `count` is while the wave at `progress` (0 to 1) passes over the word:
 * full at the wave's crest, `dim` beyond `reach` letters' worth of distance. The wave starts before
 * the first letter and ends after the last, so each pass enters and leaves the word.
 */
export function shimmerOpacity(index: number, count: number, progress: number, dim = 0.4, reach = 0.25): number {
  const crest = -reach + progress * (1 + 2 * reach);
  const distance = Math.abs(index / Math.max(1, count - 1) - crest);
  return distance >= reach ? dim : dim + (1 - dim) * (1 - distance / reach);
}
