/**
 * "Working… 42s" under a chat's last message (TR-176). The word shimmers: a light wave of opacity over
 * its letters (React Native has no gradient text); the time beside it stays still. Plain text when the
 * phone's reduce-motion setting is on.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Text, View } from "react-native";

import { SPACE } from "./spacing";
import { FONT_SIZE } from "./type-scale";
import { useNow } from "./use-now";
import { shimmerOpacity, WORKING_LABEL, workingRow } from "./working-row";

const PASS_MS = 1600;
/** Frames the wave is sampled at: each letter's opacity is looked up from the same pure function the tests cover. */
const STEPS = 24;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    // Not every host has it: feature-detected, and a failed read keeps the motion.
    const info = AccessibilityInfo as Partial<typeof AccessibilityInfo>;
    if (typeof info.isReduceMotionEnabled !== "function") return;
    let live = true;
    void Promise.resolve(info.isReduceMotionEnabled()).then((value) => live && setReduced(value === true), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  return reduced;
}

function ShimmerWord({ theme, text, still }: { theme: PluginTheme; text: string; still: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    progress.setValue(0);
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: PASS_MS, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [still, progress]);
  const letters = Array.from(text);
  const inputRange = Array.from({ length: STEPS + 1 }, (_, step) => step / STEPS);
  return (
    <View style={{ flexDirection: "row" }}>
      {letters.map((letter, index) => (
        <Animated.Text
          key={index}
          style={{
            color: theme.colors.foregroundMuted,
            fontSize: FONT_SIZE.small,
            opacity: still ? 1 : progress.interpolate({ inputRange, outputRange: inputRange.map((at) => shimmerOpacity(index, letters.length, at)) }),
          }}
        >
          {letter}
        </Animated.Text>
      ))}
    </View>
  );
}

/** Null unless a turn runs. Ticks each second on its own, so the chat around it does not redraw. */
export function WorkingRow({ theme, status, turnStartedAt }: { theme: PluginTheme; status: string | null | undefined; turnStartedAt: string | null | undefined }) {
  const now = useNow(1000);
  const reduced = useReducedMotion();
  const row = workingRow(status, turnStartedAt, now);
  if (row === null) return null;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={row.elapsed === null ? "Working" : `Working, ${row.elapsed}`}
      style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingVertical: SPACE.xs }}
    >
      <ShimmerWord theme={theme} text={WORKING_LABEL} still={reduced} />
      {row.elapsed === null ? null : <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small }}>{row.elapsed}</Text>}
    </View>
  );
}
