import { describe, expect, it } from "vitest";

import { CARD_MIN_WIDTH, GRID_MAX_COLUMNS, gridCardWidth, gridColumns, gridRows } from "./card-grid";

const GAP = 12;

describe("gridColumns", () => {
  it("keeps one card per row before the list is measured, on a phone and on a narrow desktop", () => {
    expect(gridColumns(0, GAP)).toBe(1);
    expect(gridColumns(Number.NaN, GAP)).toBe(1);
    expect(gridColumns(358, GAP)).toBe(1); // a 390-wide phone inside its gutters
    expect(gridColumns(656, GAP)).toBe(1); // a 1024 window with Paseo's sidebar
  });

  it("puts two cards side by side once two fit at the narrowest card width", () => {
    expect(gridColumns(2 * CARD_MIN_WIDTH + GAP - 1, GAP)).toBe(1);
    expect(gridColumns(2 * CARD_MIN_WIDTH + GAP, GAP)).toBe(2);
    expect(gridColumns(1072, GAP)).toBe(2); // a 1440 window with the sidebar
  });

  it("stops at three, however wide the pane", () => {
    expect(gridColumns(3 * CARD_MIN_WIDTH + 2 * GAP, GAP)).toBe(3);
    expect(gridColumns(1552, GAP)).toBe(3); // a 1920 window with the sidebar
    expect(gridColumns(5000, GAP)).toBe(GRID_MAX_COLUMNS);
  });
});

describe("gridCardWidth", () => {
  it("shares the row between the cards, the gaps taken out", () => {
    expect(gridCardWidth(1000, GAP, 1)).toBe(1000);
    expect(gridCardWidth(1012, GAP, 2)).toBe(500);
    expect(gridCardWidth(1552, GAP, 3)).toBe(509);
  });

  it("rounds down, so a row never grows wider than the list", () => {
    const width = gridCardWidth(1001, GAP, 3);
    expect(3 * width + 2 * GAP).toBeLessThanOrEqual(1001);
  });
});

describe("gridRows", () => {
  it("cuts the cards into rows in order, the last row short", () => {
    expect(gridRows(["a", "b", "c", "d", "e"], 3)).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(gridRows(["a", "b", "c", "d"], 2)).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("gives one row per card in one column, and no rows for no cards", () => {
    expect(gridRows(["a", "b"], 1)).toEqual([["a"], ["b"]]);
    expect(gridRows([], 3)).toEqual([]);
  });

  it("treats a column count below one as one", () => {
    expect(gridRows(["a", "b"], 0)).toEqual([["a"], ["b"]]);
  });
});
