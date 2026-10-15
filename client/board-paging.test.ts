// TR-082: the pages a board has loaded outlive its refresh, and a column shows only its own page.
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { pageColumns, type ColumnId } from "../shared/board";
import type { BoardPaging, Card } from "../shared/contracts";
import { addPage, boardPaging, columnPage, firstPage, foldScrollTarget, isOpenTicketAsked, setOpenTicket } from "./board-paging";
import { polled } from "./polling";

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

const card = (id: string, column: ColumnId, updatedAt: string) => ({ id, column, updatedAt }) as unknown as Card;

/** A daemon over `done` Done tickets, answering as the server does. */
function daemon(done: number) {
  const placed = Array.from({ length: done }, (_, index) => card(`NA-${index + 1}`, "done", `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`));
  const asked: BoardPaging[] = [];
  const load = async (paging: BoardPaging) => {
    asked.push(paging);
    const page = pageColumns(placed, paging.limits, paging.include);
    return { cards: page.kept, totals: page.totals, offPage: page.offPage };
  };
  return { placed, asked, load };
}

describe("board pages", () => {
  it("starts at the first page, and each Load more asks for 20 more", () => {
    const pages = { limits: {}, open: {} };
    expect(boardPaging("notes-app", pages)).toEqual({ limits: {}, include: [] });
    addPage("notes-app", "done", pages);
    expect(boardPaging("notes-app", pages).limits).toEqual({ done: 25 });
    addPage("notes-app", "done", pages);
    addPage("notes-app", "queued", pages);
    expect(boardPaging("notes-app", pages).limits).toEqual({ done: 45, queued: 25 });
    expect(boardPaging("recipes", pages).limits).toEqual({});
  });

  it("keeps the loaded page through the board's refresh: every later read asks for it again", async () => {
    const project = "notes-app-refresh";
    const { asked, load } = daemon(30);
    const client = new QueryClient();
    clients.push(client);
    const observer = new QueryObserver(client, { queryKey: ["taro", "board", project], queryFn: () => load(boardPaging(project)), ...polled(4_000) });
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    expect(columnPage(observer.getCurrentResult().data!, "done").cards).toHaveLength(5);
    addPage(project, "done");
    await observer.refetch();
    await observer.refetch();
    unsubscribe();
    expect(asked.map((paging) => paging.limits?.done ?? 5)).toEqual([5, 25, 25]);
    const page = columnPage(observer.getCurrentResult().data!, "done");
    expect([page.cards.length, page.total, page.remaining]).toEqual([25, 30, 5]);
  });

  it("Show less goes back to the first page of that column only, and Load more grows it again from there (TR-117)", () => {
    const pages = { limits: {}, open: {} };
    addPage("notes-app", "done", pages);
    addPage("notes-app", "done", pages);
    addPage("notes-app", "queued", pages);
    addPage("recipes", "done", pages);
    firstPage("notes-app", "done", pages);
    expect(boardPaging("notes-app", pages).limits).toEqual({ queued: 25 });
    expect(boardPaging("recipes", pages).limits).toEqual({ done: 25 });
    addPage("notes-app", "done", pages);
    expect(boardPaging("notes-app", pages).limits).toEqual({ queued: 25, done: 25 });
    // Already on the first page, or a project never paged: nothing to undo, nothing breaks.
    firstPage("notes-app", "queued", pages);
    firstPage("notes-app", "queued", pages);
    firstPage("blog", "done", pages);
    expect(boardPaging("notes-app", pages).limits).toEqual({ done: 25 });
    expect(boardPaging("blog", pages).limits).toEqual({});
  });

  it("keeps a folded column folded through the board's refresh: load more, show less, load more again (TR-117)", async () => {
    const project = "notes-app-fold";
    const { asked, load } = daemon(40);
    const client = new QueryClient();
    clients.push(client);
    const observer = new QueryObserver(client, { queryKey: ["taro", "board", project], queryFn: () => load(boardPaging(project)), ...polled(4_000) });
    const unsubscribe = observer.subscribe(() => undefined);
    const shown = () => {
      const page = columnPage(observer.getCurrentResult().data!, "done");
      return [page.cards.length, page.remaining, page.foldable];
    };
    await observer.refetch();
    expect(shown()).toEqual([5, 35, false]);
    addPage(project, "done");
    await observer.refetch();
    expect(shown()).toEqual([25, 15, true]);
    firstPage(project, "done");
    await observer.refetch();
    await observer.refetch();
    expect(shown()).toEqual([5, 35, false]);
    addPage(project, "done");
    await observer.refetch();
    unsubscribe();
    expect(shown()).toEqual([25, 15, true]);
    expect(asked.map((paging) => paging.limits?.done ?? 5)).toEqual([5, 25, 5, 5, 25]);
  });

  it("asks for the open ticket's card until it closes", () => {
    const pages = { limits: {}, open: {} };
    expect(setOpenTicket("notes-app", "NA-001", pages)).toBe(true);
    expect(setOpenTicket("notes-app", "NA-001", pages)).toBe(false);
    expect(boardPaging("notes-app", pages).include).toEqual(["NA-001"]);
    expect(isOpenTicketAsked("notes-app", "NA-001", pages)).toBe(true);
    expect(isOpenTicketAsked("notes-app", "NA-002", pages)).toBe(false);
    expect(setOpenTicket("notes-app", null, pages)).toBe(true);
    expect(boardPaging("notes-app", pages).include).toEqual([]);
  });
});

