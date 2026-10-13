import { describe, expect, it } from "vitest";

import { formatCost, formatDuration, formatMilestoneTime, pullRequestLabel } from "./format";

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

describe("formatMilestoneTime", () => {
  // Built from local dates so the test holds in any time zone.
  const now = new Date(2026, 9, 13, 18, 0).getTime();

  it("writes a time today as HH:MM", () => {
    expect(formatMilestoneTime(new Date(2026, 9, 13, 14, 3).toISOString(), now)).toBe("14:03");
    expect(formatMilestoneTime(new Date(2026, 9, 13, 0, 5).toISOString(), now)).toBe("00:05");
  });

  it("adds the date on another day, and the year in another year", () => {
    expect(formatMilestoneTime(new Date(2026, 9, 12, 14, 3).toISOString(), now)).toBe("Oct 12 14:03");
    expect(formatMilestoneTime(new Date(2025, 0, 2, 9, 30).toISOString(), now)).toBe("Jan 2 2025 09:30");
  });

  it("reads a record time written without seconds or zone", () => {
    expect(formatMilestoneTime("2026-10-13T14:10", now)).toBe("14:10");
  });

  it("gives null for no time or a malformed one", () => {
    expect(formatMilestoneTime(null, now)).toBeNull();
    expect(formatMilestoneTime("yesterday", now)).toBeNull();
    expect(formatMilestoneTime("2026-13-45T99:99Z", now)).toBeNull();
  });
});
