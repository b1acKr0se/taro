import { describe, expect, it } from "vitest";

import { keepVisibleFrom, layoutShown, nearTheTop, revealsAgain, scrollEventKind, viewportChange, webScrollNode } from "./follow-end";

describe("revealsAgain", () => {
  it("scrolls to a revealed row again while the transcript settles", () => {
    expect(revealsAgain(1_000, 1_000, false)).toBe(true);
    expect(revealsAgain(1_000, 2_500, false)).toBe(true);
  });

  it("stops once the transcript has settled", () => {
    expect(revealsAgain(1_000, 2_501, false)).toBe(false);
  });

  it("stops once the reader has scrolled, however soon", () => {
    expect(revealsAgain(1_000, 1_000, true)).toBe(false);
    expect(revealsAgain(1_000, 1_200, true)).toBe(false);
  });
});

describe("viewportChange", () => {
  it("reads a laid-out transcript going to height 0 as hidden (its pane kept mounted behind another)", () => {
    expect(viewportChange(false, 640, 0)).toBe("hidden");
  });

  it("reads the next real height after that as shown again, to put the reader back", () => {
    expect(viewportChange(true, 640, 640)).toBe("shown-again");
    expect(viewportChange(true, 640, 500)).toBe("shown-again");
  });

  it("stays hidden through more zero layouts", () => {
    expect(viewportChange(true, 640, 0)).toBe("hidden");
  });

  it("does not take the first layout of a new transcript for a return", () => {
    expect(viewportChange(false, 0, 640)).toBe("resized");
    expect(viewportChange(false, 0, 0)).toBe("resized");
  });

  it("reads a change of size while showing as a resize (the keyboard, a rotation)", () => {
    expect(viewportChange(false, 640, 320)).toBe("resized");
  });
});

describe("layoutShown", () => {
  it("is false for a card laid out at height 0 in a chat built hidden, so its reveal waits until the chat shows", () => {
    expect(layoutShown(false, { height: 0 })).toBe(false);
  });

  it("is false while the chat's pane is hidden", () => {
    expect(layoutShown(true, { height: 240 })).toBe(false);
  });

  it("is true for a card the reader sees", () => {
    expect(layoutShown(false, { height: 240 })).toBe(true);
  });
});

describe("scrollEventKind (TR-131)", () => {
  it("is stale while a reveal is asked for and not made yet, wherever it lands", () => {
    // The opening's follow of the end reported after the card's reveal was asked for: not the reader.
    expect(scrollEventKind(2986, 3017, [2278], 1)).toBe("stale");
    expect(scrollEventKind(0, 3017, [], 1)).toBe("stale");
    expect(scrollEventKind(2278, 3017, [2278], 2)).toBe("stale");
  });

  it("is asked where a reveal scrolled, within the slack, or at the end a reveal past it was clamped to", () => {
    expect(scrollEventKind(2278, 3017, [2278], 0)).toBe("asked");
    expect(scrollEventKind(2280, 3017, [2278], 0)).toBe("asked");
    expect(scrollEventKind(3017, 3017, [4000], 0)).toBe("asked");
    expect(scrollEventKind(500, 3017, [2278, 500], 0)).toBe("asked");
  });

  it("is the reader's anywhere else once something was revealed", () => {
    expect(scrollEventKind(2281, 3017, [2278], 0)).toBe("reader");
    expect(scrollEventKind(2986, 3017, [2278], 0)).toBe("reader");
  });

  it("is free before anything was revealed", () => {
    expect(scrollEventKind(0, 0, [], 0)).toBe("free");
    expect(scrollEventKind(1200, 3017, [], 0)).toBe("free");
  });
});

describe("nearTheTop (TR-169)", () => {
  const at = (y: number, content: number, viewport = 600) => ({ contentOffset: { x: 0, y }, contentSize: { width: 400, height: content }, layoutMeasurement: { width: 400, height: viewport } });

  it("is within a screen of the top, scrolled up", () => {
    expect(nearTheTop(at(0, 3000))).toBe(true);
    expect(nearTheTop(at(599, 3000))).toBe(true);
    expect(nearTheTop(at(600, 3000))).toBe(false);
  });

  it("is never at the end: a chat too short to scroll, or opening at its end", () => {
    expect(nearTheTop(at(0, 500))).toBe(false);
    expect(nearTheTop(at(300, 900))).toBe(false);
  });

  it("is never in a hidden pane", () => {
    expect(nearTheTop(at(0, 3000, 0))).toBe(false);
  });
});

describe("webScrollNode (TR-169)", () => {
  it("is the web's scroll node", () => {
    const node = { scrollHeight: 10, scrollTop: 0, style: {} };
    expect(webScrollNode({ getScrollableNode: () => node })).toBe(node);
  });

  it("is null on a phone, whose scrollable node is a number, or with no scroll view", () => {
    expect(webScrollNode({ getScrollableNode: () => 42 })).toBeNull();
    expect(webScrollNode(null)).toBeNull();
    expect(webScrollNode({})).toBeNull();
  });
});

describe("keepVisibleFrom (TR-169)", () => {
  it("skips the anchor and the earlier-messages line, and the error when it shows", () => {
    expect(keepVisibleFrom(false).minIndexForVisible).toBe(2);
    expect(keepVisibleFrom(true).minIndexForVisible).toBe(3);
  });

  it("is the same object each render, so the phone's scroll view is not reconfigured", () => {
    expect(keepVisibleFrom(false)).toBe(keepVisibleFrom(false));
  });
});
