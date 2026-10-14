/**
 * Android's back for the Taro screen (TR-065), through React Native's `BackHandler`: the host's own,
 * which Paseo's app uses the same way. Listeners run newest first, so the screen's runs before the
 * app's navigator; returning false lets the app leave Taro as before. The host unmounts the screen
 * when the user navigates away, so the listener is live only while Taro shows. iOS and the web
 * have no hardware back, and a plugin cannot take over iOS's edge swipe.
 */
import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";

import { createBackStack, pressBack } from "./back-steps";

/** Overlays and an open ticket, closed newest first. */
const openSteps = createBackStack();

/** While `open`, back runs `close` before anything opened earlier and before the screen's own step. */
export function useBackStep(open: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return undefined;
    return openSteps.push(() => latest.current());
  }, [open]);
}

/**
 * The screen's listener, added once on mount. It closes what is open first (`useBackStep`), then
 * runs `step`, the screen's own step back, which says whether it took one.
 */
export function useScreenBack(step: () => boolean): void {
  const latest = useRef(step);
  latest.current = step;
  useEffect(() => {
    // Feature-detected: a host whose React Native lacks it keeps today's back.
    if (typeof BackHandler?.addEventListener !== "function") return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => pressBack(openSteps, () => latest.current()));
    return () => subscription.remove();
  }, []);
}
