import { describe, expect, it } from "vitest";

import {
  FIT,
  clampTransform,
  doubleTapAt,
  fitOf,
  isAtFit,
  isDoubleTap,
  isOutsideImage,
  isTap,
  maxScale,
  pinchTo,
  realScale,
  swipeTarget,
  toggleRealSize,
  wheelAt,
  zoomAround,
  zoomPercent,
} from "./zoom";

// A phone-shaped stage and a wide screenshot: fit is 400×200 points, a fifth of a point per pixel.
const STAGE = { width: 400, height: 800 };
const IMAGE = { width: 2000, height: 1000 };
const FITTED = fitOf(STAGE, IMAGE);
const MAX = maxScale(FITTED.pointsPerPixel);

describe("fitOf, realScale, maxScale", () => {
  it("fits the image inside the stage keeping its shape", () => {
    expect(FITTED).toEqual({ width: 400, height: 200, pointsPerPixel: 0.2 });
    expect(fitOf({ width: 1000, height: 500 }, { width: 500, height: 1000 })).toEqual({ width: 250, height: 500, pointsPerPixel: 0.5 });
  });

  it("enlarges a small image to fit, so 100% is smaller than fit", () => {
    const small = fitOf(STAGE, { width: 100, height: 100 });
    expect(small.pointsPerPixel).toBe(4);
    expect(realScale(small.pointsPerPixel)).toBe(0.25);
  });

  it("is empty before the stage or the image is measured", () => {
    expect(fitOf({ width: 0, height: 0 }, IMAGE)).toEqual({ width: 0, height: 0, pointsPerPixel: 1 });
    expect(fitOf(STAGE, { width: 0, height: 10 })).toEqual({ width: 0, height: 0, pointsPerPixel: 1 });
    expect(realScale(0)).toBe(1);
  });

  it("allows the larger of 4× fit and twice the real size", () => {
    expect(realScale(0.2)).toBe(5);
    expect(MAX).toBe(10);
    expect(maxScale(1)).toBe(4);
    expect(maxScale(4)).toBe(4);
  });

  it("reads the zoom as percent of the real size", () => {
    expect(zoomPercent(FIT, 0.2)).toBe(20);
    expect(zoomPercent({ scale: 5, x: 0, y: 0 }, 0.2)).toBe(100);
    expect(zoomPercent({ scale: 1.234, x: 0, y: 0 }, 0.333)).toBe(41);
  });
});

describe("clampTransform", () => {
  it("never zooms out past fit nor in past the maximum", () => {
    expect(clampTransform({ scale: 0.5, x: 10, y: 10 }, STAGE, FITTED, MAX)).toEqual(FIT);
    expect(clampTransform({ scale: 50, x: 0, y: 0 }, STAGE, FITTED, MAX).scale).toBe(MAX);
  });

  it("keeps the image's edges outside the stage's edges, per axis", () => {
    // At 2×, the image is 800×400: it may move 200 sideways, and not at all up or down (400 < 800).
    expect(clampTransform({ scale: 2, x: 500, y: 300 }, STAGE, FITTED, MAX)).toEqual({ scale: 2, x: 200, y: 0 });
    expect(clampTransform({ scale: 2, x: -500, y: -300 }, STAGE, FITTED, MAX)).toEqual({ scale: 2, x: -200, y: 0 });
    // At 6×, 2400×1200: 1000 sideways, 200 up or down.
    expect(clampTransform({ scale: 6, x: 50, y: -999 }, STAGE, FITTED, MAX)).toEqual({ scale: 6, x: 50, y: -200 });
  });
});

describe("zoomAround", () => {
  it("keeps the point under the focus where it was", () => {
    const zoomed = zoomAround(FIT, 2, { x: 100, y: 50 });
    // The image point at (100, 50) was 100 right of the image's centre; at 2× it is 200 right, so the centre moves 100 left.
    expect(zoomed).toEqual({ scale: 2, x: -100, y: -50 });
    expect(zoomAround({ scale: 2, x: -100, y: -50 }, 1, { x: 100, y: 50 })).toEqual(FIT);
  });
});

describe("pinchTo", () => {
  const pinch = { start: FIT, distance: 100, middle: { x: 0, y: 0 } };

  it("scales by how far the fingers moved apart, around their middle", () => {
    expect(pinchTo(pinch, 200, { x: 0, y: 0 })).toEqual({ scale: 2, x: 0, y: 0 });
    expect(pinchTo({ ...pinch, middle: { x: 100, y: 0 } }, 300, { x: 100, y: 0 })).toEqual({ scale: 3, x: -200, y: 0 });
  });

  it("pans with the fingers' middle while pinching", () => {
    expect(pinchTo(pinch, 100, { x: 30, y: -20 })).toEqual({ scale: 1, x: 30, y: -20 });
  });

  it("builds on the transform at the start of the pinch", () => {
    expect(pinchTo({ start: { scale: 2, x: 0, y: 0 }, distance: 100, middle: { x: 0, y: 0 } }, 50, { x: 0, y: 0 }).scale).toBe(1);
  });

  it("ignores a pinch that started with the fingers together", () => {
    expect(pinchTo({ ...pinch, distance: 0 }, 300, { x: 5, y: 5 })).toBe(FIT);
  });
});

