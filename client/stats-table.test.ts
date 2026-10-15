import { describe, expect, it } from "vitest";

import { pageOffset, scrollEdges, tableFit } from "./stats-table";

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

describe("pageOffset", () => {
  const table = { viewport: 600, content: 1100, pinned: 246 };

  it("steps by the visible numbers less an overlap", () => {
    expect(pageOffset({ ...table, offset: 0, direction: 1 })).toBe(306);
    expect(pageOffset({ ...table, offset: 306, direction: -1 })).toBe(0);
  });

  it("stops at either end", () => {
    expect(pageOffset({ ...table, offset: 306, direction: 1 })).toBe(500);
    expect(pageOffset({ ...table, offset: 100, direction: -1 })).toBe(0);
  });

  it("still moves when the pinned column leaves almost no room", () => {
    expect(pageOffset({ viewport: 260, content: 900, pinned: 246, offset: 0, direction: 1 })).toBe(48);
  });

  it("stays put when the table fits", () => {
    expect(pageOffset({ viewport: 1300, content: 1200, pinned: 246, offset: 0, direction: 1 })).toBe(0);
  });
});
