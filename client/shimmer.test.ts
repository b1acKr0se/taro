import { describe, expect, it } from "vitest";

import { shimmerLayers, shimmerMetrics, webShimmerTrack } from "./shimmer";

describe("shimmerMetrics", () => {
  it("starts the band wholly before the words and ends it past them", () => {
    const metrics = shimmerMetrics(30, 300);
    expect(metrics.from).toBe(-metrics.peakWidth);
    // Paseo's phone track: on until the band is a band past the words (TR-184).
    expect(metrics.to).toBe(300 + metrics.peakWidth);
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
    expect(shimmerMetrics(10, 0).to).toBe(32);
    expect(shimmerMetrics(10, -5).to).toBe(32);
  });
});

describe("webShimmerTrack (TR-184)", () => {
  it("runs from a band before the first letter to the last letter, as Paseo's web track", () => {
    expect(webShimmerTrack(20, 520)).toEqual({ peakWidth: 110, trackStart: -90, trackEnd: 520 });
  });

  it("sizes the band at 22% of the words, between 42 and 120", () => {
    expect(webShimmerTrack(0, 100).peakWidth).toBe(42);
    expect(webShimmerTrack(0, 2000).peakWidth).toBe(120);
    expect(webShimmerTrack(0, 300).peakWidth).toBeCloseTo(66);
  });

  it("keeps a band for words not laid out yet or measured backwards", () => {
    expect(webShimmerTrack(0, 0).peakWidth).toBe(42);
    expect(webShimmerTrack(50, 10)).toEqual({ peakWidth: 42, trackStart: 8, trackEnd: 10 });
  });
});

describe("shimmerLayers (TR-184)", () => {
  /** How white a point is under the layers covering it: each lays its opacity over what is below. */
  const whiteUnder = (layers: { opacity: number }[]) => 1 - layers.reduce((clear, layer) => clear * (1 - layer.opacity), 1);

  it("narrows each layer inside the last, the outermost the whole band", () => {
    const shares = shimmerLayers(8).map((layer) => layer.share);
    expect(shares[0]).toBe(1);
    expect(shares.at(-1)).toBe(1 / 8);
    shares.slice(1).forEach((share, index) => expect(share).toBeLessThan(shares[index] ?? 0));
  });

  it("builds the white in even steps to full white at the middle, as Paseo's gradient rises", () => {
    const layers = shimmerLayers(8);
    for (let covering = 1; covering <= 8; covering += 1) expect(whiteUnder(layers.slice(0, covering))).toBeCloseTo(covering / 8);
    expect(layers.at(-1)?.opacity).toBe(1);
  });

  it("is one full layer when only one is asked for, and none for zero", () => {
    expect(shimmerLayers(1)).toEqual([{ share: 1, opacity: 1 }]);
    expect(shimmerLayers(0)).toEqual([]);
  });
});
