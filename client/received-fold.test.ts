import { describe, expect, it } from "vitest";
import { needsFold, RECEIVED_FOLD_LINES } from "./received-fold";

describe("needsFold", () => {
  it("keeps an empty and a short message whole", () => {
    expect(needsFold("")).toBe(false);
    expect(needsFold("Run the tests before delivering.")).toBe(false);
  });

  it("keeps a message of exactly the fold's lines whole and folds one more", () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");
    expect(needsFold(lines(RECEIVED_FOLD_LINES))).toBe(false);
    expect(needsFold(lines(RECEIVED_FOLD_LINES + 1))).toBe(true);
  });

  it("folds one long paragraph that wraps past the fold", () => {
    expect(needsFold("word ".repeat(200))).toBe(true);
  });
});
