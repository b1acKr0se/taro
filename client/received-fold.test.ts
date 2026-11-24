import { describe, expect, it } from "vitest";
import { fadeOpacities, FADE_STEPS, foldHeight, needsFold, RECEIVED_FOLD_LINES, USER_FOLD_LINES } from "./received-fold";

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

describe("foldHeight", () => {
  it("is the fold's lines at the line height", () => {
    expect(foldHeight(20)).toBe(20 * RECEIVED_FOLD_LINES);
    expect(foldHeight(0)).toBe(0);
  });
});

describe("user fold", () => {
  it("folds a user message after six lines", () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");
    expect(needsFold(lines(USER_FOLD_LINES), USER_FOLD_LINES)).toBe(false);
    expect(needsFold(lines(USER_FOLD_LINES + 1), USER_FOLD_LINES)).toBe(true);
    expect(foldHeight(20, USER_FOLD_LINES)).toBe(120);
  });
});

describe("fadeOpacities", () => {
  it("rises from nearly clear to the bubble's colour", () => {
    const strips = fadeOpacities();
    expect(strips).toHaveLength(FADE_STEPS);
    expect(strips[0]).toBeGreaterThan(0);
    expect(strips[strips.length - 1]).toBe(1);
    expect(strips).toEqual([...strips].sort((first, second) => first - second));
  });
});
