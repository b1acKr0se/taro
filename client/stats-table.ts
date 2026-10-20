/**
 * How the Stats table meets its pane (TR-107): it fits whole when the pane is wide enough, the
 * ticket column taking the spare width; otherwise it scrolls sideways under a pinned ticket column,
 * with a fade on the side that has more columns. Its rows come in
 * pages (TR-155).
 */
import { parentOf } from "../shared/stats";

/** Within this many pixels of an end counts as at it: a scroll position can stop a fraction short. */
const EDGE_SLACK = 1;

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

/** Tickets a Stats page shows (TR-155). */
export const STATS_PAGE_SIZE = 25;

function topLevelOf(ticket: string): string {
  let top = ticket;
  for (let parent = parentOf(top); parent !== null; parent = parentOf(top)) top = parent;
  return top;
}

/**
 * The table's tickets (in its order, a parent's children right after it) in pages of at most `size`.
 * A top-level ticket and its descendants are never parted: a family that would cross a page's end
 * starts the next page, and one bigger than a page has a page of its own.
 */
export function ticketPages(tickets: readonly string[], size: number): string[][] {
  const families: string[][] = [];
  for (const ticket of tickets) {
    const last = families[families.length - 1];
    if (last !== undefined && topLevelOf(last[0] ?? "") === topLevelOf(ticket)) last.push(ticket);
    else families.push([ticket]);
  }
  const pages: string[][] = [];
  let page: string[] = [];
  for (const family of families) {
    if (page.length > 0 && page.length + family.length > size) {
      pages.push(page);
      page = [];
    }
    page.push(...family);
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/** The tickets a page shows, counted from 1 across every page, and how many there are in all. */
export function pageRange(pages: readonly (readonly string[])[], index: number): { first: number; last: number; total: number } {
  const before = pages.slice(0, index).reduce((count, page) => count + page.length, 0);
  const total = pages.reduce((count, page) => count + page.length, 0);
  return { first: before + 1, last: before + (pages[index]?.length ?? 0), total };
}

/** A page index within `count` pages: the list can shrink under the page the user is on. */
export function clampPage(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(count - 1, 0));
}
