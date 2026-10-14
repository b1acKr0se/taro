import { describe, expect, it } from "vitest";

import {
  FIT,
  clampTransform,
  doubleTapAt,
  frameOf,
  settleEasing,
  transformBetween,
  gestureEnd,
  gestureMove,
  gestureStart,
  isAtFit,
  isDoubleTap,
  isOutsideImage,
  isTap,
  isZoomedIn,
  maxScale,
  pinchTo,
  realScale,
  swipeTarget,
  tapOutcome,
  toggleRealSize,
  wheelAt,
  zoomAround,
  type Gesture,
} from "./zoom";

// A phone-shaped stage and a wide screenshot: fit is 400×200 points, a fifth of a point per pixel.
const STAGE = { width: 400, height: 800 };
const FRAME = frameOf(STAGE, { width: 2000, height: 1000 });
// A small screenshot, enlarged four times to fit: its real size is a quarter of fit.
const SMALL = frameOf(STAGE, { width: 100, height: 100 });
const CENTRE = { x: 0, y: 0 };

describe("frameOf, realScale, maxScale", () => {
  it("fits the image inside the stage keeping its shape", () => {
    expect(FRAME).toEqual({ stage: STAGE, fitted: { width: 400, height: 200 }, pointsPerPixel: 0.2, minimum: 1, maximum: 10 });
    expect(frameOf({ width: 1000, height: 500 }, { width: 500, height: 1000 }).fitted).toEqual({ width: 250, height: 500 });
  });

  it("enlarges a small image to fit, and lets it zoom out to its real size", () => {
    expect(SMALL.pointsPerPixel).toBe(4);
    expect(SMALL.minimum).toBe(0.25);
    expect(SMALL.maximum).toBe(4);
  });

  it("is empty before the stage or the image is measured", () => {
    expect(frameOf({ width: 0, height: 0 }, { width: 10, height: 10 }).fitted).toEqual({ width: 0, height: 0 });
    expect(frameOf(STAGE, { width: 0, height: 10 }).fitted).toEqual({ width: 0, height: 0 });
    expect(frameOf(STAGE, null)).toMatchObject({ fitted: { width: 0, height: 0 }, pointsPerPixel: 1, minimum: 1 });
    expect(realScale(0)).toBe(1);
  });

  it("allows the larger of 4× fit and twice the real size", () => {
    expect(realScale(0.2)).toBe(5);
    expect(maxScale(0.2)).toBe(10);
    expect(maxScale(1)).toBe(4);
    expect(maxScale(4)).toBe(4);
  });

  it("tells fit, zoomed in and zoomed out apart, a hair counting as fit", () => {
    expect(isAtFit({ scale: 1.005, x: 0, y: 0 })).toBe(true);
    expect(isAtFit({ scale: 0.995, x: 0, y: 0 })).toBe(true);
    expect(isZoomedIn({ scale: 1.005, x: 0, y: 0 })).toBe(false);
    expect(isZoomedIn({ scale: 1.5, x: 0, y: 0 })).toBe(true);
    expect(isAtFit({ scale: 0.25, x: 0, y: 0 })).toBe(false);
    expect(isZoomedIn({ scale: 0.25, x: 0, y: 0 })).toBe(false);
  });
});

describe("clampTransform", () => {
  it("never zooms out past fit (or the real size, if smaller) nor in past the maximum", () => {
    expect(clampTransform({ scale: 0.5, x: 10, y: 10 }, FRAME)).toEqual(FIT);
    expect(clampTransform({ scale: 50, x: 0, y: 0 }, FRAME).scale).toBe(10);
    expect(clampTransform({ scale: 0.1, x: 10, y: 10 }, SMALL)).toEqual({ scale: 0.25, x: 0, y: 0 });
  });

  it("keeps the image's edges outside the stage's edges, per axis", () => {
    // At 2×, the image is 800×400: it may move 200 sideways, and not at all up or down (400 < 800).
    expect(clampTransform({ scale: 2, x: 500, y: 300 }, FRAME)).toEqual({ scale: 2, x: 200, y: 0 });
    expect(clampTransform({ scale: 2, x: -500, y: -300 }, FRAME)).toEqual({ scale: 2, x: -200, y: 0 });
    // At 6×, 2400×1200: 1000 sideways, 200 up or down.
    expect(clampTransform({ scale: 6, x: 50, y: -999 }, FRAME)).toEqual({ scale: 6, x: 50, y: -200 });
  });
});

describe("zoomAround", () => {
  it("keeps the point under the focus where it was", () => {
    // The image point at (100, 50) was 100 right of the image's centre; at 2× it is 200 right, so the centre moves 100 left.
    expect(zoomAround(FIT, 2, { x: 100, y: 50 })).toEqual({ scale: 2, x: -100, y: -50 });
    expect(zoomAround({ scale: 2, x: -100, y: -50 }, 1, { x: 100, y: 50 })).toEqual(FIT);
  });
});

