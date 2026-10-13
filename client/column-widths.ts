/**
 * How wide each board column is (TR-016). Columns with cards share the pane equally; an empty one
 * needs only its head and "Nothing here", so it stays narrow and leaves the room to columns that
 * hold something. Past what fits, the row scrolls sideways rather than squeezing cards.
 */

/** Below this a column's cards get too narrow to read. */
export const MIN_COLUMN_WIDTH = 240;
/** An empty column's width: its icon, title and count. */
export const EMPTY_COLUMN_WIDTH = 168;

/** Widths in column order; `available` is the row's width without its padding and gaps. */
export function columnWidths(available: number, cardCounts: readonly number[]): number[] {
  const filled = cardCounts.filter((count) => count > 0).length;
  if (filled === 0) return cardCounts.map(() => Math.max(EMPTY_COLUMN_WIDTH, available / Math.max(1, cardCounts.length)));
  const shared = Math.max(MIN_COLUMN_WIDTH, (available - (cardCounts.length - filled) * EMPTY_COLUMN_WIDTH) / filled);
  return cardCounts.map((count) => (count > 0 ? shared : EMPTY_COLUMN_WIDTH));
}
