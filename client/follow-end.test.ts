import { describe, expect, it } from "vitest";

import { revealsAgain } from "./follow-end";

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
