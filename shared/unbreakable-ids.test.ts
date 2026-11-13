import { describe, expect, it } from "vitest";

import { idPieces, nonBreakingId } from "./unbreakable-ids";

const ids = (text: string) => idPieces(text).filter((piece) => piece.id).map((piece) => piece.text);

describe("idPieces", () => {
  it("finds each ticket id, a child's id included, and keeps every character as written", () => {
    const text = "NA-002.02 — Export button — M — depends on: NA-002.01";
    expect(idPieces(text)).toEqual([
      { text: "NA-002.02", id: true },
      { text: " — Export button — M — depends on: ", id: false },
      { text: "NA-002.01", id: true },
    ]);
    expect(idPieces(text).map((piece) => piece.text).join("")).toBe(text);
    expect(ids("(TR-12) and then TR2-7.")).toEqual(["TR-12", "TR2-7"]);
  });

  it("leaves words that are not ticket ids", () => {
    for (const text of ["a one-off", "UTF-8x", "e-mail 2026-11-12", "x-1", "Size: M-L", "taro/tr-263", "TR-12-beta"]) {
      expect(idPieces(text)).toEqual([{ text, id: false }]);
    }
  });

  it("leaves link targets, autolinks and addresses as written", () => {
    expect(ids("see <https://example.com/browse/TR-12> or https://example.com/TR-13 now")).toEqual([]);
    expect(ids("branch taro/TR-12 and file docs/TR-12.md")).toEqual([]);
  });
});

describe("nonBreakingId", () => {
  it("swaps the id's hyphen for U+2011", () => {
    expect(nonBreakingId("NA-002.01")).toBe("NA‑002.01");
  });
});