describe("pinchTo", () => {
  const pinch = { start: FIT, distance: 100, middle: CENTRE };

  it("scales by how far the fingers moved apart, around their middle", () => {
    expect(pinchTo(pinch, 200, CENTRE)).toEqual({ scale: 2, x: 0, y: 0 });
    expect(pinchTo({ ...pinch, middle: { x: 100, y: 0 } }, 300, { x: 100, y: 0 })).toEqual({ scale: 3, x: -200, y: 0 });
  });

  it("pans with the fingers' middle while pinching", () => {
    expect(pinchTo(pinch, 100, { x: 30, y: -20 })).toEqual({ scale: 1, x: 30, y: -20 });
  });

  it("builds on the transform at the start of the pinch", () => {
    expect(pinchTo({ start: { scale: 2, x: 0, y: 0 }, distance: 100, middle: CENTRE }, 50, CENTRE).scale).toBe(1);
  });

  it("ignores a pinch that started with the fingers together", () => {
    expect(pinchTo({ ...pinch, distance: 0 }, 300, { x: 5, y: 5 })).toBe(FIT);
  });
});

describe("doubleTapAt", () => {
  it("zooms in to 2.5× at the tapped point from fit, clamped to the edges", () => {
    expect(doubleTapAt(FIT, { x: 40, y: 20 }, FRAME)).toEqual({ scale: 2.5, x: -60, y: 0 });
    // Tapped at the image's far right edge: the right edge stays at the stage's right edge.
    expect(doubleTapAt(FIT, { x: 200, y: 0 }, FRAME)).toEqual({ scale: 2.5, x: -300, y: 0 });
    expect(doubleTapAt({ scale: 1.005, x: 0, y: 0 }, CENTRE, FRAME).scale).toBe(2.5);
  });

  it("goes back to fit from any other zoom, out as well as in", () => {
    expect(doubleTapAt({ scale: 2.5, x: -60, y: 0 }, CENTRE, FRAME)).toBe(FIT);
    expect(doubleTapAt({ scale: 1.5, x: 0, y: 0 }, CENTRE, FRAME)).toBe(FIT);
    expect(doubleTapAt({ scale: 0.25, x: 0, y: 0 }, CENTRE, SMALL)).toBe(FIT);
  });

  it("stops at the maximum when it is below 2.5×", () => {
    expect(doubleTapAt(FIT, CENTRE, { ...FRAME, maximum: 2 }).scale).toBe(2);
  });
});

describe("wheelAt", () => {
  it("zooms in on a wheel up and out on a wheel down, around the cursor", () => {
    const zoomedIn = wheelAt(FIT, -100, false, CENTRE, FRAME);
    expect(zoomedIn.scale).toBeCloseTo(Math.exp(0.2));
    expect(wheelAt(zoomedIn, 100, false, CENTRE, FRAME).scale).toBeCloseTo(1);
  });

  it("zooms faster per unit for a trackpad pinch, whose deltas are small", () => {
    expect(wheelAt(FIT, -10, true, CENTRE, FRAME).scale).toBeCloseTo(Math.exp(0.1));
  });

  it("stays within the frame's bounds", () => {
    expect(wheelAt(FIT, 1000, false, CENTRE, FRAME)).toEqual(FIT);
    expect(wheelAt(FIT, -100000, false, CENTRE, FRAME).scale).toBe(10);
    expect(wheelAt(FIT, 100000, false, CENTRE, SMALL).scale).toBe(0.25);
  });

  it("keeps the point under the cursor in place where the edges allow", () => {
    const zoomed = wheelAt({ scale: 3, x: 0, y: 0 }, -100, false, { x: 50, y: 0 }, FRAME);
    expect(50 - 50 * (zoomed.scale / 3)).toBeCloseTo(zoomed.x);
  });
});

