import { describe, expect, it } from "vitest";

import { shimmerOpacity, workingRow } from "./working-row";

const NOW = Date.parse("2026-01-01T12:00:42Z");

describe("workingRow", () => {
  it("shows the word and the time since the turn started while running or initializing", () => {
    expect(workingRow("running", "2026-01-01T12:00:00Z", NOW)).toEqual({ label: "Working…", elapsed: "42s" });
    expect(workingRow("initializing", "2026-01-01T11:48:42Z", NOW)).toEqual({ label: "Working…", elapsed: "12m" });
  });

  it("is absent when no turn runs", () => {
    for (const status of ["idle", "error", "closed", "", null, undefined]) expect(workingRow(status, "2026-01-01T12:00:00Z", NOW)).toBeNull();
  });

  it("shows no time when the start is unknown, unreadable or not yet reached", () => {
    for (const started of [null, undefined, "", "garbage", "2026-01-01T12:00:42Z", "2026-01-01T12:05:00Z"]) {
      expect(workingRow("running", started, NOW)).toEqual({ label: "Working…", elapsed: null });
    }
  });
});

describe("shimmerOpacity", () => {
  const letters = (progress: number) => Array.from({ length: 8 }, (_, index) => shimmerOpacity(index, 8, progress));

  it("brightens the letter under the wave and dims the rest", () => {
    const frame = letters(0.5);
    const brightest = frame.indexOf(Math.max(...frame));
    expect(brightest).toBeGreaterThanOrEqual(3);
    expect(brightest).toBeLessThanOrEqual(4);
    expect(frame[0]).toBe(0.4);
    expect(frame[7]).toBe(0.4);
  });

  it("moves left to right and leaves the word dim at both ends of a pass", () => {
    expect(letters(0).every((opacity) => opacity === 0.4)).toBe(true);
    expect(letters(1).every((opacity) => opacity === 0.4)).toBe(true);
    const crest = (progress: number) => letters(progress).indexOf(Math.max(...letters(progress)));
    expect(crest(0.2)).toBeLessThan(crest(0.5));
    expect(crest(0.5)).toBeLessThan(crest(0.8));
  });

  it("copes with a one-letter word", () => {
    expect(Number.isFinite(shimmerOpacity(0, 1, 0.5))).toBe(true);
  });
});
