import { describe, expect, it } from "vitest";

import { topInset } from "./safe-area-inset";

describe("topInset", () => {
  it("clears the status bar's height on Android", () => {
    expect(topInset("android", 48)).toBe(48);
    expect(topInset("android", 24.5)).toBe(24.5);
  });

  it("is zero on Android when the height is unknown", () => {
    expect(topInset("android", undefined)).toBe(0);
    expect(topInset("android", null)).toBe(0);
    expect(topInset("android", 0)).toBe(0);
  });

  it("leaves iOS to SafeAreaView and the web and desktop alone", () => {
    expect(topInset("ios", 47)).toBe(0);
    expect(topInset("web", 30)).toBe(0);
    expect(topInset("macos", undefined)).toBe(0);
  });
});
