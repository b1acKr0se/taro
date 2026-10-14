/**
 * Record times must come from the host clock (TR-086): an owner once typed times up to 93 minutes
 * ahead, and the board, the Ticket tab and stats sort by them. Pure and import-free so the `taro`
 * command (plain `node` type stripping) shares it: erasable TypeScript only.
 */

/** Seconds and clock reads between `date -u` and the write; never an hour. */
export const RECORD_TIME_TOLERANCE_MS = 2 * 60_000;

// A line the Ticket tab shows as a timed record (shared/execution.ts noteRecords splits at the same
// capitals word). An unmarked time is read as UTC, as the skill writes every time in UTC.
const RECORD_LINE = /^\**([A-Z][A-Z-]{2,})\**[ \t]+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)Z?\b/;

/** The first record line in `text` whose time is later than `now` (beyond the tolerance), as an error message; null when none. */
export function futureRecordTime(text: string, now: Date): string | null {
  for (const line of text.split("\n")) {
    const match = RECORD_LINE.exec(line.trimStart());
    if (match === null) continue;
    const time = Date.parse(`${match[2]}Z`);
    if (Number.isNaN(time) || time - now.getTime() <= RECORD_TIME_TOLERANCE_MS) continue;
    const current = `${now.toISOString().slice(0, 16)}Z`;
    return `${match[1]} ${match[2]}Z is later than the host clock (now ${current}). Record times come from the host: run date -u +%Y-%m-%dT%H:%MZ when you write the record and use its output.`;
  }
  return null;
}
