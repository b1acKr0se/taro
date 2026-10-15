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
 * Where a page step goes: by the width the numbers show beside the pinned column, less an overlap,
 * kept within the scroll's range.
 */
export function pageOffset({ offset, viewport, content, pinned, direction }: { offset: number; viewport: number; content: number; pinned: number; direction: -1 | 1 }): number {
  const step = Math.max(viewport - pinned - PAGE_OVERLAP, PAGE_OVERLAP);
  const end = Math.max(content - viewport, 0);
  return Math.min(Math.max(offset + direction * step, 0), end);
}
