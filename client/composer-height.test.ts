import { describe, expect, it } from "vitest";

import {
  boundedComposerHeight,
  COMPOSER_CONTROL_SIZE,
  COMPOSER_WEB_LINE_HEIGHT,
  COMPOSER_WIDE_WIDTH,
  composerMaxHeight,
  composerMetrics,
  composerScrollEnabled,
  measurableWidth,
  mirrorValue,
  sendsOnEnter,
} from "./composer-height";

describe("composerMetrics", () => {
  it("takes Paseo's phone app values in the app on a phone", () => {
    expect(composerMetrics(false, 390)).toEqual({ minHeight: 30, iconSize: 20, ringSize: 16, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 12 });
  });

  it("takes Paseo's desktop values in a wide browser", () => {
    expect(composerMetrics(true, 1440)).toEqual({ minHeight: 46, iconSize: 16, ringSize: 16, paddingTop: 16, paddingBottom: 12, paddingHorizontal: 16 });
  });

  it("keeps the web's icons and height in a narrow browser, with the narrow padding", () => {
    expect(composerMetrics(true, 390)).toEqual({ minHeight: 46, iconSize: 16, ringSize: 16, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 12 });
  });

  it("switches padding at Paseo's md breakpoint, not before", () => {
    expect(composerMetrics(true, COMPOSER_WIDE_WIDTH - 1).paddingTop).toBe(8);
    expect(composerMetrics(true, COMPOSER_WIDE_WIDTH).paddingTop).toBe(16);
  });

  it("draws the ring at the icon size on a wide tablet in the app", () => {
    expect(composerMetrics(false, COMPOSER_WIDE_WIDTH).ringSize).toBe(20);
  });

  it("keeps every icon inside the 28 px controls", () => {
    for (const web of [true, false]) {
      for (const width of [320, 1440]) {
        const metrics = composerMetrics(web, width);
        expect(metrics.iconSize).toBeLessThan(COMPOSER_CONTROL_SIZE);
        expect(metrics.ringSize).toBeLessThan(COMPOSER_CONTROL_SIZE);
      }
    }
  });
});

describe("composerMaxHeight", () => {
  it("is half the window, rounded down", () => {
    expect(composerMaxHeight(900)).toBe(450);
    expect(composerMaxHeight(845)).toBe(422);
  });

  it("is never under 160", () => {
    expect(composerMaxHeight(300)).toBe(160);
    expect(composerMaxHeight(320)).toBe(160);
  });

  it("is 160 for a window not measured yet", () => {
    expect(composerMaxHeight(0)).toBe(160);
    expect(composerMaxHeight(-1)).toBe(160);
    expect(composerMaxHeight(Number.NaN)).toBe(160);
    expect(composerMaxHeight(Number.POSITIVE_INFINITY)).toBe(160);
  });
});

describe("boundedComposerHeight", () => {
  const line = COMPOSER_WEB_LINE_HEIGHT;

  it("is the minimum for an empty or short draft", () => {
    expect(boundedComposerHeight(0, 46, 400)).toBe(46);
    expect(boundedComposerHeight(line, 46, 400)).toBe(46);
  });

  it("follows the text one line at a time", () => {
    const heights = [3, 4, 5, 6].map((lines) => boundedComposerHeight(lines * line, 46, 400));
    expect(heights).toEqual([63, 84, 105, 126]);
  });

  it("stops at the maximum", () => {
    expect(boundedComposerHeight(400, 46, 400)).toBe(400);
    expect(boundedComposerHeight(10_000, 46, 400)).toBe(400);
  });
});

describe("mirrorValue", () => {
  it("copies a draft as it is", () => {
    expect(mirrorValue("")).toBe("");
    expect(mirrorValue("one line")).toBe("one line");
    expect(mirrorValue("two\nlines")).toBe("two\nlines");
  });

  it("keeps the line a trailing new line opens", () => {
    expect(mirrorValue("first\n")).toBe("first\n ");
    expect(mirrorValue("\n")).toBe("\n ");
    expect(mirrorValue("a\n\n")).toBe("a\n\n ");
  });
});

describe("measurableWidth", () => {
  it("skips a field not laid out yet", () => {
    expect(measurableWidth(0)).toBe(false);
    expect(measurableWidth(-1)).toBe(false);
    expect(measurableWidth(Number.NaN)).toBe(false);
  });

  it("measures a laid-out field", () => {
    expect(measurableWidth(0.5)).toBe(true);
    expect(measurableWidth(332)).toBe(true);
  });
});

describe("composerScrollEnabled", () => {
  it("grows below the maximum and scrolls from it", () => {
    expect(composerScrollEnabled(46, 450)).toBe(false);
    expect(composerScrollEnabled(449.5, 450)).toBe(false);
    expect(composerScrollEnabled(450, 450)).toBe(true);
    expect(composerScrollEnabled(451, 450)).toBe(true);
  });
});

describe("sendsOnEnter", () => {
  it("sends on Enter only on the web in a wide layout", () => {
    expect(sendsOnEnter({ web: true, compact: false, windowWidth: 400 })).toBe(true);
    expect(sendsOnEnter({ web: true, compact: true, windowWidth: 1600 })).toBe(false);
    expect(sendsOnEnter({ web: false, compact: false, windowWidth: 1600 })).toBe(false);
  });

  it("takes a window narrower than Paseo's md as compact when the screen does not say", () => {
    expect(sendsOnEnter({ web: true, compact: undefined, windowWidth: COMPOSER_WIDE_WIDTH })).toBe(true);
    expect(sendsOnEnter({ web: true, compact: undefined, windowWidth: COMPOSER_WIDE_WIDTH - 1 })).toBe(false);
    expect(sendsOnEnter({ web: true, compact: undefined, windowWidth: 0 })).toBe(false);
  });
});