describe("toggleRealSize", () => {
  it("shows a large image's real pixels from fit, centred", () => {
    expect(toggleRealSize(FIT, FRAME)).toEqual({ scale: 5, x: 0, y: 0 });
  });

  it("shows a small image at its real size, smaller than fit", () => {
    const real = toggleRealSize(FIT, SMALL);
    expect(real).toEqual({ scale: 0.25, x: 0, y: 0 });
    expect(real.scale * SMALL.pointsPerPixel).toBe(1);
    expect(toggleRealSize(real, SMALL)).toBe(FIT);
  });

  it("goes back to fit from any zoom", () => {
    expect(toggleRealSize({ scale: 5, x: 30, y: 0 }, FRAME)).toBe(FIT);
    expect(toggleRealSize({ scale: 2, x: 0, y: 0 }, FRAME)).toBe(FIT);
  });

  it("stays at fit when the image's real size is fit", () => {
    expect(toggleRealSize(FIT, frameOf(STAGE, { width: 400, height: 200 }))).toEqual(FIT);
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
    const first = { at: CENTRE, time: 1000 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { at: { x: 10, y: 10 }, time: 1200 })).toBe(true);
    expect(isDoubleTap(first, { at: { x: 10, y: 10 }, time: 1400 })).toBe(false);
    expect(isDoubleTap(first, { at: { x: 50, y: 0 }, time: 1100 })).toBe(false);
  });

  it("knows a tap on the backdrop from a tap on the image", () => {
    expect(isOutsideImage(CENTRE, FIT, FRAME.fitted)).toBe(false);
    expect(isOutsideImage({ x: 0, y: 150 }, FIT, FRAME.fitted)).toBe(true);
    expect(isOutsideImage({ x: 199, y: 99 }, FIT, FRAME.fitted)).toBe(false);
    // Zoomed 2× and moved left, the image covers the stage's width.
    expect(isOutsideImage({ x: -390, y: 0 }, { scale: 2, x: -200, y: 0 }, FRAME.fitted)).toBe(false);
    expect(isOutsideImage({ x: 0, y: 250 }, { scale: 2, x: -200, y: 0 }, FRAME.fitted)).toBe(true);
  });

  it("zooms on a double-tap, closes on a backdrop tap, and ignores a tap on the image", () => {
    const first = { at: CENTRE, time: 1000 };
    expect(tapOutcome(first, { at: CENTRE, time: 1100 }, FIT, FRAME)).toEqual({ kind: "zoom", transform: { scale: 2.5, x: 0, y: 0 } });
    expect(tapOutcome(null, { at: { x: 0, y: 300 }, time: 1000 }, FIT, FRAME)).toEqual({ kind: "close" });
    expect(tapOutcome(null, first, FIT, FRAME)).toEqual({ kind: "none" });
    // A double-tap on the backdrop zooms rather than closes.
    expect(tapOutcome({ at: { x: 0, y: 300 }, time: 1000 }, { at: { x: 0, y: 300 }, time: 1100 }, FIT, FRAME).kind).toBe("zoom");
  });
});

