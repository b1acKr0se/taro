/** The order Walk me through presents open decisions in. Pure. */
import type { StoredDecision } from "../shared/state";

/** Impact order for presets; free-form decisions come after them, oldest first (spec §10.5). */
const PRESET_ORDER = ["merge", "scope-approval", "child-breakdown", "review-dispute", "investigation-done", "complexity"];

export function walkOrder(decisions: readonly StoredDecision[]): StoredDecision[] {
  const rank = (decision: StoredDecision) => {
    const preset = PRESET_ORDER.indexOf(decision.id);
    return (decision.blocking ? 0 : 100) + (preset === -1 ? PRESET_ORDER.length : preset);
  };
  return [...decisions].sort((left, right) => rank(left) - rank(right) || left.askedAt.localeCompare(right.askedAt));
}
