import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPressGuard, DONE_MS, HOLD_MS, press, type PressShown } from "./press-guard";

/** A call that settles when the test says so. */
function pending<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("createPressGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls once when pressed twice in the same frame", async () => {
    const guard = createPressGuard();
    const call = pending<void>();
    const action = vi.fn(() => call.promise);
    const first = guard.run("catch-up", action);
    const second = guard.run("catch-up", action);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
    call.resolve();
    await first;
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("holds every button of its group while one runs", () => {
    const guard = createPressGuard();
    const nudge = vi.fn(() => new Promise<void>(() => undefined));
    const relaunch = vi.fn(() => Promise.resolve());
    guard.run("nudge", nudge);
    expect(guard.run("relaunch", relaunch)).toBeNull();
    expect(relaunch).not.toHaveBeenCalled();
    expect(guard.shown()).toEqual({ key: "nudge", phase: "busy" });
  });

  it("goes busy, shows the check, then idles after the check's time", async () => {
    const seen: (PressShown | null)[] = [];
    const guard = createPressGuard({ onChange: (shown) => seen.push(shown) });
    const call = pending<string>();
    const running = guard.run("compact", () => call.promise);
    expect(guard.locked()).toBe(true);
    call.resolve("ok");
    expect(await running).toEqual({ ok: true, value: "ok" });
    expect(guard.shown()).toEqual({ key: "compact", phase: "done" });
    vi.advanceTimersByTime(DONE_MS - 1);
    expect(guard.shown()).toEqual({ key: "compact", phase: "done" });
    vi.advanceTimersByTime(1);
    expect(guard.shown()).toBeNull();
    expect(seen).toEqual([{ key: "compact", phase: "busy" }, { key: "compact", phase: "done" }, null]);
  });

  it("takes a new press while the check shows", async () => {
    const guard = createPressGuard();
    const action = vi.fn(() => Promise.resolve());
    await guard.run("catch-up", action);
    expect(guard.shown()?.phase).toBe("done");
    const again = guard.run("catch-up", action);
    expect(again).not.toBeNull();
    expect(action).toHaveBeenCalledTimes(2);
    expect(guard.shown()).toEqual({ key: "catch-up", phase: "busy" });
    await again;
    // The first check's timer was replaced, so the second check gets its full time.
    vi.advanceTimersByTime(DONE_MS - 1);
    expect(guard.shown()?.phase).toBe("done");
  });

  it("is usable again at once after a failure, and says why", async () => {
    const guard = createPressGuard();
    const failure = new Error("the manager is not running");
    const outcome = await guard.run("compact", () => Promise.reject(failure));
    expect(outcome).toEqual({ ok: false, error: failure });
    expect(guard.locked()).toBe(false);
    expect(guard.shown()).toBeNull();
    const action = vi.fn(() => Promise.resolve());
    expect(guard.run("compact", action)).not.toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("treats an action that throws before returning a promise as a failure", async () => {
    const guard = createPressGuard();
    const outcome = await guard.run("nudge", () => {
      throw new Error("no agent");
    });
    expect(outcome?.ok).toBe(false);
    expect(guard.locked()).toBe(false);
  });

  it("stays busy after success while its button is to leave, then gives up after the hold", async () => {
    const guard = createPressGuard();
    const action = vi.fn(() => Promise.resolve());
    await guard.run("accept", action, "hold");
    expect(guard.shown()).toEqual({ key: "accept", phase: "busy" });
    expect(guard.run("accept", action, "hold")).toBeNull();
    vi.advanceTimersByTime(HOLD_MS);
    expect(guard.shown()).toBeNull();
    expect(guard.locked()).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("reports nothing and starts nothing once disposed", async () => {
    const onChange = vi.fn();
    const guard = createPressGuard({ onChange });
    const call = pending<void>();
    const running = guard.run("catch-up", () => call.promise);
    onChange.mockClear();
    guard.dispose();
    call.resolve();
    await running;
    vi.runAllTimers();
    expect(onChange).not.toHaveBeenCalled();
    expect(guard.run("catch-up", () => Promise.resolve())).toBeNull();
  });
});

describe("press", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends one acceptTicket call for an Accept double tap", async () => {
    const guard = createPressGuard();
    const call = pending<Record<string, never>>();
    const acceptTicket = vi.fn((_input: { project: string; ticket: string }) => call.promise);
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const tap = () => press(guard, "accept", () => acceptTicket({ project: "notes", ticket: "NT-7" }), { after: "hold", onSuccess, onError });
    expect(tap()).toBe(true);
    expect(tap()).toBe(false);
    call.resolve({});
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    // Still pressed while the card waits for the accepted ticket to leave it.
    expect(tap()).toBe(false);
    expect(acceptTicket).toHaveBeenCalledTimes(1);
    expect(acceptTicket).toHaveBeenCalledWith({ project: "notes", ticket: "NT-7" });
    expect(onError).not.toHaveBeenCalled();
  });

  it("hands the failure to onError and takes the next press", async () => {
    const guard = createPressGuard();
    const onError = vi.fn();
    const failure = new Error("evidence is incomplete");
    press(guard, "accept", () => Promise.reject(failure), { onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    const action = vi.fn(() => Promise.resolve());
    expect(press(guard, "accept", action, { onError })).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
