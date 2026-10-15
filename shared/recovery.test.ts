import { describe, expect, it } from "vitest";

import { boardAlerts, hasHeadroom, headroomNeedsYou, isCrash, isHigh, mayRecover, parsePids, recentRecoveries } from "./recovery";

describe("isCrash", () => {
  it("recognises the texts Paseo reports when the Claude process dies", () => {
    expect(isCrash("Claude stopped unexpectedly (signal SIGABRT). Any background shells, monitors or other work it had running were terminated with it.")).toBe(true);
    expect(isCrash("Claude stopped unexpectedly (exit code 134). Any background shells …")).toBe(true);
    expect(isCrash("Claude Code process exited with code 134")).toBe(true);
    expect(isCrash("Claude Code process terminated by signal SIGABRT")).toBe(true);
    expect(isCrash("terminate called after throwing an instance of 'std::system_error' what(): Resource temporarily unavailable")).toBe(true);
    expect(isCrash("pthread_create failed")).toBe(true);
    expect(isCrash("spawn EAGAIN")).toBe(true);
  });

  it("leaves other failures alone", () => {
    expect(isCrash("")).toBe(false);
    expect(isCrash("API Error: 529 overloaded")).toBe(false);
    expect(isCrash("Invalid API key · Please run /login")).toBe(false);
    expect(isCrash("No prior user message available to rewind.")).toBe(false);
    expect(isCrash("the signal was clear")).toBe(false);
  });
});

describe("retry limit", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  it("allows two recoveries per rolling hour", () => {
    expect(mayRecover([], now)).toBe(true);
    expect(mayRecover([minutesAgo(5)], now)).toBe(true);
    expect(mayRecover([minutesAgo(50), minutesAgo(5)], now)).toBe(false);
  });

  it("forgets recoveries older than an hour, exactly at the boundary too", () => {
    expect(mayRecover([minutesAgo(61), minutesAgo(5)], now)).toBe(true);
    expect(mayRecover([minutesAgo(60), minutesAgo(5)], now)).toBe(true);
    expect(mayRecover([minutesAgo(59), minutesAgo(5)], now)).toBe(false);
    expect(recentRecoveries([minutesAgo(90), minutesAgo(30), minutesAgo(1)], now)).toEqual([minutesAgo(30), minutesAgo(1)]);
  });

  it("ignores unreadable and future times rather than counting them", () => {
    expect(mayRecover(["not a time", "", minutesAgo(-10)], now)).toBe(true);
  });
});

describe("headroom", () => {
  it("parses cgroup files and treats missing, unlimited or junk as no known limit", () => {
    expect(parsePids("1321\n", "2048\n")).toEqual({ current: 1321, max: 2048 });
    expect(parsePids(null, "2048")).toBeNull();
    expect(parsePids("10", null)).toBeNull();
    expect(parsePids("10", "max\n")).toBeNull();
    expect(parsePids("10", "0")).toBeNull();
    expect(parsePids("ten", "2048")).toBeNull();
    expect(parsePids("-1", "2048")).toBeNull();
  });

  it("gates above 85% of the limit and never when the limit is unknown", () => {
    expect(hasHeadroom(null)).toBe(true);
    expect(hasHeadroom({ current: 0, max: 2048 })).toBe(true);
    // 85% of 2048 is 1740.8.
    expect(isHigh({ current: 1740, max: 2048 })).toBe(false);
    expect(isHigh({ current: 1741, max: 2048 })).toBe(true);
    expect(hasHeadroom({ current: 1741, max: 2048 })).toBe(false);
    expect(hasHeadroom({ current: 2048, max: 2048 })).toBe(false);
    expect(hasHeadroom({ current: 3000, max: 2048 })).toBe(false);
  });

  it("asks for the user only once usage has stayed high for two minutes", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    const high = (secondsAgo: number) => ({ current: 1900, max: 2048, high: true, highSince: new Date(now - secondsAgo * 1000).toISOString() });
    expect(headroomNeedsYou(null, now)).toBe(false);
    expect(headroomNeedsYou({ current: 100, max: 2048, high: false, highSince: null }, now)).toBe(false);
    expect(headroomNeedsYou(high(119), now)).toBe(false);
    expect(headroomNeedsYou(high(120), now)).toBe(true);
    expect(headroomNeedsYou({ ...high(600), highSince: null }, now)).toBe(false);
  });
});

describe("boardAlerts", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const since = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it("is empty when all is well or the limit is unknown", () => {
    expect(boardAlerts(null, null, now)).toEqual([]);
    expect(boardAlerts({ current: 100, max: 2048, high: false, highSince: null }, null, now)).toEqual([]);
  });

  it("names the usage once it has stayed high", () => {
    expect(boardAlerts({ current: 1900, max: 2048, high: true, highSince: since(30) }, null, now)).toEqual([]);
    const [alert] = boardAlerts({ current: 1900, max: 2048, high: true, highSince: since(300) }, null, now);
    expect(alert?.id).toBe("headroom");
    expect(alert?.text).toContain("1900 of 2048 threads (93%)");
  });

  it("reports a manager the plugin stopped recovering", () => {
    expect(boardAlerts(null, "Crashed: crashed 3 times within an hour.", now)).toEqual([
      { id: "manager-crashed", tickets: [], text: "The manager is stopped. Crashed: crashed 3 times within an hour. Resume manager brings it back with its conversation (also in the project's settings)." },
    ]);
  });
});