describe("gestures", () => {
  const one = (x: number, y = 0) => [{ x, y }];
  const two = (left: number, right: number) => [
    { x: left, y: 0 },
    { x: right, y: 0 },
  ];
  /** Runs moves from `start` and returns the gesture and the image's transform after the last. */
  function run(start: Gesture, from: typeof FIT, moves: { x: number; y: number }[][], count = 3) {
    let gesture = start;
    let transform = from;
    for (const points of moves) {
      const step = gestureMove(gesture, transform, points, count, FRAME);
      gesture = step.gesture;
      transform = step.transform ?? transform;
    }
    return { gesture, transform };
  }

  it("pinches from two fingers that land together", () => {
    const { transform, gesture } = run(gestureStart(FIT, two(-50, 50), 0), FIT, [two(-100, 100)]);
    expect(transform).toEqual({ scale: 2, x: 0, y: 0 });
    expect(gesture.pinched).toBe(true);
  });

  it("starts the pinch where the image is when the second finger lands later", () => {
    const zoomed = { scale: 2, x: 100, y: 0 };
    const { transform } = run(gestureStart(zoomed, one(0), 0), zoomed, [one(0), two(-50, 50), two(-100, 100)]);
    expect(transform).toEqual(clampTransform(zoomAround(zoomed, 4, CENTRE), FRAME));
  });

  it("pans on from where the pinch left the image when one of two fingers lifts", () => {
    const pinched = run(gestureStart(FIT, two(-50, 50), 0), FIT, [two(-150, 150)]);
    expect(pinched.transform).toEqual({ scale: 3, x: 0, y: 0 });
    // The remaining finger is at 150 and moves to 100: the image moves 50 left, not by the jump from 0 to 150.
    const panned = run(pinched.gesture, pinched.transform, [one(150), one(100)]);
    expect(panned.transform).toEqual({ scale: 3, x: -50, y: 0 });
  });

  it("pans a zoomed image within its edges", () => {
    const zoomed = { scale: 2, x: 0, y: 0 };
    expect(run(gestureStart(zoomed, one(0), 0), zoomed, [one(-80, 40)]).transform).toEqual({ scale: 2, x: -80, y: 0 });
    expect(run(gestureStart(zoomed, one(0), 0), zoomed, [one(-900)]).transform).toEqual({ scale: 2, x: -200, y: 0 });
  });

  it("carries the image sideways at fit only when there is a neighbour to swipe to", () => {
    expect(run(gestureStart(FIT, one(0), 0), FIT, [one(-60, 30)]).transform).toEqual({ scale: 1, x: -60, y: 0 });
    expect(run(gestureStart(FIT, one(0), 0), FIT, [one(-60, 30)], 1).transform).toBe(FIT);
  });

  it("ignores a move with no fingers", () => {
    const start = gestureStart(FIT, one(0), 0);
    expect(gestureMove(start, FIT, [], 3, FRAME)).toEqual({ gesture: start, transform: null });
  });

  it("ends a still, short press as a tap where it began", () => {
    expect(gestureEnd(gestureStart(FIT, one(30, 10), 0), FIT, { dx: 2, dy: 1, vx: 0 }, 100, 1, 3, FRAME)).toEqual({ kind: "tap", at: { x: 30, y: 10 } });
  });

  it("ends a long sideways drag at fit on the neighbour, a short one back where it was", () => {
    const start = gestureStart(FIT, one(0), 0);
    expect(gestureEnd(start, { scale: 1, x: -150, y: 0 }, { dx: -150, dy: 0, vx: 0 }, 400, 1, 3, FRAME)).toEqual({ kind: "show", index: 2 });
    expect(gestureEnd(start, { scale: 1, x: -40, y: 0 }, { dx: -40, dy: 0, vx: 0 }, 400, 1, 3, FRAME)).toEqual({ kind: "settle", transform: FIT });
  });

  it("swipes from a small image shown at its real size, and settles back to that size", () => {
    const real = { scale: 0.25, x: 0, y: 0 };
    const start = gestureStart(real, one(0), 0);
    expect(gestureMove(start, real, one(-60), 3, SMALL).transform).toEqual({ scale: 0.25, x: -60, y: 0 });
    expect(gestureEnd(start, real, { dx: -40, dy: 0, vx: 0 }, 400, 1, 3, SMALL)).toEqual({ kind: "settle", transform: real });
  });

  it("never swipes from a zoomed image, nor after a pinch", () => {
    const zoomed = { scale: 2, x: 0, y: 0 };
    expect(gestureEnd(gestureStart(zoomed, one(0), 0), zoomed, { dx: -300, dy: 0, vx: -2 }, 400, 1, 3, FRAME)).toEqual({ kind: "stay" });
    expect(gestureEnd(gestureStart(FIT, two(-50, 50), 0), zoomed, { dx: -300, dy: 0, vx: -2 }, 400, 1, 3, FRAME)).toEqual({ kind: "stay" });
  });

  it("lands a pinch let go within a hair of fit exactly on fit", () => {
    expect(gestureEnd(gestureStart(FIT, two(-50, 50), 0), { scale: 1.004, x: 1, y: 0 }, { dx: 0, dy: 0, vx: 0 }, 400, 0, 3, FRAME)).toEqual({ kind: "settle", transform: FIT });
  });
});

describe("frameOf with an inset", () => {
  it("fits the image inside the inset on each side and keeps the full stage", () => {
    const frame = frameOf({ width: 400, height: 800 }, { width: 400, height: 800 }, { width: 0, height: 100 });
    expect(frame.stage).toEqual({ width: 400, height: 800 });
    expect(frame.fitted).toEqual({ width: 300, height: 600 });
    expect(frame.pointsPerPixel).toBe(0.75);
  });
  it("lets a zoomed image reach the stage's edges, past the inset", () => {
    const frame = frameOf({ width: 400, height: 800 }, { width: 400, height: 800 }, { width: 0, height: 100 });
    expect(clampTransform({ scale: 2, x: 0, y: 1000 }, frame)).toEqual({ scale: 2, x: 0, y: 200 });
  });
  it("is empty when the inset leaves no room, and ignores a negative inset", () => {
    expect(frameOf({ width: 400, height: 200 }, { width: 10, height: 10 }, { width: 0, height: 100 }).fitted).toEqual({ width: 0, height: 0 });
    expect(frameOf({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: -50, height: -50 }).fitted).toEqual({ width: 400, height: 200 });
  });
});

describe("settleEasing and transformBetween", () => {
  it("runs from 0 to 1, slowing towards the end, and holds outside the move", () => {
    expect(settleEasing(0)).toBe(0);
    expect(settleEasing(1)).toBe(1);
    expect(settleEasing(0.5)).toBeCloseTo(0.875);
    expect(settleEasing(-1)).toBe(0);
    expect(settleEasing(2)).toBe(1);
  });
  it("places the image between the two transforms by the eased progress", () => {
    const to = { scale: 3, x: 100, y: -40 };
    expect(transformBetween(FIT, to, 0)).toEqual(FIT);
    expect(transformBetween(FIT, to, 1)).toEqual(to);
    expect(transformBetween(FIT, to, 0.5)).toEqual({ scale: 2.75, x: 87.5, y: -35 });
    expect(transformBetween(FIT, to, 5)).toEqual(to);
  });
});
