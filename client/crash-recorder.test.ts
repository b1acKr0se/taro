import { describe, expect, it } from "vitest";

import { TRAIL_ERRORS, TRAIL_STEPS, type TrailReport } from "../shared/crash-trail";
import { createCrashRecorder, SEND_EVERY_MS, type TrailSend } from "./crash-recorder";

function harness(root: object = {}) {
  let clock = 1_000_000;
  const timers: { run: () => void; ms: number }[] = [];
  const recorder = createCrashRecorder({
    root,
    now: () => clock,
    schedule: (run, ms) => timers.push({ run, ms }),
    random: () => 0.5,
  });
  const sent: Omit<TrailReport, "device">[] = [];
  let failing = false;
  const send: TrailSend = async (report) => {
    if (failing) throw new Error("disconnected");
    sent.push(report);
  };
  return {
    recorder,
    timers,
    sent,
    send,
    fail(value: boolean) {
      failing = value;
    },
    advance(ms: number) {
      clock += ms;
    },
    async fire() {
      const due = timers.splice(0);
      due.map((timer) => timer.run());
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("createCrashRecorder", () => {
  it("starts a launch once per app process, kept across the bundle's re-evaluation", () => {
    const root = {};
    const first = createCrashRecorder({ root, now: () => 1_000, random: () => 0.25 });
    const again = createCrashRecorder({ root, now: () => 9_000, random: () => 0.75 });
    expect(first.fresh).toBe(true);
    expect(again.fresh).toBe(false);
    expect(again.launch).toBe(first.launch);
    expect(first.launch).toMatch(/^[a-z0-9]{8,32}$/);
    expect(createCrashRecorder({ root: {} }).launch).not.toBe(first.launch);
  });

  it("holds steps until a sender lends its RPC, then sends them in one batch", async () => {
    const h = harness();
    h.recorder.step("screen", "project notes-app");
    h.recorder.step("press", "accept");
    await h.fire();
    expect(h.sent).toEqual([]);
    h.recorder.setSender(h.send);
    await Promise.resolve();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.steps.map((step) => step.what)).toEqual(["project notes-app", "accept"]);
    expect(h.sent[0]?.state).toBe("foreground");
  });

  it("sends steps at most once per pause, not one call per step", async () => {
    const h = harness();
    h.recorder.setSender(h.send);
    h.recorder.step("press", "one");
    h.recorder.step("press", "two");
    h.recorder.step("keyboard", "shown");
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.ms).toBe(SEND_EVERY_MS);
    expect(h.sent).toEqual([]);
    await h.fire();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.steps).toHaveLength(3);
  });

  it("sends an error and leaving the foreground at once", async () => {
    const h = harness();
    h.recorder.setSender(h.send);
    h.recorder.step("app", "background");
    h.recorder.setState("background");
    await Promise.resolve();
    expect(h.sent.at(-1)?.state).toBe("background");
    h.recorder.error("fatal", "app", new Error("boom"));
    await Promise.resolve();
    expect(h.sent.at(-1)?.errors[0]).toMatchObject({ source: "fatal", message: "Error: boom" });
  });

  it("keeps what a failed send carried for the next try", async () => {
    const h = harness();
    h.recorder.setSender(h.send);
    h.fail(true);
    h.recorder.error("boundary", "ticket panel", new Error("first"));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.sent).toEqual([]);
    expect(h.timers).toHaveLength(1);
    h.fail(false);
    await h.fire();
    expect(h.sent[0]?.errors.map((error) => error.message)).toEqual(["Error: first"]);
  });

  it("caps the waiting steps and errors while nothing can send", () => {
    const h = harness();
    Array.from({ length: TRAIL_STEPS + 5 }, (_, index) => h.recorder.step("press", `step-${index}`));
    Array.from({ length: TRAIL_ERRORS + 3 }, (_, index) => h.recorder.error("error", "app", new Error(`e${index}`)));
    const sent: Omit<TrailReport, "device">[] = [];
    h.recorder.setSender(async (report) => {
      sent.push(report);
    });
    expect(sent[0]?.steps).toHaveLength(TRAIL_STEPS);
    expect(sent[0]?.steps[0]?.what).toBe("step-5");
    expect(sent[0]?.errors.map((error) => error.message)).toEqual(["Error: e0", "Error: e1", "Error: e2", "Error: e3", "Error: e4"]);
  });

  it("drops an unmounted surface's sender only if it is still the current one", async () => {
    const h = harness();
    const other: TrailSend = async () => undefined;
    h.recorder.setSender(h.send);
    h.recorder.clearSender(other);
    h.recorder.step("press", "kept");
    await h.fire();
    expect(h.sent).toHaveLength(1);
    h.recorder.clearSender(h.send);
    h.recorder.step("press", "waits");
    await h.fire();
    expect(h.sent).toHaveLength(1);
  });

  it("does not let a send that never settles block sending for good", async () => {
    const h = harness();
    h.recorder.step("press", "stuck");
    h.recorder.setSender(() => new Promise<void>(() => undefined));
    h.recorder.setSender(h.send);
    expect(h.sent).toEqual([]);
    h.advance(61_000);
    await h.recorder.flush();
    expect(h.sent).toHaveLength(1);
  });
});
