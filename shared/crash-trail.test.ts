import { describe, expect, it } from "vitest";

import {
  addReport,
  crashCause,
  deviceLine,
  dismissLaunch,
  emptyTrailFile,
  lastCrash,
  plainWhat,
  pressWhat,
  trailError,
  TrailReportSchema,
  TRAIL_ERRORS,
  TRAIL_LAUNCHES,
  TRAIL_STEPS,
  type Device,
  type TrailFile,
  type TrailReport,
} from "./crash-trail";

const phone: Device = { platform: "ios", os: "18.2", model: "phone", window: "390×844" };
const browser: Device = { platform: "web", os: "", model: "browser", window: "1280×800" };

function report(launch: string, overrides: Partial<TrailReport> = {}): TrailReport {
  return { launch, device: phone, state: "foreground", steps: [{ at: "2026-10-15T09:00:00.000Z", kind: "screen", what: "project notes-app" }], errors: [], ...overrides };
}

function time(minute: number): string {
  return `2026-10-15T09:${String(minute).padStart(2, "0")}:00.000Z`;
}

describe("plainWhat and pressWhat", () => {
  it("keeps ids, keys and view names", () => {
    expect(plainWhat("project notes-app manager TR-132 plan")).toBe("project notes-app manager TR-132 plan");
    expect(plainWhat("android 14 Google Pixel 8")).toBe("android 14 Google Pixel 8");
  });

  it("strips punctuation, line breaks and length from free text", () => {
    expect(plainWhat("Hello, can you fix the login?\nThanks!")).toBe("Hello can you fix the login Thanks");
    expect(plainWhat("x".repeat(200))).toHaveLength(80);
    expect(plainWhat("")).toBe("");
  });

  it("records a word-like button key and only 'option' for anything else", () => {
    expect(pressWhat("request-changes")).toBe("request-changes");
    expect(pressWhat("Per trade")).toBe("option");
    expect(pressWhat("option:Store fees per trade")).toBe("option");
    expect(pressWhat("")).toBe("option");
    expect(pressWhat("a".repeat(42))).toBe("option");
  });
});

describe("trailError", () => {
  it("keeps the name, message and stack of an Error, capped", () => {
    const error = new TypeError("x".repeat(400));
    const recorded = trailError("boundary", "Taro screen", error, time(1));
    expect(recorded.message.startsWith("TypeError: x")).toBe(true);
    expect(recorded.message).toHaveLength(300);
    expect(recorded.stack.length).toBeLessThanOrEqual(4_000);
    expect(recorded).toMatchObject({ source: "boundary", where: "Taro screen", at: time(1) });
  });

  it("describes a thrown value that is not an Error", () => {
    expect(trailError("rejection", "app", "network down", time(1))).toMatchObject({ message: "network down", stack: "" });
    expect(trailError("rejection", "app", undefined, time(1)).message).toBe("undefined");
  });
});

describe("TrailReportSchema", () => {
  it("refuses more steps or errors than one launch keeps, and a malformed launch id", () => {
    const step = { at: time(0), kind: "press" as const, what: "send" };
    expect(TrailReportSchema.safeParse(report("abcdefgh1", { steps: Array.from({ length: TRAIL_STEPS + 1 }, () => step) })).success).toBe(false);
    const error = trailError("error", "app", new Error("e"), time(0));
    expect(TrailReportSchema.safeParse(report("abcdefgh1", { errors: Array.from({ length: TRAIL_ERRORS + 1 }, () => error) })).success).toBe(false);
    expect(TrailReportSchema.safeParse(report("../etc/passwd")).success).toBe(false);
    expect(TrailReportSchema.safeParse(report("abcdefgh1")).success).toBe(true);
  });
});

