import { describe, expect, it } from "vitest";

import { shimmerMetrics } from "./shimmer";

describe("shimmerMetrics", () => {
  it("starts the band wholly before the words and ends it past them", () => {
    const metrics = shimmerMetrics(30, 300);
    expect(metrics.from).toBe(-metrics.peakWidth);
    expect(metrics.to).toBe(300);
  });

  it("sizes the band at 28% of the words' width, between 32 and 120", () => {
    expect(shimmerMetrics(30, 200).peakWidth).toBeCloseTo(56);
    expect(shimmerMetrics(30, 50).peakWidth).toBe(32);
    expect(shimmerMetrics(30, 1000).peakWidth).toBe(120);
    expect(shimmerMetrics(30, 0).peakWidth).toBe(32);
  });

  it("takes Paseo's time: quicker for short text, between 1 and 2.3 seconds", () => {
    expect(shimmerMetrics(4, 100).durationMs).toBe(1032);
    expect(shimmerMetrics(13, 100).durationMs).toBe(1354);
    expect(shimmerMetrics(0, 100).durationMs).toBe(1000);
    expect(shimmerMetrics(500, 100).durationMs).toBe(2300);
  });

  it("never travels backwards before the words are measured", () => {
    expect(shimmerMetrics(10, 0).to).toBe(0);
    expect(shimmerMetrics(10, -5).to).toBe(0);
  });
});
