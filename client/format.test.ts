import { describe, expect, it } from "vitest";

import { formatCost, formatDuration, pullRequestLabel } from "./format";

describe("formatDuration", () => {
  it("writes nothing as a dash", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });

  it("picks the unit by size and rounds at each boundary", () => {
    expect(formatDuration(40_000)).toBe("40s");
    expect(formatDuration(59_400)).toBe("59s");
    expect(formatDuration(59_600)).toBe("1m");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(59.6 * 60_000)).toBe("1h 00m");
    expect(formatDuration(125 * 60_000)).toBe("2h 05m");
    expect(formatDuration(24 * 3_600_000)).toBe("1d 0h");
    expect(formatDuration((3 * 24 + 4) * 3_600_000 + 20 * 60_000)).toBe("3d 4h");
  });
});

describe("formatCost", () => {
  it("writes dollars to the cent, tiny costs and missing ones", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(0.005)).toBe("$0.01");
    expect(formatCost(12.345)).toBe("$12.35");
  });
});

describe("pullRequestLabel", () => {
  it("shortens a pull request URL to its number and repository", () => {
    expect(pullRequestLabel("https://github.com/o/r/pull/42")).toBe("PR #42 · o/r");
    expect(pullRequestLabel("https://ghe.example.com/team/app/pull/7")).toBe("PR #7 · team/app");
  });

  it("keeps anything else as it is", () => {
    expect(pullRequestLabel("https://example.com/merge-requests/3")).toBe("https://example.com/merge-requests/3");
  });
});