describe("columnPage", () => {
  it("draws a column newest first without a card sent only because it is open, and says how many are left", async () => {
    const { load } = daemon(8);
    const board = await load({ include: ["NA-1"] });
    const page = columnPage(board, "done");
    expect(page.cards.map((shown) => shown.id)).toEqual(["NA-8", "NA-7", "NA-6", "NA-5", "NA-4"]);
    expect([page.total, page.remaining]).toEqual([8, 3]);
  });

  it("has nothing left once every card is loaded, and never anything left in an unpaged column", async () => {
    expect(columnPage(await daemon(5).load({}), "done").remaining).toBe(0);
    const working = { cards: [card("NA-1", "working", "2026-01-01")], totals: { "needs-you": 0, working: 3, stalled: 0, queued: 0, done: 0 }, offPage: [] };
    expect(columnPage(working, "working").remaining).toBe(0);
  });

  it("offers Show less only past the first page of a paged column, even once every card is loaded (TR-117)", async () => {
    const { load } = daemon(30);
    expect(columnPage(await load({}), "done").foldable).toBe(false);
    expect(columnPage(await load({ limits: { done: 25 } }), "done").foldable).toBe(true);
    const all = columnPage(await load({ limits: { done: 45 } }), "done");
    expect([all.cards.length, all.remaining, all.foldable]).toEqual([30, 0, true]);
    // Six cards: one past the first page.
    expect(columnPage(await daemon(6).load({ limits: { done: 25 } }), "done").foldable).toBe(true);
    // A card sent only because it is open does not count as shown.
    expect(columnPage(await daemon(8).load({ include: ["NA-1"] }), "done").foldable).toBe(false);
    const working = { cards: Array.from({ length: 9 }, (_, index) => card(`NA-${index}`, "working", "2026-01-01")), totals: { "needs-you": 0, working: 9, stalled: 0, queued: 0, done: 0 }, offPage: [] };
    expect(columnPage(working, "working").foldable).toBe(false);
  });
});

describe("foldScrollTarget", () => {
  it("scrolls back up to the column's top only when it went above the view", () => {
    expect(foldScrollTarget(0, 0)).toBeNull();
    expect(foldScrollTarget(120, 120)).toBeNull();
    expect(foldScrollTarget(80, 120)).toBeNull();
    expect(foldScrollTarget(900, 120)).toBe(120);
    expect(foldScrollTarget(900, 0)).toBe(0);
    expect(foldScrollTarget(10, -4)).toBe(0);
  });
});
