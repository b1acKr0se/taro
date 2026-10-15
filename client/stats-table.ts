/**
 * How the Stats table meets its pane (TR-107): it fits whole when the pane is wide enough, the
 * ticket column taking the spare width; otherwise it scrolls sideways under a pinned ticket column,
 * with a fade on the side that has more columns and buttons that page through them.
 */

/** Within this many pixels of an end counts as at it: a scroll position can stop a fraction short. */
const EDGE_SLACK = 1;

/** What a page step keeps in view of the columns it leaves, so the eye can follow the move. */
const PAGE_OVERLAP = 48;

export type TableFit = { fits: boolean; ticketWidth: number };

/**
 * `viewport` is the pane's width, `side` the table's padding on each side, `rest` the width of every
 * column but the ticket's. Before the pane is measured (width 0) the table scrolls, as most panes do.
 */
export function tableFit({ viewport, side, ticketMinWidth, rest }: { viewport: number; side: number; ticketMinWidth: number; rest: number }): TableFit {
  const spare = viewport - 2 * side - rest - ticketMinWidth;
  return spare >= 0 && viewport > 0 ? { fits: true, ticketWidth: ticketMinWidth + spare } : { fits: false, ticketWidth: ticketMinWidth };
}

export type ScrollEdges = { moreLeft: boolean; moreRight: boolean };

/** Whether columns lie out of view to the left of `offset` and to the right of the visible part. */
export function scrollEdges({ offset, viewport, content }: { offset: number; viewport: number; content: number }): ScrollEdges {
  return { moreLeft: offset > EDGE_SLACK, moreRight: offset + viewport < content - EDGE_SLACK };
}

/**
 * Blank width to add after the last column so the scroll's end is a column start too: without it the
 * end shows a sliver of the column under the pinned edge. Nothing when the table fits.
 */
export function trailingSpace({ viewport, content, columnStarts }: { viewport: number; content: number; columnStarts: readonly number[] }): number {
  const end = content - viewport;
  if (end <= 0) return 0;
  const next = columnStarts.find((start) => start >= end - EDGE_SLACK);
  return next === undefined ? 0 : Math.max(next - end, 0);
}

/**
 * Where a page step goes: by about the width the numbers show beside the pinned column, less an
 * overlap, landing on a column's start (`columnStarts`: each scrolling column's offset from the first,
 * which is the scroll offset that shows it whole beside the pinned column), so no column is left
 * sliced at the pinned edge; kept within the scroll's range.
 */
export function pageOffset({ offset, viewport, content, pinned, direction, columnStarts }: { offset: number; viewport: number; content: number; pinned: number; direction: -1 | 1; columnStarts: readonly number[] }): number {
  const step = Math.max(viewport - pinned - PAGE_OVERLAP, PAGE_OVERLAP);
  const end = Math.max(content - viewport, 0);
  const target = offset + direction * step;
  const ahead = columnStarts.filter((start) => (direction === 1 ? start > offset + EDGE_SLACK : start < offset - EDGE_SLACK));
  // The farthest start within a step, or the nearest one when even that is beyond a step.
  const within = ahead.filter((start) => (direction === 1 ? start <= target : start >= target));
  const pick = within.length > 0 ? within[direction === 1 ? within.length - 1 : 0] : ahead[direction === 1 ? 0 : ahead.length - 1];
  return Math.min(Math.max(pick ?? (direction === 1 ? end : 0), 0), end);
}
