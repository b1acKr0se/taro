// TR-082: Queued and Done carry their newest page of cards; the other columns are never trimmed.
import { describe, expect, it } from "vitest";

import { boardCounts, FIRST_PAGE, newestFirst, PAGE_STEP, pageColumns, type ColumnId } from "./board";

/** `count` tickets in one column, NA-001 the oldest. */
function tickets(column: ColumnId, count: number, prefix = "NA") {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${String(index + 1).padStart(3, "0")}`, column, updatedAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00Z` }));
}

const ids = (placed: readonly { id: string }[]) => placed.map((ticket) => ticket.id);

describe("pageColumns", () => {
  it("uses the user's sizes: a first page of 5, 20 more per Load more", () => {
    expect([FIRST_PAGE, PAGE_STEP]).toEqual([5, 20]);
  });

  it("keeps nothing and counts zero for an empty board", () => {
    expect(pageColumns([])).toEqual({ kept: [], totals: { "needs-you": 0, working: 0, stalled: 0, queued: 0, done: 0 }, offPage: [] });
  });

  it("keeps a column of fewer than a page, or exactly a page, whole", () => {
    expect(pageColumns(tickets("done", 4)).kept).toHaveLength(4);
    expect(pageColumns(tickets("done", 5)).kept).toHaveLength(5);
  });

  it("keeps the newest 5 of 6, and counts all 6", () => {
    const page = pageColumns(tickets("done", 6));
    expect(ids(page.kept).sort()).toEqual(["NA-002", "NA-003", "NA-004", "NA-005", "NA-006"]);
    expect(page.totals.done).toBe(6);
  });

  it("keeps 25 of 26 after one Load more, and all 26 after two", () => {
    expect(pageColumns(tickets("done", 26), { done: FIRST_PAGE + PAGE_STEP }).kept).toHaveLength(25);
    expect(pageColumns(tickets("done", 26), { done: FIRST_PAGE + 2 * PAGE_STEP }).kept).toHaveLength(26);
  });

  it("pages Queued and Done each by its own limit", () => {
    const page = pageColumns([...tickets("queued", 30, "QU"), ...tickets("done", 30, "DO")], { queued: 25 });
    expect(page.kept.filter((ticket) => ticket.column === "queued")).toHaveLength(25);
    expect(page.kept.filter((ticket) => ticket.column === "done")).toHaveLength(5);
    expect([page.totals.queued, page.totals.done]).toEqual([30, 30]);
  });

  it("never trims Needs you, Working or Stalled, however long", () => {
    const placed = [...tickets("needs-you", 12, "NY"), ...tickets("working", 12, "WO"), ...tickets("stalled", 12, "ST")];
    expect(pageColumns(placed, { queued: 0, done: 0 }).kept).toHaveLength(36);
  });

  it("puts a ticket that just became Done on the first page, pushing the oldest of it off", () => {
    const before = pageColumns(tickets("done", 5));
    const after = pageColumns([...tickets("done", 5), { id: "NA-900", column: "done" as const, updatedAt: "2026-01-02T00:00:00Z" }]);
    expect(ids(after.kept)).toContain("NA-900");
    expect(ids(after.kept)).not.toContain("NA-001");
    expect(ids(before.kept)).toContain("NA-001");
    expect(after.totals.done).toBe(6);
  });

  it("sends a ticket asked for by id past its page, marked off the page; one on its page is not marked", () => {
    const page = pageColumns(tickets("done", 30), {}, ["NA-001", "NA-030", "NA-404"]);
    expect(ids(page.kept)).toContain("NA-001");
    expect(page.kept).toHaveLength(6);
    expect(page.offPage).toEqual(["NA-001"]);
  });

  it("breaks a tie in update time by id, so the page boundary holds from read to read", () => {
    const same = ["NA-1", "NA-3", "NA-2", "NA-10"].map((id) => ({ id, updatedAt: "2026-01-01T00:00:00Z" }));
    expect(ids([...same].sort(newestFirst))).toEqual(["NA-10", "NA-3", "NA-2", "NA-1"]);
    expect(ids([{ id: "NA-1", updatedAt: null }, { id: "NA-2", updatedAt: "2026-01-01" }].sort(newestFirst))).toEqual(["NA-2", "NA-1"]);
  });
});

describe("boardCounts", () => {
  it("shows each column's true total, with what else waits on the user in Needs you", () => {
    expect(boardCounts({ "needs-you": 1, working: 2, stalled: 0, queued: 40, done: 91 }, 3)).toEqual({ "needs-you": 4, working: 2, stalled: 0, queued: 40, done: 91 });
  });
});
