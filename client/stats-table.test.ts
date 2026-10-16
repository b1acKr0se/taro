import { describe, expect, it } from "vitest";

import { clampPage, pageOffset, pageRange, scrollEdges, tableFit, ticketPages, trailingSpace } from "./stats-table";

describe("tableFit", () => {
  const columns = { side: 16, ticketMinWidth: 230, rest: 844 };

  it("scrolls when the pane is narrower than the table", () => {
    expect(tableFit({ ...columns, viewport: 672 })).toEqual({ fits: false, ticketWidth: 230 });
  });

  it("fits at exactly the table's width, not a pixel less", () => {
    expect(tableFit({ ...columns, viewport: 1106 })).toEqual({ fits: true, ticketWidth: 230 });
    expect(tableFit({ ...columns, viewport: 1105 })).toEqual({ fits: false, ticketWidth: 230 });
  });

  it("gives a wider pane's spare width to the ticket column", () => {
    expect(tableFit({ ...columns, viewport: 1344 })).toEqual({ fits: true, ticketWidth: 468 });
  });

  it("scrolls before the pane is measured", () => {
    expect(tableFit({ side: 0, ticketMinWidth: 0, rest: 0, viewport: 0 })).toEqual({ fits: false, ticketWidth: 0 });
  });
});

describe("scrollEdges", () => {
  it("shows more on the right only, at the start", () => {
    expect(scrollEdges({ offset: 0, viewport: 600, content: 1100 })).toEqual({ moreLeft: false, moreRight: true });
  });

  it("shows more on both sides in the middle", () => {
    expect(scrollEdges({ offset: 200, viewport: 600, content: 1100 })).toEqual({ moreLeft: true, moreRight: true });
  });

  it("shows more on the left only at the end, a fraction short of it included", () => {
    expect(scrollEdges({ offset: 500, viewport: 600, content: 1100 })).toEqual({ moreLeft: true, moreRight: false });
    expect(scrollEdges({ offset: 499.5, viewport: 600, content: 1100 })).toEqual({ moreLeft: true, moreRight: false });
  });

  it("shows nothing more when the table fits or nothing is measured", () => {
    expect(scrollEdges({ offset: 0, viewport: 1300, content: 1300 })).toEqual({ moreLeft: false, moreRight: false });
    expect(scrollEdges({ offset: 0, viewport: 0, content: 0 })).toEqual({ moreLeft: false, moreRight: false });
  });
});

describe("trailingSpace", () => {
  const columnStarts = [0, 120, 192, 264, 340, 392, 448, 532];

  it("pads the table so its scroll ends on the next column start", () => {
    expect(trailingSpace({ viewport: 600, content: 1100, columnStarts })).toBe(32);
  });

  it("adds nothing when the end is a column start already, a fraction off included", () => {
    expect(trailingSpace({ viewport: 600, content: 1132, columnStarts })).toBe(0);
    expect(trailingSpace({ viewport: 600, content: 1132.5, columnStarts })).toBe(0);
  });

  it("adds nothing when the table fits or the end is past the last start", () => {
    expect(trailingSpace({ viewport: 1300, content: 1200, columnStarts })).toBe(0);
    expect(trailingSpace({ viewport: 600, content: 1200, columnStarts })).toBe(0);
    expect(trailingSpace({ viewport: 600, content: 1100, columnStarts: [] })).toBe(0);
  });
});

