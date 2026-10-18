import { describe, expect, it } from "vitest";

import { getSyncedLoaderDotOpacity, SYNCED_LOADER_DOT_COUNT, syncedLoaderDotSteps } from "./synced-loader-state";

describe("syncedLoaderDotSteps", () => {
  it("holds each step's opacity for the whole step, in Paseo's order", () => {
    const { inputRange, outputRange } = syncedLoaderDotSteps(0);
    expect(inputRange[0]).toBe(0);
    expect(inputRange[inputRange.length - 1]).toBeLessThan(SYNCED_LOADER_DOT_COUNT);
    expect(outputRange).toEqual([1, 1, 0.78, 0.78, 0.56, 0.56, 0.34, 0.34, 0, 0, 0, 0]);
  });

  it("gives an increasing input range, as Animated requires", () => {
    for (let dot = 0; dot < SYNCED_LOADER_DOT_COUNT; dot += 1) {
      const { inputRange, outputRange } = syncedLoaderDotSteps(dot);
      expect(inputRange.length).toBe(outputRange.length);
      expect(inputRange.every((value, index) => index === 0 || value > (inputRange[index - 1] ?? -1))).toBe(true);
    }
  });

  it("lights one dot fully at every step", () => {
    for (let step = 0; step < SYNCED_LOADER_DOT_COUNT; step += 1) {
      const lit = Array.from({ length: SYNCED_LOADER_DOT_COUNT }, (_, dot) => getSyncedLoaderDotOpacity(step, dot)).filter((opacity) => opacity === 1);
      expect(lit).toHaveLength(1);
    }
  });

  it("is dark outside the grid", () => {
    expect(getSyncedLoaderDotOpacity(6, 0)).toBe(0);
    expect(getSyncedLoaderDotOpacity(0, 6)).toBe(0);
  });
});
