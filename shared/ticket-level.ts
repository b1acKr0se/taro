/**
 * A ticket's level from its `complexity-` labels. An owner that raises its rating adds the new label
 * (and should remove the old one); when both are left, the highest counts, so a raised ticket is gated
 * and shown at the level it was raised to. Pure, no imports: the `taro` command reaches it.
 */

export type Level = "trivial" | "low" | "medium" | "high";

const LEVELS: readonly Level[] = ["trivial", "low", "medium", "high"];

/** The highest `complexity-` level among the labels; null when the ticket is unrated. */
export function ticketLevel(labels: readonly string[]): Level | null {
  let found: Level | null = null;
  for (const level of LEVELS) if (labels.includes(`complexity-${level}`)) found = level;
  return found;
}

/**
 * An investigation (`investigation` label) changes no code and delivers findings: it is worked as low
 * whatever it was rated (`skill/roles/owner.md`, Investigations), with no approval card and no plan review.
 */
export function isInvestigation(labels: readonly string[]): boolean {
  return labels.includes("investigation");
}

/** Trivial or low: built before the plan is written, reviewed by the owner itself. */
export function isLightLevel(level: Level | null): boolean {
  return level === "trivial" || level === "low";
}