describe("doubleTapAt", () => {
  it("zooms in to 2.5× at the tapped point from fit, clamped to the edges", () => {
    expect(doubleTapAt(FIT, { x: 40, y: 20 }, STAGE, FITTED, MAX)).toEqual({ scale: 2.5, x: -60, y: 0 });
    // Tapped at the image's far right edge: the right edge stays at the stage's right edge.
    expect(doubleTapAt(FIT, { x: 200, y: 0 }, STAGE, FITTED, MAX)).toEqual({ scale: 2.5, x: -300, y: 0 });
  });

  it("goes back to fit from any zoom", () => {
    expect(doubleTapAt({ scale: 2.5, x: -60, y: 0 }, { x: 0, y: 0 }, STAGE, FITTED, MAX)).toBe(FIT);
    expect(doubleTapAt({ scale: 1.5, x: 0, y: 0 }, { x: 0, y: 0 }, STAGE, FITTED, MAX)).toBe(FIT);
  });

  it("counts a hair above fit as fit", () => {
    expect(isAtFit({ scale: 1.005, x: 0, y: 0 })).toBe(true);
    expect(doubleTapAt({ scale: 1.005, x: 0, y: 0 }, { x: 0, y: 0 }, STAGE, FITTED, MAX).scale).toBe(2.5);
  });

  it("stops at the maximum when it is below 2.5×", () => {
    expect(doubleTapAt(FIT, { x: 0, y: 0 }, STAGE, FITTED, 2).scale).toBe(2);
  });
});

describe("wheelAt", () => {
  it("zooms in on a wheel up and out on a wheel down, around the cursor", () => {
    const zoomedIn = wheelAt(FIT, -100, false, { x: 0, y: 0 }, STAGE, FITTED, MAX);
    expect(zoomedIn.scale).toBeCloseTo(Math.exp(0.2));
    expect(wheelAt(zoomedIn, 100, false, { x: 0, y: 0 }, STAGE, FITTED, MAX).scale).toBeCloseTo(1);
  });

  it("zooms faster per unit for a trackpad pinch, whose deltas are small", () => {
    expect(wheelAt(FIT, -10, true, { x: 0, y: 0 }, STAGE, FITTED, MAX).scale).toBeCloseTo(Math.exp(0.1));
  });

  it("stays between fit and the maximum", () => {
    expect(wheelAt(FIT, 1000, false, { x: 0, y: 0 }, STAGE, FITTED, MAX)).toEqual(FIT);
    expect(wheelAt(FIT, -100000, false, { x: 0, y: 0 }, STAGE, FITTED, MAX).scale).toBe(MAX);
  });

  it("keeps the point under the cursor in place where the edges allow", () => {
    const zoomed = wheelAt({ scale: 3, x: 0, y: 0 }, -100, false, { x: 50, y: 0 }, STAGE, FITTED, MAX);
    expect(50 - (50 - 0) * (zoomed.scale / 3)).toBeCloseTo(zoomed.x);
  });
});

describe("toggleRealSize", () => {
  it("shows the image's real pixels from fit, centred", () => {
    expect(toggleRealSize(FIT, 0.2, STAGE, FITTED, MAX)).toEqual({ scale: 5, x: 0, y: 0 });
  });

  it("goes back to fit from any zoom", () => {
    expect(toggleRealSize({ scale: 5, x: 30, y: 0 }, 0.2, STAGE, FITTED, MAX)).toBe(FIT);
  });

  it("stays at fit when the real size is smaller than fit", () => {
    expect(toggleRealSize(FIT, 4, STAGE, FITTED, MAX)).toEqual(FIT);
  });
});

describe("swipeTarget", () => {
  it("moves to the next image on a swipe left past a fifth of the stage, the previous on a swipe right", () => {
    expect(swipeTarget(1, 3, -81, 0, 400)).toBe(2);
    expect(swipeTarget(1, 3, 81, 0, 400)).toBe(0);
  });

  it("stays on a short, slow drag", () => {
    expect(swipeTarget(1, 3, -79, 0, 400)).toBe(1);
    expect(swipeTarget(1, 3, 0, 0, 400)).toBe(1);
  });

  it("moves on a fling that is short but fast, not on a twitch", () => {
    expect(swipeTarget(1, 3, -30, -0.8, 400)).toBe(2);
    expect(swipeTarget(1, 3, -10, -2, 400)).toBe(1);
  });

  it("stops at the first and last image", () => {
    expect(swipeTarget(0, 3, 200, 0, 400)).toBe(0);
    expect(swipeTarget(2, 3, -200, 0, 400)).toBe(2);
    expect(swipeTarget(0, 1, -200, 0, 400)).toBe(0);
    expect(swipeTarget(0, 0, -200, 0, 400)).toBe(0);
  });
});

describe("taps", () => {
  it("is a tap when short and still", () => {
    expect(isTap(3, 4, 100)).toBe(true);
    expect(isTap(8, 8, 100)).toBe(false);
    expect(isTap(0, 0, 400)).toBe(false);
  });

  it("is a double-tap when the second tap comes soon and near", () => {
    const first = { at: { x: 0, y: 0 }, time: 1000 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { at: { x: 10, y: 10 }, time: 1200 })).toBe(true);
    expect(isDoubleTap(first, { at: { x: 10, y: 10 }, time: 1400 })).toBe(false);
    expect(isDoubleTap(first, { at: { x: 50, y: 0 }, time: 1100 })).toBe(false);
  });

  it("knows a tap on the backdrop from a tap on the image", () => {
    expect(isOutsideImage({ x: 0, y: 0 }, FIT, FITTED)).toBe(false);
    expect(isOutsideImage({ x: 0, y: 150 }, FIT, FITTED)).toBe(true);
    expect(isOutsideImage({ x: 199, y: 99 }, FIT, FITTED)).toBe(false);
    // Zoomed 2× and moved left, the image covers the stage's width.
    expect(isOutsideImage({ x: -390, y: 0 }, { scale: 2, x: -200, y: 0 }, FITTED)).toBe(false);
    expect(isOutsideImage({ x: 0, y: 250 }, { scale: 2, x: -200, y: 0 }, FITTED)).toBe(true);
  });
});
