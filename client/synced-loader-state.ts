/**
 * The steps of the dot loader at the end of a working agent's chat (TR-183).
 *
 * Ported from Paseo (5293dda, Apache-2.0): `packages/app/src/components/synced-loader-state.ts`.
 * Changed: no worklet directives (no Reanimated here), and the steps laid out as an interpolation
 * React Native's `Animated` can run.
 */
export const SYNCED_LOADER_DURATION_MS = 950;
export const SYNCED_LOADER_DOT_COUNT = 6;

const SYNCED_LOADER_OPACITY_STATES = [
  [1, 0, 0.78, 0, 0.56, 0.34],
  [0.78, 1, 0.56, 0, 0.34, 0],
  [0.56, 0.78, 0.34, 1, 0, 0],
  [0.34, 0.56, 0, 0.78, 0, 1],
  [0, 0.34, 0, 0.56, 1, 0.78],
  [0, 0, 1, 0.34, 0.78, 0.56],
] as const;

export function getSyncedLoaderDotOpacity(step: number, dot: number): number {
  return SYNCED_LOADER_OPACITY_STATES[step]?.[dot] ?? 0;
}

/** Just under a whole step: each step holds its opacities until the next starts, with no fade between. */
const STEP_EDGE = 0.001;

/**
 * Dot `dot`'s opacity over one pass of a value running 0 to the dot count: a staircase, one stair
 * per step, so a linear animation of that value plays the steps as Paseo's clock does.
 */
export function syncedLoaderDotSteps(dot: number): { inputRange: number[]; outputRange: number[] } {
  const steps = Array.from({ length: SYNCED_LOADER_DOT_COUNT }, (_, step) => step);
  return {
    inputRange: steps.flatMap((step) => [step, step + 1 - STEP_EDGE]),
    outputRange: steps.flatMap((step) => [getSyncedLoaderDotOpacity(step, dot), getSyncedLoaderDotOpacity(step, dot)]),
  };
}
