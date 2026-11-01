import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBandClock, runBandClock, sameRuns } from "./band-clock";
import { shimmerRuns } from "./shimmer";

describe("the phone shimmer's clock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("moves the band from one end to the other each cycle and tells its listeners every frame", () => {
    const clock = createBandClock(-4);
    const heard = vi.fn();
    clock.listeners.add(heard);
    let time = 0;
    const stop = runBandClock(clock, true, -4, 16, 1000, 33, () => time);
    expect(clock.position).toBe(-4);
    time = 500;
    vi.advanceTimersByTime(33);
    expect(clock.position).toBe(6);
    time = 1000;
    vi.advanceTimersByTime(33);
    expect(clock.position).toBe(-4);
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
  });

  it("stops ticking when stopped, and never starts while not running", () => {
    const clock = createBandClock(0);
    const heard = vi.fn();
    clock.listeners.add(heard);
    runBandClock(clock, false, 0, 10, 1000, 33)();
    vi.advanceTimersByTime(500);
    expect(heard).toHaveBeenCalledTimes(1);
    const stop = runBandClock(clock, true, 0, 10, 1000, 33);
    stop();
    heard.mockClear();
    vi.advanceTimersByTime(500);
    expect(heard).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("repaints only when a letter's shade changed", () => {
    const at = (position: number) => shimmerRuns("Read file", 0, position, 4.5);
    expect(sameRuns(at(-20), at(-30))).toBe(true);
    expect(sameRuns(at(2), at(2.0001))).toBe(true);
    expect(sameRuns(at(2), at(3))).toBe(false);
  });
});
