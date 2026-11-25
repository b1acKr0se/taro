import { describe, expect, it } from "vitest";
import { FADE_COVER, fadeOpacities, fadeSteps, foldClipStyle, foldCut, foldHeight, foldState, rememberedFold, rememberFold, mayNeedFold, overflowsFold, RECEIVED_FOLD_LINES, settleMeasure, USER_FOLD_LINES } from "./received-fold";

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
  it("rises from clear, slowly then faster, and never covers the last line whole", () => {
    const strips = fadeOpacities(33);
    expect(strips).toHaveLength(33);
    expect(strips[0]).toBeLessThan(0.01);
    expect(strips[strips.length - 1]).toBeLessThan(FADE_COVER);
    expect(strips[strips.length - 1]).toBeGreaterThan(FADE_COVER - 0.05);
    expect(strips).toEqual([...strips].sort((first, second) => first - second));
    // Easing in: the top half of the fade rises less than the bottom half.
    const middle = strips[16] ?? 0;
    expect(middle).toBeLessThan(FADE_COVER / 2);
  });
  it("draws strips about two points tall", () => {
    expect(fadeSteps(66)).toBe(33);
    expect(fadeSteps(0)).toBe(1);
  });
});

describe("foldClipStyle", () => {
  it("clips with scroll on a phone, so the text measures its full height, and hidden on the web, which shows no scroll bar", () => {
    expect(foldClipStyle(132, false)).toEqual({ maxHeight: 132, overflow: "scroll" });
    expect(foldClipStyle(132, true)).toEqual({ maxHeight: 132, overflow: "hidden" });
  });
});

describe("settleMeasure", () => {
  it("keeps the height already known when a clipped measure comes back at the clip, which a capping platform would give", () => {
    expect(settleMeasure(132, 132, 400)).toBe(400);
    expect(settleMeasure(120.6, 120, 400)).toBe(400);
  });
  it("takes a measure at the clip as it is when no height is known yet: a body that fits exactly is not folded", () => {
    expect(settleMeasure(132, 132, null)).toBe(132);
  });
  it("keeps any other measure as it is", () => {
    expect(settleMeasure(100, 132, 400)).toBe(100);
    expect(settleMeasure(400, 132, 132)).toBe(400);
    expect(settleMeasure(132, null, 400)).toBe(132);
    expect(settleMeasure(118, 120, 400)).toBe(118);
  });
});

describe("foldCut", () => {
  const LINE = 22;
  const FOLD = 8 * LINE;
  it("ends at the fold height with nothing measured, or for one text starting at the top, whose lines meet the fold", () => {
    expect(foldCut([], FOLD)).toBe(FOLD);
    expect(foldCut([{ top: 0, height: 20 * LINE, lineHeight: LINE }], FOLD)).toBe(FOLD);
  });
  it("ends between lines when a paragraph gap moves the lines off the fold", () => {
    const blocks = [
      { top: 0, height: 3 * LINE, lineHeight: LINE },
      { top: 3 * LINE + 10, height: 10 * LINE, lineHeight: LINE },
    ];
    // The second paragraph's lines start at 76, 98 … 164, 186: the fold at 176 would cut the line from 164.
    expect(foldCut(blocks, FOLD)).toBe(164);
  });
  it("ends in the gap between paragraphs when that is lowest", () => {
    const blocks = [
      { top: 0, height: 8 * LINE - 10, lineHeight: LINE / 2 + 0.5 },
      { top: 8 * LINE + 2, height: 5 * LINE, lineHeight: LINE },
    ];
    expect(foldCut(blocks, FOLD)).toBe(8 * LINE - 10);
  });
  it("keeps every line of side-by-side texts whole: a list marker beside its item", () => {
    const blocks = [
      { top: 50, height: LINE, lineHeight: LINE },
      { top: 50, height: 6 * LINE, lineHeight: LINE },
    ];
    expect(foldCut(blocks, FOLD)).toBe(50 + 5 * LINE);
  });
  it("ends above a heading or code block the fold would cross, never inside it", () => {
    const blocks = [
      { top: 0, height: 5 * LINE, lineHeight: LINE },
      { top: 5 * LINE + 10, height: 120, lineHeight: null },
    ];
    expect(foldCut(blocks, FOLD)).toBe(5 * LINE + 10);
  });
  it("ends at the fold height when the nearest whole-line end would hide more than half the fold", () => {
    const blocks = [
      { top: 0, height: 2 * LINE, lineHeight: LINE },
      { top: 2 * LINE + 10, height: 400, lineHeight: null },
    ];
    expect(foldCut(blocks, FOLD)).toBe(FOLD);
  });
  it("tolerates layout rounding at a line boundary", () => {
    const blocks = [{ top: 10.3, height: 10 * LINE, lineHeight: LINE }];
    expect(foldCut(blocks, FOLD)).toBeCloseTo(10.3 + 7 * LINE);
  });
});

describe("foldState", () => {
  it("only clips a candidate that is not measured yet, showing no fade or button", () => {
    expect(foldState(true, null, false, 20, 6)).toEqual({ overflowing: false, folded: true });
  });
  it("never folds or shows a button for a body measured as fitting", () => {
    expect(foldState(true, 100, false, 20, 6)).toEqual({ overflowing: false, folded: false });
  });
  it("folds a measured long body until opened", () => {
    expect(foldState(true, 300, false, 20, 6)).toEqual({ overflowing: true, folded: true });
    expect(foldState(true, 300, true, 20, 6)).toEqual({ overflowing: true, folded: false });
  });
  it("leaves a short text alone", () => {
    expect(foldState(false, null, false, 20, 6)).toEqual({ overflowing: false, folded: false });
  });
});

describe("remembered folds", () => {
  it("returns what was stored for the key, and null for an unknown one", () => {
    rememberFold("390:6:hello", { natural: 80, cut: null });
    expect(rememberedFold("390:6:hello")).toEqual({ natural: 80, cut: null });
    expect(rememberedFold("820:6:hello")).toBeNull();
  });
  it("forgets the oldest once past its limit, keeping one just stored again", () => {
    rememberFold("keep", { natural: 1, cut: 1 });
    Array.from({ length: 250 }, (_, index) => {
      rememberFold(`k${index}`, { natural: index, cut: null });
      if (index % 50 === 0) rememberFold("keep", { natural: 1, cut: 1 });
    });
    expect(rememberedFold("keep")).toEqual({ natural: 1, cut: 1 });
    expect(rememberedFold("k0")).toBeNull();
    expect(rememberedFold("k249")).toEqual({ natural: 249, cut: null });
  });
});
