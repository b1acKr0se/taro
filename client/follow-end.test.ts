import { describe, expect, it } from "vitest";

import { revealsAgain, viewportChange } from "./follow-end";

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
