import { describe, expect, it } from "vitest";

import { formatClock, formatCost, formatDay, formatDuration, pullRequestLabel } from "./format";

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
    expect(pullRequestLabel("https://github.com/o/r/pull/42")).toBe("PR\u00a0#42\u00a0· o/r");
    expect(pullRequestLabel("https://ghe.example.com/team/app/pull/7")).toBe("PR\u00a0#7\u00a0· team/app");
  });

  it("keeps anything else as it is", () => {
    expect(pullRequestLabel("https://example.com/merge-requests/3")).toBe("https://example.com/merge-requests/3");
  });
});

describe("formatClock", () => {
  it("writes a local time as HH:MM", () => {
    expect(formatClock(new Date(2026, 9, 13, 14, 3).toISOString())).toBe("14:03");
    expect(formatClock(new Date(2026, 9, 13, 0, 5).toISOString())).toBe("00:05");
  });

  it("reads a record time written without seconds or zone", () => {
    expect(formatClock("2026-10-13T14:10")).toBe("14:10");
  });

  it("gives null for no time or a malformed one", () => {
    expect(formatClock(null)).toBeNull();
    expect(formatClock("yesterday")).toBeNull();
    expect(formatClock("2026-13-45T99:99Z")).toBeNull();
  });
});

describe("formatDay", () => {
  // Built from local dates so the test holds in any time zone.
  const now = new Date(2026, 9, 13, 18, 0).getTime();

  it("names today and yesterday, from midnight to midnight", () => {
    expect(formatDay(new Date(2026, 9, 13, 0, 0).toISOString(), now)).toBe("Today");
    expect(formatDay(new Date(2026, 9, 12, 23, 59).toISOString(), now)).toBe("Yesterday");
    expect(formatDay(new Date(2026, 9, 12, 0, 0).toISOString(), now)).toBe("Yesterday");
  });

  it("dates an older day, and adds the year in another year", () => {
    expect(formatDay(new Date(2026, 9, 11, 14, 3).toISOString(), now)).toBe("Oct 11");
    expect(formatDay(new Date(2025, 11, 31, 9, 30).toISOString(), new Date(2026, 0, 1, 9, 0).getTime())).toBe("Yesterday");
    expect(formatDay(new Date(2025, 0, 2, 9, 30).toISOString(), now)).toBe("Jan 2 2025");
  });

  it("gives null for no time or a malformed one", () => {
    expect(formatDay(null, now)).toBeNull();
    expect(formatDay("2026-13-45T99:99Z", now)).toBeNull();
  });
});
