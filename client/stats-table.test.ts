import { describe, expect, it } from "vitest";

import { pageOffset, scrollEdges, tableFit, trailingSpace } from "./stats-table";

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
