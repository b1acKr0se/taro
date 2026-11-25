/**
 * The fold run through Yoga, the layout engine React Native lays a phone's views out with, as many times as a phone
 * would redraw it: measure the body, decide the fold, lay out again. The text measure caps an at-most height as the
 * platforms do (React Native's Android `TextLayoutManager.kt` and iOS `layoutConstraints.clamp`); a web browser never
 * does, which is why the fold looped on the phone only (the chat flickered and the app crashed).
 */
import { describe, expect, it } from "vitest";
import Yoga, { MeasureMode, Overflow, type Node } from "yoga-layout";
import { foldClipStyle, foldHeight, foldState, settleMeasure, USER_FOLD_LINES } from "./received-fold";

const LINE = 22;
const WIDTH = 300;

/** A body of `lines` lines in the transcript's scroll view, clipped as `clip` says; the height it measures and the height shown. */
function layOut(lines: number, clip: { maxHeight: number; overflow: "hidden" | "scroll" } | undefined): { measured: number; shown: number } {
  const transcript: Node = Yoga.Node.create();
  transcript.setWidth(WIDTH);
  transcript.setOverflow(Overflow.Scroll);
  const box = Yoga.Node.create();
  if (clip !== undefined) {
    box.setMaxHeight(clip.maxHeight);
    box.setOverflow(clip.overflow === "scroll" ? Overflow.Scroll : Overflow.Hidden);
  }
  const body = Yoga.Node.create();
  body.setFlexShrink(0);
  const text = Yoga.Node.create();
  text.setMeasureFunc((width, _widthMode, height, heightMode) => {
    const natural = lines * LINE;
    return { width, height: heightMode === MeasureMode.AtMost && natural > height ? height : natural };
  });
  body.insertChild(text, 0);
  box.insertChild(body, 0);
  transcript.insertChild(box, 0);
  transcript.calculateLayout(WIDTH, undefined);
  const result = { measured: body.getComputedHeight(), shown: box.getComputedHeight() };
  transcript.freeRecursive();
  return result;
}

/** What a phone draws over `passes` redraws of a body of `lines` lines: whether it was folded and the height shown. */
function redraws(lines: number, passes: number): { folded: boolean; shown: number }[] {
  const fold = foldHeight(LINE, USER_FOLD_LINES);
  let natural: number | null = null;
  return Array.from({ length: passes }, () => {
    const { folded } = foldState(true, natural, false, LINE, USER_FOLD_LINES);
    const clip = folded ? foldClipStyle(fold, false) : undefined;
    const { measured, shown } = layOut(lines, clip);
    natural = settleMeasure(measured, clip === undefined ? null : clip.maxHeight, fold);
    return { folded, shown };
  });
}

describe("the fold on a phone's layout engine", () => {
  it("settles a long message folded at the first measure, instead of folding and unfolding on every redraw", () => {
    const frames = redraws(24, 6);
    expect(frames.map((frame) => frame.folded)).toEqual([true, true, true, true, true, true]);
    expect(new Set(frames.map((frame) => frame.shown))).toEqual(new Set([foldHeight(LINE, USER_FOLD_LINES)]));
  });

  it("lets a message that fits settle open", () => {
    const frames = redraws(4, 4);
    expect(frames.slice(1).map((frame) => frame.folded)).toEqual([false, false, false]);
    expect(frames[frames.length - 1]?.shown).toBe(4 * LINE);
  });

  it("measures a folded body at its full height on the phone, as Paseo's fold clips", () => {
    expect(layOut(24, foldClipStyle(foldHeight(LINE, USER_FOLD_LINES), false)).measured).toBe(24 * LINE);
  });

  it("keeps a body folded when a clipped measure comes back exactly at the clip, the case a platform's cap produces", () => {
    const fold = foldHeight(LINE, USER_FOLD_LINES);
    expect(foldState(true, settleMeasure(fold, fold, fold), false, LINE, USER_FOLD_LINES).folded).toBe(true);
    expect(foldState(true, settleMeasure(fold - LINE, fold, fold), false, LINE, USER_FOLD_LINES).folded).toBe(false);
  });
});
