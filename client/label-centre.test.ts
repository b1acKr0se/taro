/**
 * A one-line label's capitals sit on its line's middle on the phone (TR-092). React Native centres a
 * line on the font's ascent and descent; these lines are what `onTextLayout` reports for a 13-point
 * label with an 18-point line (`labelLineHeightFor(13)`), from the font's metrics in em.
 */
import { describe, expect, it, vi } from "vitest";

import { capCentreShift, createShiftStore, labelFontKey, type LabelLine } from "./label-centre";
import { FONT_SIZE, labelLineHeightFor } from "./type-scale";

/** The line React Native lays out: half the spare line height above the ascent, half below the descent. */
function line(size: number, ascentEm: number, descentEm: number, capEm: number): LabelLine {
  const height = labelLineHeightFor(size);
  const leading = height - (ascentEm + descentEm) * size;
  return { height, ascender: ascentEm * size + leading / 2, capHeight: capEm * size };
}

// Roboto: ascent 0.928, descent 0.244, capitals 0.711 — its box's middle is near its capitals' middle.
const roboto = (size: number) => line(size, 0.928, 0.244, 0.711);
// The user's phone: the line's middle 0.48 em above the baseline (their screenshot of TR-089's chips), capitals 0.711.
const phone = (size: number) => line(size, 0.96 + 0.244, 0.244, 0.711);

describe("capCentreShift", () => {
  it("barely moves a label whose font's box is centred on its capitals", () => {
    expect(Math.abs(capCentreShift(roboto(FONT_SIZE.small)))).toBeLessThanOrEqual(0.25);
  });

  it("moves the label up by the gap the user saw on the phone", () => {
    // 0.48 em − 0.3555 em of 13 points: about 1.6 points, to a quarter point.
    expect(capCentreShift(phone(FONT_SIZE.small))).toBe(-1.5);
  });

  it("puts the capitals' middle on the line's middle", () => {
    const measured = phone(FONT_SIZE.small);
    const capsMiddle = measured.ascender - measured.capHeight / 2 + capCentreShift(measured);
    expect(Math.abs(capsMiddle - measured.height / 2)).toBeLessThanOrEqual(0.125);
  });

  it("grows with the font size, so a larger system font stays centred", () => {
    const normal = capCentreShift(phone(FONT_SIZE.small));
    const large = capCentreShift(phone(FONT_SIZE.small * 1.3));
    const largest = capCentreShift(phone(FONT_SIZE.small * 2));
    expect(large).toBeLessThan(normal);
    expect(largest).toBeCloseTo(normal * 2, 0);
  });

  it("moves down a label whose font keeps more room below its letters", () => {
    expect(capCentreShift(line(FONT_SIZE.small, 0.8, 0.5, 0.711))).toBeGreaterThan(0);
  });

  it("leaves the label where it is without a usable line (the web reports none)", () => {
    expect(capCentreShift(undefined)).toBe(0);
    expect(capCentreShift({ height: 0, ascender: 0, capHeight: 0 })).toBe(0);
    expect(capCentreShift({ height: 18, ascender: Number.NaN, capHeight: 9 })).toBe(0);
    expect(capCentreShift({ height: 18, ascender: 14, capHeight: 0 })).toBe(0);
    // A report that would move the label out of its own line.
    expect(capCentreShift({ height: 18, ascender: 40, capHeight: 9 })).toBe(0);
  });
});

describe("labelFontKey", () => {
  const chip = { fontSize: FONT_SIZE.small, lineHeight: labelLineHeightFor(FONT_SIZE.small), fontWeight: "500" };

  it("is one key per font, size, weight, line and font scale, so a count change reuses it", () => {
    expect(labelFontKey(chip, 1)).toBe(labelFontKey({ ...chip }, 1));
    expect(labelFontKey(chip, 1.3)).not.toBe(labelFontKey(chip, 1));
    expect(labelFontKey({ ...chip, fontSize: FONT_SIZE.micro }, 1)).not.toBe(labelFontKey(chip, 1));
    expect(labelFontKey({ ...chip, fontWeight: "700" }, 1)).not.toBe(labelFontKey(chip, 1));
    expect(labelFontKey({ ...chip, fontFamily: "Inter" }, 1)).not.toBe(labelFontKey(chip, 1));
  });
});

describe("createShiftStore", () => {
  it("keeps one shift per key and tells its labels once", () => {
    const shifts = new Map<string, number>();
    const store = createShiftStore(shifts);
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    expect(store.get("a")).toBeUndefined();
    store.set("a", -1.5);
    store.set("a", -1.5);
    expect(store.get("a")).toBe(-1.5);
    expect(shifts.get("a")).toBe(-1.5);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.set("b", 0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("starts from shifts measured before a reconnect", () => {
    expect(createShiftStore(new Map([["a", -1]])).get("a")).toBe(-1);
  });
});
