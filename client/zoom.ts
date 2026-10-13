/**
 * The arithmetic of the enlarged image view (TR-033): pinch, pan, double-tap, wheel, fit and 100%,
 * swipe between images, and whether a tap missed the image. Pure, so every gesture's outcome is
 * tested here and the view only feeds it touches.
 *
 * The image is drawn at its fit size, centred in the stage, then moved by a transform: `scale`
 * relative to fit (1 is fit) and an offset `x`, `y` of the image's centre from the stage's centre.
 * Points are in stage coordinates measured from the stage's centre. The gesture functions at the end
 * turn touches into transforms and outcomes, so the view's responder only passes them along.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export const FIT: Transform = { scale: 1, x: 0, y: 0 };

/** Where a double-tap at fit zooms to, relative to fit. */
export const DOUBLE_TAP_SCALE = 2.5;
/** Zoom never goes past this multiple of fit, nor past twice the image's real size, whichever is larger. */
const MAX_FIT_MULTIPLE = 4;
const MAX_REAL_MULTIPLE = 2;
/** Within this of fit the image counts as at fit: rounding after a pinch back should not leave it "zoomed". */
const FIT_TOLERANCE = 0.01;
/** A press that moves less than this and lasts less than `TAP_DURATION_MS` is a tap. */
export const TAP_SLOP = 10;
export const TAP_DURATION_MS = 250;
/** Two taps within this time and distance are a double-tap. */
export const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;
/** A swipe moves to the next image past this share of the stage's width, or when flung this fast (points per millisecond). */
const SWIPE_SHARE = 0.2;
const SWIPE_VELOCITY = 0.5;
const SWIPE_MIN_DISTANCE = 20;
/** How strongly a wheel step zooms: a trackpad pinch (ctrl on the web) reports small deltas, a wheel large ones. */
const WHEEL_RATE = 0.002;
const PINCH_WHEEL_RATE = 0.01;

/** Everything a transform is bounded by: the stage, the image at fit, and how far it may zoom out and in. */
export interface Frame {
  stage: Size;
  fitted: Size;
  /** Stage points per image pixel at fit. */
  pointsPerPixel: number;
  /** Fit, or the image's real size when that is smaller (a small image is enlarged to fit). */
  minimum: number;
  maximum: number;
}

/** The frame of an image in a stage; empty (nothing to draw) before either is measured. */
export function frameOf(stage: Size, image: Size | null): Frame {
  const empty = { stage, fitted: { width: 0, height: 0 }, pointsPerPixel: 1, minimum: 1, maximum: maxScale(1) };
  if (image === null || stage.width <= 0 || stage.height <= 0 || image.width <= 0 || image.height <= 0) return empty;
  const pointsPerPixel = Math.min(stage.width / image.width, stage.height / image.height);
  return {
    stage,
    fitted: { width: image.width * pointsPerPixel, height: image.height * pointsPerPixel },
    pointsPerPixel,
    minimum: Math.min(1, realScale(pointsPerPixel)),
    maximum: maxScale(pointsPerPixel),
  };
}

/** The scale, relative to fit, at which one image pixel is one point: "100%". */
export function realScale(pointsPerPixel: number): number {
  return pointsPerPixel > 0 ? 1 / pointsPerPixel : 1;
}

export function maxScale(pointsPerPixel: number): number {
  return Math.max(MAX_FIT_MULTIPLE, MAX_REAL_MULTIPLE * realScale(pointsPerPixel));
}

export function isAtFit(transform: Transform): boolean {
  return Math.abs(transform.scale - 1) <= FIT_TOLERANCE;
}

/** Larger than fit: a one-finger drag pans instead of swiping to the next image. */
export function isZoomedIn(transform: Transform): boolean {
  return transform.scale > 1 + FIT_TOLERANCE;
}

