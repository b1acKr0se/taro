/**
 * The pages each project's board has loaded (TR-082): Queued and Done start at their newest
 * `FIRST_PAGE` cards, each Load more adds `PAGE_STEP` and Show less goes back to the first page (TR-117). Kept on `globalThis` (TR-038), so the
 * 4-second refresh and a reconnect keep what the user loaded; every reader of the board shares it.
 */
import { FIRST_PAGE, isPagedColumn, newestFirst, PAGE_STEP, type ColumnId, type ColumnLimits, type PagedColumn } from "../shared/board";
import type { BoardPaging, Card } from "../shared/contracts";
import { keptObject } from "./kept";

interface Pages {
  limits: Record<string, ColumnLimits>;
  /** The ticket open on each project's screen: sent whatever its page, so a link to an old ticket opens it. */
  open: Record<string, string>;
}

const kept = keptObject<Pages>(globalThis, "board-pages-v1", { limits: {}, open: {} });

/** What the board's read asks for. */
export function boardPaging(project: string, pages: Pages = kept): BoardPaging {
  const open = pages.open[project];
  return { limits: { ...pages.limits[project] }, include: open === undefined ? [] : [open] };
}

/** One more page of a column: the next read sends `PAGE_STEP` more of its cards. */
export function addPage(project: string, column: PagedColumn, pages: Pages = kept): void {
  const limits = pages.limits[project] ?? {};
  pages.limits[project] = { ...limits, [column]: (limits[column] ?? FIRST_PAGE) + PAGE_STEP };
}

/** Back to a column's first page (Show less, TR-117): the next read sends its newest `FIRST_PAGE` cards. */
export function firstPage(project: string, column: PagedColumn, pages: Pages = kept): void {
  const { [column]: _dropped, ...limits } = pages.limits[project] ?? {};
  pages.limits[project] = limits;
}

/** Asks for the open ticket's card whatever its page; null when none is open. Says whether that changed what is asked. */
export function setOpenTicket(project: string, ticket: string | null, pages: Pages = kept): boolean {
  if ((pages.open[project] ?? null) === ticket) return false;
  if (ticket === null) delete pages.open[project];
  else pages.open[project] = ticket;
  return true;
}

export interface ColumnPage {
  cards: Card[];
  /** The column's true ticket count. */
  total: number;
  /** Cards still to load; 0 for an unpaged column. */
  remaining: number;
  /** Shows more than the first page, so Show less has something to fold (TR-117); never for an unpaged column. */
  foldable: boolean;
}

/** A column's cards, newest first, without those sent only because they were open, and how many are left to load. */
export function columnPage(board: { cards: readonly Card[]; totals: Readonly<Record<ColumnId, number>>; offPage: readonly string[] }, column: ColumnId): ColumnPage {
  const offPage = new Set(board.offPage);
  const cards = board.cards.filter((card) => card.column === column && !offPage.has(card.id)).sort(newestFirst);
  const total = board.totals[column] ?? cards.length;
  const paged = isPagedColumn(column);
  return { cards, total, remaining: paged ? Math.max(0, total - cards.length) : 0, foldable: paged && cards.length > FIRST_PAGE };
}

/** Whether the board's reads already ask for this ticket's card whatever its page. */
export function isOpenTicketAsked(project: string, ticket: string | null, pages: Pages = kept): boolean {
  return ticket !== null && pages.open[project] === ticket;
}

/** Where to scroll after Show less: back up to the column's top when it went above the view, else nowhere (null). */
export function foldScrollTarget(scrollY: number, columnTop: number): number | null {
  return scrollY > columnTop ? Math.max(0, columnTop) : null;
}
