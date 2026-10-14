/**
 * The ticket's milestone timeline as rows (TR-018): a day heading where the date changes, a clock
 * time in a fixed column, the kind in plain words, and colour kept for the records that mark a step
 * forward or trouble, so the eye can follow the ticket down the rail. Newest first, the newest few
 * shown and the rest folded (TR-061).
 */
import { kindLabel, type Milestone } from "../shared/milestones";
import { foldList } from "../shared/ticket-summary";
import { formatClock, formatDay } from "./format";

/** Records the reader looks for; the rest (dispatch, execution, answers, routine milestones) stay grey. */
const KEY_KINDS: ReadonlySet<string> = new Set(["APPROVAL", "REVIEW", "FINAL", "ACCEPTANCE", "RECOVERY"]);

export interface MilestoneRow {
  /**
   * Stays with its record while newer ones arrive (the list is newest first, so an index would
   * move): its position counted from the oldest record, its kind and time.
   */
  id: string;
  /** The day heading drawn above this row; null when the day is the row before's or unknown. */
  day: string | null;
  clock: string | null;
  /** "Dispatch intent" for DISPATCH-INTENT. */
  label: string;
  kind: string;
  text: string;
  key: boolean;
}

/** How many of the newest records show before "Show N older". */
export const RECENT_MILESTONES = 3;

/** A row's `id`: the record's position counted from the oldest, its kind and time. */
export function milestoneRowId(position: number, milestone: Pick<Milestone, "kind" | "time">): string {
  return `${position}:${milestone.kind}:${milestone.time ?? ""}`;
}

/** `positions` are the records' places counted from the oldest, when `milestones` is not the whole list in order. */
export function milestoneRows(milestones: readonly Milestone[], now: number = Date.now(), positions?: readonly number[]): MilestoneRow[] {
  let lastDay: string | null = null;
  return milestones.map((milestone, index) => {
    const day = formatDay(milestone.time, now);
    const heading = day !== null && day !== lastDay ? day : null;
    if (day !== null) lastDay = day;
    return {
      id: milestoneRowId(positions?.[index] ?? index, milestone),
      day: heading,
      clock: formatClock(milestone.time),
      label: kindLabel(milestone.kind),
      kind: milestone.kind,
      text: milestone.text,
      key: KEY_KINDS.has(milestone.kind),
    };
  });
}

/** The records newest first: the newest `RECENT_MILESTONES` unless `showAll`, and how many older ones are folded. */
export function recentMilestoneRows(milestones: readonly Milestone[], showAll: boolean, now: number = Date.now()): { rows: MilestoneRow[]; older: number } {
  const newestFirst = milestones.map((milestone, position) => ({ milestone, position })).reverse();
  const { shown, hidden } = foldList(newestFirst, RECENT_MILESTONES, showAll);
  return {
    rows: milestoneRows(
      shown.map((each) => each.milestone),
      now,
      shown.map((each) => each.position),
    ),
    older: hidden,
  };
}
