import { describe, expect, it } from "vitest";

import { footerLabels, formatMessageTimestamp, formatTurnDuration, turnDurationMs } from "./turn-time";

describe("formatTurnDuration", () => {
  it("writes whole seconds under a minute, rounding down", () => {
    expect(formatTurnDuration(0)).toBe("0s");
    expect(formatTurnDuration(11_900)).toBe("11s");
    expect(formatTurnDuration(59_999)).toBe("59s");
  });

  it("drops a zero remainder and keeps the next unit down otherwise", () => {
    expect(formatTurnDuration(60_000)).toBe("1m");
    expect(formatTurnDuration(132_000)).toBe("2m 12s");
    expect(formatTurnDuration(3_600_000)).toBe("1h");
    expect(formatTurnDuration(3_900_000)).toBe("1h 5m");
  });

  it("writes nothing sensible as 0s", () => {
    expect(formatTurnDuration(-1)).toBe("0s");
    expect(formatTurnDuration(Number.NaN)).toBe("0s");
  });
});

describe("turnDurationMs", () => {
  it("runs from the user's message to the turn's last item", () => {
    expect(turnDurationMs("2026-10-20T10:00:00Z", "2026-10-20T10:00:11Z")).toBe(11_000);
  });

  it("is null without both times or with an unreadable one, and never negative", () => {
    expect(turnDurationMs(undefined, "2026-10-20T10:00:11Z")).toBeNull();
    expect(turnDurationMs("2026-10-20T10:00:00Z", undefined)).toBeNull();
    expect(turnDurationMs("nope", "2026-10-20T10:00:11Z")).toBeNull();
    expect(turnDurationMs("2026-10-20T10:00:11Z", "2026-10-20T10:00:00Z")).toBe(0);
  });
});

describe("formatMessageTimestamp", () => {
  const now = new Date(2026, 9, 20, 15, 0, 0);
  const at = (day: number) => new Date(2026, 9, day, 9, 5, 0).toISOString();

  it("is empty for a missing or unreadable time", () => {
    expect(formatMessageTimestamp(undefined, now)).toBe("");
    expect(formatMessageTimestamp("nope", now)).toBe("");
  });

  it("is the clock alone for today, with the weekday for the last six days, else the date", () => {
    const clock = new Date(2026, 9, 20, 9, 5, 0).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    expect(formatMessageTimestamp(at(20), now)).toBe(clock);
    expect(formatMessageTimestamp(at(19), now)).toMatch(/^\p{L}+ /u);
    expect(formatMessageTimestamp(at(19), now).endsWith(clock)).toBe(true);
    expect(formatMessageTimestamp(at(13), now)).toContain("2026");
    expect(formatMessageTimestamp(at(14), now)).not.toContain("2026");
  });
});

describe("footerLabels", () => {
  it("words the duration and leaves out what is unknown", () => {
    expect(footerLabels({ durationMs: 11_000 }).duration).toBe("Worked for 11s");
    expect(footerLabels({ durationMs: null, completedAt: "2026-10-20T10:00:11Z" }).duration).toBe("");
    expect(footerLabels({ durationMs: 0 }).endedAt).toBe("");
  });
});
