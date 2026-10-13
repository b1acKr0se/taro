/**
 * The ticket's milestone timeline as rows (TR-018): a day heading where the date changes, a clock
 * time in a fixed column, the kind in plain words, and colour kept for the records that mark a step
 * forward or trouble, so the eye can follow the ticket down the rail.
 */
import type { Milestone } from "../shared/milestones";
import { formatClock, formatDay } from "./format";

/** Records the reader looks for; the rest (dispatch, execution, answers, routine milestones) stay grey. */
const KEY_KINDS: ReadonlySet<string> = new Set(["APPROVAL", "REVIEW", "FINAL", "ACCEPTANCE", "RECOVERY"]);

export interface MilestoneRow {
  /** The day heading drawn above this row; null when the day is the row before's or unknown. */
  day: string | null;
  clock: string | null;
  /** "Dispatch intent" for DISPATCH-INTENT. */
  label: string;
  kind: string;
  text: string;
  key: boolean;
}

export function kindLabel(kind: string): string {
  const words = kind.toLowerCase().replace(/[-_]+/g, " ").trim();
  return words === "" ? kind : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function milestoneRows(milestones: readonly Milestone[], now: number = Date.now()): MilestoneRow[] {
  let lastDay: string | null = null;
  return milestones.map((milestone) => {
    const day = formatDay(milestone.time, now);
    const heading = day !== null && day !== lastDay ? day : null;
    if (day !== null) lastDay = day;
    return {
      day: heading,
      clock: formatClock(milestone.time),
      label: kindLabel(milestone.kind),
      kind: milestone.kind,
      text: milestone.text,
      key: KEY_KINDS.has(milestone.kind),
    };
  });
}