describe("pageOffset", () => {
  // A step of 600 - 246 - 48 = 306.
  const table = { viewport: 600, content: 1100, pinned: 246, columnStarts: [0, 120, 192, 264, 340, 392, 448, 532] };

  it("lands on the farthest column start within a step, so no column is sliced at the pinned edge", () => {
    expect(pageOffset({ ...table, offset: 0, direction: 1 })).toBe(264);
    expect(pageOffset({ ...table, offset: 264, direction: -1 })).toBe(0);
  });

  it("stops at the end of the scroll, even when a column starts beyond it", () => {
    expect(pageOffset({ ...table, offset: 264, direction: 1 })).toBe(500);
    expect(pageOffset({ ...table, offset: 500, direction: 1 })).toBe(500);
  });

  it("goes back from the end to a column start, and from part way into the first column to 0", () => {
    expect(pageOffset({ ...table, offset: 500, direction: -1 })).toBe(264);
    expect(pageOffset({ ...table, offset: 50, direction: -1 })).toBe(0);
  });

  it("from a swiped position between starts, steps to a start", () => {
    expect(pageOffset({ ...table, offset: 130, direction: 1 })).toBe(392);
    expect(pageOffset({ ...table, offset: 130, direction: -1 })).toBe(0);
  });

  it("moves to the next column when a step is narrower than it", () => {
    expect(pageOffset({ viewport: 260, content: 900, pinned: 246, columnStarts: [0, 120, 192], offset: 0, direction: 1 })).toBe(120);
  });

  it("without column starts, goes to either end", () => {
    expect(pageOffset({ ...table, columnStarts: [], offset: 100, direction: 1 })).toBe(500);
    expect(pageOffset({ ...table, columnStarts: [], offset: 100, direction: -1 })).toBe(0);
  });

  it("stays put when the table fits", () => {
    expect(pageOffset({ viewport: 1300, content: 1200, pinned: 246, columnStarts: [0, 120], offset: 0, direction: 1 })).toBe(0);
  });
});

describe("ticketPages", () => {
  const ids = (count: number, from = count) => Array.from({ length: count }, (_, index) => `TR-${from - index}`);

  it("has no page without tickets", () => {
    expect(ticketPages([], 25)).toEqual([]);
  });

  it("splits tickets into pages of the page size, the last one shorter", () => {
    const pages = ticketPages(ids(60), 25);
    expect(pages.map((page) => page.length)).toEqual([25, 25, 10]);
    expect(pages[1]?.[0]).toBe("TR-35");
  });

  it("makes no empty page at an exact multiple", () => {
    expect(ticketPages(ids(50), 25).map((page) => page.length)).toEqual([25, 25]);
  });

  it("moves a parent with its children to the next page rather than part them", () => {
    // TR-3 and its children would cross the end of a page of 4.
    const pages = ticketPages(["TR-5", "TR-4", "TR-3", "TR-3.1", "TR-3.2", "TR-2", "TR-1"], 4);
    expect(pages).toEqual([["TR-5", "TR-4"], ["TR-3", "TR-3.1", "TR-3.2", "TR-2"], ["TR-1"]]);
  });

  it("keeps grandchildren with their top-level ticket", () => {
    expect(ticketPages(["TR-2", "TR-1", "TR-1.1", "TR-1.1.1"], 2)).toEqual([["TR-2"], ["TR-1", "TR-1.1", "TR-1.1.1"]]);
  });

  it("gives a family bigger than a page a page of its own", () => {
    expect(ticketPages(["TR-2", "TR-1", "TR-1.1", "TR-1.2"], 2)).toEqual([["TR-2"], ["TR-1", "TR-1.1", "TR-1.2"]]);
  });

  it("keeps a child whose parent is not listed on one page with its siblings", () => {
    expect(ticketPages(["TR-1.1", "TR-1.2", "TR-0"], 2)).toEqual([["TR-1.1", "TR-1.2"], ["TR-0"]]);
  });
});

describe("pageRange", () => {
  const pages = [["TR-9", "TR-8"], ["TR-7", "TR-7.1", "TR-6"], ["TR-5"]];

  it("counts the tickets before a page, so the range follows pages of uneven length", () => {
    expect(pageRange(pages, 0)).toEqual({ first: 1, last: 2, total: 6 });
    expect(pageRange(pages, 1)).toEqual({ first: 3, last: 5, total: 6 });
    expect(pageRange(pages, 2)).toEqual({ first: 6, last: 6, total: 6 });
  });
});

describe("clampPage", () => {
  it("keeps a page within the pages there are, the first when there are none", () => {
    expect(clampPage(1, 3)).toBe(1);
    expect(clampPage(5, 3)).toBe(2);
    expect(clampPage(-1, 3)).toBe(0);
    expect(clampPage(2, 0)).toBe(0);
  });
});
