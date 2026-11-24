import { describe, expect, it } from "vitest";
import { fadeOpacities, FADE_STEPS, foldHeight, mayNeedFold, overflowsFold, RECEIVED_FOLD_LINES, USER_FOLD_LINES } from "./received-fold";

describe("mayNeedFold", () => {
  const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");

  it("never measures an empty or short message", () => {
    expect(mayNeedFold("")).toBe(false);
    expect(mayNeedFold("Run the tests before delivering.")).toBe(false);
    expect(mayNeedFold("word ".repeat(30), USER_FOLD_LINES)).toBe(true);
  });

  it("measures a message with more line breaks than the fold shows, and not one with exactly as many", () => {
    expect(mayNeedFold(lines(RECEIVED_FOLD_LINES))).toBe(false);
    expect(mayNeedFold(lines(RECEIVED_FOLD_LINES + 1))).toBe(true);
    expect(mayNeedFold(lines(USER_FOLD_LINES), USER_FOLD_LINES)).toBe(false);
    expect(mayNeedFold(lines(USER_FOLD_LINES + 1), USER_FOLD_LINES)).toBe(true);
  });

  it("measures one long paragraph, which a narrow phone wraps past the fold", () => {
    expect(mayNeedFold("word ".repeat(200))).toBe(true);
  });
});

describe("overflowsFold", () => {
  it("folds only a body taller than the fold's lines: a long paragraph a wide pane fits in fewer lines is left whole", () => {
    expect(overflowsFold(20 * 4, 20, USER_FOLD_LINES)).toBe(false);
    expect(overflowsFold(20 * USER_FOLD_LINES, 20, USER_FOLD_LINES)).toBe(false);
    expect(overflowsFold(20 * USER_FOLD_LINES + 1, 20, USER_FOLD_LINES)).toBe(false);
    expect(overflowsFold(20 * (USER_FOLD_LINES + 1), 20, USER_FOLD_LINES)).toBe(true);
    expect(overflowsFold(20 * RECEIVED_FOLD_LINES + 5, 20)).toBe(true);
  });
});

describe("foldHeight", () => {
  it("is the fold's lines at the line height", () => {
    expect(foldHeight(20, USER_FOLD_LINES)).toBe(120);
    expect(foldHeight(20)).toBe(20 * RECEIVED_FOLD_LINES);
    expect(foldHeight(0)).toBe(0);
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
