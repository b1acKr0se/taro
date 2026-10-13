import { describe, expect, it } from "vitest";

import { EMPTY_COLUMN_WIDTH, MIN_COLUMN_WIDTH, columnWidths } from "./column-widths";

describe("columnWidths", () => {
  it("shares a wide pane between the columns with cards and keeps empty ones narrow", () => {
    expect(columnWidths(1200, [2, 0, 1, 0, 3])).toEqual([288, EMPTY_COLUMN_WIDTH, 288, EMPTY_COLUMN_WIDTH, 288]);
  });

  it("never squeezes a column with cards below the minimum; the row scrolls instead", () => {
    expect(columnWidths(600, [1, 1, 1, 1, 1])).toEqual(Array(5).fill(MIN_COLUMN_WIDTH));
    expect(columnWidths(0, [0, 4, 0, 0, 0])).toEqual([EMPTY_COLUMN_WIDTH, MIN_COLUMN_WIDTH, EMPTY_COLUMN_WIDTH, EMPTY_COLUMN_WIDTH, EMPTY_COLUMN_WIDTH]);
  });

  it("splits the pane equally when every column is empty", () => {
    expect(columnWidths(1000, [0, 0, 0, 0, 0])).toEqual(Array(5).fill(200));
    expect(columnWidths(100, [0, 0, 0, 0, 0])).toEqual(Array(5).fill(EMPTY_COLUMN_WIDTH));
    expect(columnWidths(100, [])).toEqual([]);
  });
});