describe("addReport", () => {
  it("starts a launch and appends later steps to it", () => {
    let file = addReport(emptyTrailFile(), report("launch0001"), time(0));
    file = addReport(file, report("launch0001", { steps: [{ at: time(1), kind: "press", what: "accept" }], state: "background" }), time(1));
    expect(file.launches).toHaveLength(1);
    expect(file.launches[0]).toMatchObject({ startedAt: time(0), lastAt: time(1), state: "background" });
    expect(file.launches[0]?.steps.map((step) => step.what)).toEqual(["project notes-app", "accept"]);
  });

  it("keeps the last steps, the first errors and the newest launches", () => {
    let file: TrailFile = emptyTrailFile();
    for (let index = 0; index < TRAIL_STEPS + 10; index += 1) {
      file = addReport(file, report("launch0001", { steps: [{ at: time(0), kind: "press", what: `step-${index}` }] }), time(0));
    }
    const steps = file.launches[0]?.steps ?? [];
    expect(steps).toHaveLength(TRAIL_STEPS);
    expect(steps.at(-1)?.what).toBe(`step-${TRAIL_STEPS + 9}`);

    for (let index = 0; index < TRAIL_ERRORS + 2; index += 1) {
      file = addReport(file, report("launch0001", { steps: [], errors: [trailError("error", "app", new Error(`e${index}`), time(0))] }), time(0));
    }
    expect(file.launches[0]?.errors.map((error) => error.message)).toEqual(["Error: e0", "Error: e1", "Error: e2", "Error: e3", "Error: e4"]);

    for (let index = 0; index < TRAIL_LAUNCHES + 3; index += 1) {
      file = addReport(file, report(`launch${String(index).padStart(4, "0")}x`), time(10 + index));
    }
    expect(file.launches).toHaveLength(TRAIL_LAUNCHES);
    expect(file.launches.at(-1)?.launch).toBe(`launch${String(TRAIL_LAUNCHES + 2).padStart(4, "0")}x`);
  });

  it("cleans step text that bypassed the client", () => {
    const file = addReport(emptyTrailFile(), report("launch0001", { steps: [{ at: time(0), kind: "screen", what: "please, fix <this>!" }] }), time(0));
    expect(file.launches[0]?.steps[0]?.what).toBe("please fix this");
  });
});

describe("crashCause and lastCrash", () => {
  function fileWith(...reports: [TrailReport, string][]): TrailFile {
    return reports.reduce((file, [one, at]) => addReport(file, one, at), emptyTrailFile());
  }

  it("calls a launch with an error crashed on any device", () => {
    const file = fileWith([report("launch0001", { device: browser, state: "background", errors: [trailError("boundary", "Taro screen", new Error("boom"), time(2))] }), time(1)]);
    expect(crashCause(file.launches[0]!)).toBe("error");
    const crash = lastCrash(file, "launch0002", browser, "/data/crash-trail.json");
    expect(crash).toMatchObject({ launch: "launch0001", cause: "error", at: time(2), file: "/data/crash-trail.json" });
    expect(crash?.error?.message).toBe("Error: boom");
  });

  it("calls a phone launch that ended in the foreground stopped, and one sent to the background fine", () => {
    expect(lastCrash(fileWith([report("launch0001"), time(1)]), "launch0002", phone, "f")).toMatchObject({ cause: "stopped", error: null, at: time(1) });
    expect(lastCrash(fileWith([report("launch0001", { state: "background" }), time(1)]), "launch0002", phone, "f")).toBeNull();
  });

  it("never calls a browser or desktop launch that left without an error crashed (a reload)", () => {
    expect(lastCrash(fileWith([report("launch0001", { device: browser }), time(1)]), "launch0002", browser, "f")).toBeNull();
  });

  it("reports neither the current launch, another device's, nor a dismissed one", () => {
    const file = fileWith([report("launch0001"), time(1)], [report("launch0002"), time(2)]);
    expect(lastCrash(file, "launch0002", phone, "f")?.launch).toBe("launch0001");
    expect(lastCrash(file, "launch0003", { ...phone, platform: "android", model: "Google Pixel 8" }, "f")).toBeNull();
    expect(lastCrash(dismissLaunch(file, "launch0002"), "launch0003", phone, "f")?.launch).toBe("launch0001");
    expect(lastCrash(dismissLaunch(dismissLaunch(file, "launch0002"), "launch0001"), "launch0003", phone, "f")).toBeNull();
  });

  it("reports the newest crash and only its last steps", () => {
    const steps = Array.from({ length: 12 }, (_, index) => ({ at: time(index), kind: "press" as const, what: `step-${index}` }));
    const file = fileWith([report("launch0001", { errors: [trailError("fatal", "app", new Error("old"), time(1))] }), time(1)], [report("launch0002", { steps }), time(5)]);
    const crash = lastCrash(file, "launch0003", phone, "f");
    expect(crash?.launch).toBe("launch0002");
    expect(crash?.steps.map((step) => step.what)).toEqual(["step-4", "step-5", "step-6", "step-7", "step-8", "step-9", "step-10", "step-11"]);
  });

  it("finds nothing in an empty file", () => {
    expect(lastCrash(emptyTrailFile(), "launch0001", phone, "f")).toBeNull();
  });
});

describe("deviceLine", () => {
  it("joins the parts it has", () => {
    expect(deviceLine(phone)).toBe("ios 18.2 · phone · 390×844");
    expect(deviceLine(browser)).toBe("web · browser · 1280×800");
  });
});
