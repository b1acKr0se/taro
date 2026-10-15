import { describe, expect, it } from "vitest";

import { trailError, type CrashReport } from "../shared/crash-trail";
import { crashReportText } from "./crash-report-text";

const at = "2026-10-15T09:12:00.000Z";
const base: CrashReport = {
  launch: "launch0001",
  device: { platform: "ios", os: "18.2", model: "phone", window: "390×844" },
  at,
  cause: "stopped",
  error: null,
  steps: [
    { at: "2026-10-15T09:11:58.000Z", kind: "screen", what: "project notes-app manager" },
    { at: "2026-10-15T09:11:59.000Z", kind: "keyboard", what: "shown" },
    { at: "2026-10-15T09:12:00.000Z", kind: "press", what: "submit" },
  ],
  file: "/home/user/.paseo/plugin-data/taro/crash-trail.json",
};

describe("crashReportText", () => {
  it("says the app stopped, when, on which device, and the last steps", () => {
    const text = crashReportText(base, Date.parse(at) + 2 * 3_600_000);
    expect(text.heading).toBe("The app stopped unexpectedly last time");
    expect(text.when).toMatch(/^2h ago \(\d\d:\d\d\) · ios 18\.2 · phone · 390×844$/);
    expect(text.cause).toContain("native crash");
    expect(text.steps).toHaveLength(3);
    expect(text.steps[0]).toMatch(/^\d\d:\d\d:\d\d {2}showed project notes-app manager$/);
    expect(text.steps[1]).toMatch(/keyboard shown$/);
    expect(text.steps[2]).toMatch(/pressed submit$/);
    expect(text.file).toBe(base.file);
  });

  it("names a fatal error as a crash and a caught one as Taro's error", () => {
    const fatal = crashReportText({ ...base, cause: "error", error: trailError("fatal", "app", new TypeError("x is undefined"), at) }, Date.parse(at));
    expect(fatal.heading).toBe("The app crashed last time");
    expect(fatal.cause).toBe("An error: TypeError: x is undefined");
    const caught = crashReportText({ ...base, cause: "error", error: trailError("boundary", "Taro screen", new Error("boom"), at) }, Date.parse(at));
    expect(caught.heading).toBe("Taro hit an error last time");
    expect(caught.cause).toBe("An error in the Taro screen: Error: boom");
  });

  it("draws no placeholder for a missing time or empty trail", () => {
    const text = crashReportText({ ...base, at: "not a time", steps: [] }, Date.parse(at));
    expect(text.when).toBe("ios 18.2 · phone · 390×844");
    expect(text.steps).toEqual([]);
    expect(JSON.stringify(text)).not.toMatch(/undefined|NaN|null/);
  });
});