/** The zoom as the user reads it: percent of the image's real size. */
export function zoomPercent(transform: Transform, pointsPerPixel: number): number {
  return Math.round(transform.scale * pointsPerPixel * 100);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Keeps the scale within the frame's bounds, and the image's edges from coming inside the stage's edges. */
export function clampTransform(transform: Transform, frame: Frame): Transform {
  const { stage, fitted } = frame;
  const scale = clamp(transform.scale, frame.minimum, frame.maximum);
  const reachX = Math.max(0, (fitted.width * scale - stage.width) / 2);
  const reachY = Math.max(0, (fitted.height * scale - stage.height) / 2);
  // `+ 0` turns a -0 from an axis with no reach into 0.
  return { scale, x: clamp(transform.x, -reachX, reachX) + 0, y: clamp(transform.y, -reachY, reachY) + 0 };
}

/** Zooms to `scale` keeping the image point under `focus` under it. Unclamped. */
export function zoomAround(transform: Transform, scale: number, focus: Point): Transform {
  const ratio = scale / transform.scale;
  return { scale, x: focus.x - (focus.x - transform.x) * ratio, y: focus.y - (focus.y - transform.y) * ratio };
}

/** Moves the image by a drag from where it started. Unclamped. */
export function panBy(start: Transform, delta: Point): Transform {
  return { scale: start.scale, x: start.x + delta.x, y: start.y + delta.y };
}

export interface Pinch {
  /** The transform when the two fingers came down. */
  start: Transform;
  distance: number;
  middle: Point;
}

export function distanceOf(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function middleOf(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

/**
 * The transform while two fingers pinch: the image point that was between them stays between them,
 * scaled by how far apart they have moved, so the fingers zoom and pan at once. Unclamped.
 */
export function pinchTo(pinch: Pinch, distance: number, middle: Point): Transform {
  if (pinch.distance <= 0) return pinch.start;
  const scale = pinch.start.scale * (distance / pinch.distance);
  const zoomed = zoomAround(pinch.start, scale, pinch.middle);
  return panBy(zoomed, { x: middle.x - pinch.middle.x, y: middle.y - pinch.middle.y });
}

/** A double-tap: at fit, in to `DOUBLE_TAP_SCALE` around the tap; at any other zoom, back to fit. */
export function doubleTapAt(transform: Transform, point: Point, frame: Frame): Transform {
  if (!isAtFit(transform)) return FIT;
  return clampTransform(zoomAround(FIT, Math.min(DOUBLE_TAP_SCALE, frame.maximum), point), frame);
}

/** A wheel step (or a trackpad pinch, which the web reports as a wheel with ctrl held) zooms around the cursor. */
export function wheelAt(transform: Transform, deltaY: number, pinch: boolean, point: Point, frame: Frame): Transform {
  const factor = Math.exp(-deltaY * (pinch ? PINCH_WHEEL_RATE : WHEEL_RATE));
  const scale = clamp(transform.scale * factor, frame.minimum, frame.maximum);
  return clampTransform(zoomAround(transform, scale, point), frame);
}

/** The Fit / 100% toggle: at fit, the image's real pixels around the centre (smaller than fit for a small image); otherwise back to fit. */
export function toggleRealSize(transform: Transform, frame: Frame): Transform {
  if (!isAtFit(transform)) return FIT;
  return clampTransform(zoomAround(FIT, realScale(frame.pointsPerPixel), { x: 0, y: 0 }), frame);
}

/** Which image a horizontal swipe lands on: the next or previous past a threshold, else the same. */
export function swipeTarget(index: number, count: number, dx: number, vx: number, stageWidth: number): number {
  const far = Math.abs(dx) > stageWidth * SWIPE_SHARE;
  const flung = Math.abs(vx) > SWIPE_VELOCITY && Math.abs(dx) > SWIPE_MIN_DISTANCE;
  if (!far && !flung) return index;
  return clamp(index + (dx < 0 ? 1 : -1), 0, Math.max(0, count - 1));
}

export function isTap(dx: number, dy: number, durationMs: number): boolean {
  return Math.hypot(dx, dy) < TAP_SLOP && durationMs < TAP_DURATION_MS;
}

export interface Tap {
  at: Point;
  time: number;
}

export function isDoubleTap(previous: Tap | null, tap: Tap): boolean {
  return previous !== null && tap.time - previous.time < DOUBLE_TAP_MS && distanceOf(previous.at, tap.at) < DOUBLE_TAP_SLOP;
}

/** Whether a point falls outside the drawn image: a tap there is on the backdrop, and closes the view. */
export function isOutsideImage(point: Point, transform: Transform, fitted: Size): boolean {
  const halfWidth = (fitted.width * transform.scale) / 2;
  const halfHeight = (fitted.height * transform.scale) / 2;
  return Math.abs(point.x - transform.x) > halfWidth || Math.abs(point.y - transform.y) > halfHeight;
}

/** A gesture from the first finger down to the last finger up. */
export interface Gesture {
  /** The transform the current one- or two-finger phase began from. */
  start: Transform;
  /** Where the one finger was when that phase began. */
  from: Point;
  startedAt: number;
  pinch: Pinch | null;
  /** Two fingers touched at some point: the gesture's end is neither a tap nor a swipe. */
  pinched: boolean;
}

function pinchOf(transform: Transform, points: readonly Point[]): Pinch | null {
  const [first, second] = points;
  if (first === undefined || second === undefined) return null;
  return { start: transform, distance: distanceOf(first, second), middle: middleOf(first, second) };
}

export function gestureStart(transform: Transform, points: readonly Point[], time: number): Gesture {
  const pinch = pinchOf(transform, points);
  return { start: transform, from: points[0] ?? { x: 0, y: 0 }, startedAt: time, pinch, pinched: pinch !== null };
}

/**
 * A move of the touching fingers: two pinch; one pans a zoomed image, or at fit carries it sideways
 * towards its neighbour. When a second finger lands or one of two lifts, the new phase starts from
 * where the image is, so it does not jump. `transform` is null when the image stays put.
 */
export function gestureMove(gesture: Gesture, current: Transform, points: readonly Point[], count: number, frame: Frame): { gesture: Gesture; transform: Transform | null } {
  const [first, second] = points;
  if (first === undefined) return { gesture, transform: null };
  if (second !== undefined) {
    const pinch = gesture.pinch ?? pinchOf(current, points);
    const next = { ...gesture, pinch, pinched: true };
    return { gesture: next, transform: pinch === null ? null : clampTransform(pinchTo(pinch, distanceOf(first, second), middleOf(first, second)), frame) };
  }
  const phase = gesture.pinch === null ? gesture : { ...gesture, pinch: null, start: current, from: first };
  const delta = { x: first.x - phase.from.x, y: first.y - phase.from.y };
  if (isZoomedIn(phase.start)) return { gesture: phase, transform: clampTransform(panBy(phase.start, delta), frame) };
  if (!phase.pinched && count > 1) return { gesture: phase, transform: { scale: phase.start.scale, x: phase.start.x + delta.x, y: phase.start.y } };
  return { gesture: phase, transform: null };
}

export type GestureEnd =
  /** A tap at this point: see `tapOutcome`. */
  | { kind: "tap"; at: Point }
  /** A swipe to another image. */
  | { kind: "show"; index: number }
  /** Ease to this transform. */
  | { kind: "settle"; transform: Transform }
  | { kind: "stay" };

/** What the last finger lifting means. `moved` is the gesture's travel and speed since it began. */
export function gestureEnd(gesture: Gesture, current: Transform, moved: { dx: number; dy: number; vx: number }, time: number, index: number, count: number, frame: Frame): GestureEnd {
  // A pinch let go within a hair of fit lands exactly on it.
  if (gesture.pinched) return isAtFit(current) ? { kind: "settle", transform: FIT } : { kind: "stay" };
  if (isTap(moved.dx, moved.dy, time - gesture.startedAt)) return { kind: "tap", at: gesture.from };
  if (isZoomedIn(gesture.start)) return { kind: "stay" };
  const target = swipeTarget(index, count, moved.dx, moved.vx, frame.stage.width);
  return target === index ? { kind: "settle", transform: gesture.start } : { kind: "show", index: target };
}

export type TapOutcome = { kind: "zoom"; transform: Transform } | { kind: "close" } | { kind: "none" };

/**
 * A tap: the second of a double-tap zooms; a single tap on the backdrop closes (the view waits
 * `DOUBLE_TAP_MS` first, in case a second tap follows); a single tap on the image does nothing.
 */
export function tapOutcome(previous: Tap | null, tap: Tap, current: Transform, frame: Frame): TapOutcome {
  if (isDoubleTap(previous, tap)) return { kind: "zoom", transform: doubleTapAt(current, tap.at, frame) };
  return isOutsideImage(tap.at, current, frame.fitted) ? { kind: "close" } : { kind: "none" };
}
