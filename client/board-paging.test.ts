// TR-082: the pages a board has loaded outlive its refresh, and a column shows only its own page.
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { pageColumns, type ColumnId } from "../shared/board";
import type { BoardPaging, Card } from "../shared/contracts";
import { addPage, boardPaging, columnPage, isOpenTicketAsked, setOpenTicket } from "./board-paging";
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
});
