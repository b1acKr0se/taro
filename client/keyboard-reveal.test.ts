import { describe, expect, it } from "vitest";

import { REVEAL_MARGIN, holds, keyboardRoom, revealOffset, visibleSpan } from "./keyboard-reveal";

// A phone-sized scroll area under the tabs, from y 200 to 800; the keyboard's top at 500.
const area = { top: 200, bottom: 800 };

describe("keyboardRoom", () => {
  it("is the part of the area the keyboard covers", () => {
    expect(keyboardRoom(area, 500)).toBe(300);
  });

  it("is nothing without a keyboard, or with one below the area", () => {
    expect(keyboardRoom(area, null)).toBe(0);
    expect(keyboardRoom(area, 800)).toBe(0);
    expect(keyboardRoom(area, 900)).toBe(0);
  });

  it("is the whole area when the keyboard covers it entirely, never more", () => {
    expect(keyboardRoom(area, 100)).toBe(600);
  });

  it("rounds to whole points", () => {
    expect(keyboardRoom(area, 500.4)).toBe(300);
  });
});

describe("visibleSpan", () => {
  it("ends at the keyboard, or at the area's own bottom without one", () => {
    expect(visibleSpan(area, 500)).toEqual({ top: 200, bottom: 500 });
    expect(visibleSpan(area, null)).toEqual(area);
    expect(visibleSpan(area, 900)).toEqual(area);
  });

  it("is empty when the keyboard covers the whole area", () => {
    expect(visibleSpan(area, 100)).toEqual({ top: 200, bottom: 200 });
  });
});

describe("revealOffset", () => {
  const visible = visibleSpan(area, 500);

  it("scrolls a field behind the keyboard up until it sits a margin above it", () => {
    // The field from 600 to 640, the keyboard at 500: 140 + the margin further down.
    expect(revealOffset({ top: 600, bottom: 640 }, visible, 50)).toBe(50 + 140 + REVEAL_MARGIN);
  });

  it("scrolls a field half under the keyboard just enough", () => {
    expect(revealOffset({ top: 480, bottom: 520 }, visible, 0)).toBe(20 + REVEAL_MARGIN);
  });

  it("leaves a field already in view where it is", () => {
    expect(revealOffset({ top: 300, bottom: 340 }, visible, 120)).toBeNull();
    expect(revealOffset({ top: 200 + REVEAL_MARGIN, bottom: 500 - REVEAL_MARGIN }, visible, 120)).toBeNull();
  });

  it("scrolls back down to a field above the visible part", () => {
    expect(revealOffset({ top: 150, bottom: 190 }, visible, 400)).toBe(400 - 50 - REVEAL_MARGIN);
  });

  it("never asks for an offset above the content's start", () => {
    expect(revealOffset({ top: 100, bottom: 140 }, visible, 20)).toBe(0);
  });

  it("shows a field taller than the visible part by its bottom, where the reader types", () => {
    // 400 tall in 300 of room: its bottom (650) a margin above the keyboard.
    expect(revealOffset({ top: 250, bottom: 650 }, visible, 0)).toBe(150 + REVEAL_MARGIN);
    // Already scrolled that far: nothing more.
    expect(revealOffset({ top: 100 - REVEAL_MARGIN, bottom: 500 - REVEAL_MARGIN }, visible, 162)).toBeNull();
  });

  it("does nothing when nothing is visible, as with the area entirely under the keyboard", () => {
    expect(revealOffset({ top: 600, bottom: 640 }, visibleSpan(area, 100), 0)).toBeNull();
  });

  it("works without a keyboard, inside the area's own bounds", () => {
    expect(revealOffset({ top: 790, bottom: 830 }, visibleSpan(area, null), 0)).toBe(30 + REVEAL_MARGIN);
  });
});

describe("holds", () => {
  const box = { left: 0, right: 400, top: 200, bottom: 800 };

  it("claims a field inside the area, even behind the keyboard", () => {
    expect(holds(box, { left: 20, right: 380, top: 600, bottom: 640 })).toBe(true);
  });

  it("leaves a field elsewhere on the page to its own area", () => {
    // The composer under the transcript, and a field in a side pane.
    expect(holds(box, { left: 20, right: 380, top: 820, bottom: 860 })).toBe(false);
    expect(holds(box, { left: 420, right: 800, top: 300, bottom: 340 })).toBe(false);
  });

  it("claims nothing for an area with no height, as on a hidden tab", () => {
    expect(holds({ left: 0, right: 0, top: 0, bottom: 0 }, { left: 0, right: 0, top: 0, bottom: 0 })).toBe(false);
  });
});
