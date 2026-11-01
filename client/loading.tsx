/**
 * Paseo's look for work under way (TR-183): its six-dot loader with the turn's time at the end of a
 * working agent's chat, and the shimmer over a running tool call's words. Both hold still when the
 * phone's reduce-motion setting is on.
 *
 * Ported from Paseo (5293dda, Apache-2.0): `SyncedLoader` from
 * `packages/app/src/components/synced-loader.tsx`, `WorkingIndicator` from
 * `src/agent-stream/turn-footer.tsx`, and the tool call's shimmer from `src/components/message.tsx`.
 * Changed: React Native's `Animated` in place of Reanimated; on the web the shimmer's styles go on the
 * copy's elements (`web-shimmer.ts`); on a phone, which has no masked view for a plugin, the gradient
 * is the letters themselves recoloured toward white under the band (`shimmerRuns`, TR-246);
 * and the time redraws when its text changes (`working-time.ts`), not every second.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Text, View, type LayoutChangeEvent } from "react-native";

import { blendToWhite, shimmerDurationMs, shimmerMetrics, shimmerRuns, WEB_SHIMMER_COPY_BOX } from "./shimmer";
import { SPACE } from "./spacing";
import { SYNCED_LOADER_DOT_COUNT, SYNCED_LOADER_DURATION_MS, syncedLoaderDotSteps } from "./synced-loader-state";
import { FONT_SIZE } from "./type-scale";
import { useWorkingElapsed } from "./use-working-elapsed";
import { watchWebShimmer, webShimmerSupported } from "./web-shimmer";

const WEB = Platform.OS === "web";
// The web has no native animation driver and warns when asked for one.
const NATIVE_DRIVER = !WEB;
const GRID_COLUMNS = 2;
/** The height of the digits of the time beside it, at `FONT_SIZE.small`. */
const LOADER_SIZE = 10;

export function useReducedMotion(): boolean {
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

/** A loop of `value` from `from` to `to` over `durationMs`, stopped while `still`. */
function useLoop(value: Animated.Value, from: number, to: number, durationMs: number, still: boolean): void {
  useEffect(() => {
    value.setValue(from);
    if (still) return;
    const loop = Animated.loop(Animated.timing(value, { toValue: to, duration: durationMs, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }));
    loop.start();
    return () => loop.stop();
  }, [value, from, to, durationMs, still]);
}

/** Paseo's loader: six dots in two columns lighting in turn, filling `size` on its long side. */
export function DotLoader({ size, color }: { size: number; color: string }) {
  const reduced = useReducedMotion();
  const step = useRef(new Animated.Value(0)).current;
  useLoop(step, 0, SYNCED_LOADER_DOT_COUNT, SYNCED_LOADER_DURATION_MS, reduced);
  const gap = Math.max(1, Math.round(size * 0.12));
  const dot = Math.max(2, (size - gap * 2) / 3);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: dot * 2 + gap, height: dot * 3 + gap * 2 }}>
        {Array.from({ length: SYNCED_LOADER_DOT_COUNT }, (_, index) => (
          <Animated.View
            key={index}
            style={{
              position: "absolute",
              left: (index % GRID_COLUMNS) * (dot + gap),
              top: Math.floor(index / GRID_COLUMNS) * (dot + gap),
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: color,
              opacity: step.interpolate({ ...syncedLoaderDotSteps(index), extrapolate: "clamp" }),
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** Null unless `shown` (a turn runs, or a message is on its way to start one): Paseo's loader and how long the turn has run, under a chat's last message. */
export function WorkingStatus({ theme, shown, turnStartedAt }: { theme: PluginTheme; shown: boolean; turnStartedAt: string | null | undefined }) {
  if (!shown) return null;
  return <WorkingStatusRow theme={theme} turnStartedAt={turnStartedAt} />;
}

function WorkingStatusRow({ theme, turnStartedAt }: { theme: PluginTheme; turnStartedAt: string | null | undefined }) {
  const elapsed = useWorkingElapsed(turnStartedAt);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={elapsed === null ? "Agent at work" : `Agent at work for ${elapsed}`}
      style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", height: 24, gap: SPACE.sm, marginTop: SPACE.xs }}
    >
      {/* As tall as the time's digits, not Paseo's 14: its dots light in turn, and a taller grid lit only at the top read as a row above the time. */}
      <DotLoader size={LOADER_SIZE} color={theme.colors.foreground} />
      {elapsed === null ? null : <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small, fontVariant: ["tabular-nums"] }}>{elapsed}</Text>}
    </View>
  );
}

/** The web's copy of the words, laid over them, with Paseo's gradient clipped to its letters (`web-shimmer.ts`). */
function WebShimmerCopy({ durationMs, size, style, children }: { durationMs: number; size: { width: number; height: number }; style: object | undefined; children: ReactNode }) {
  const copy = useRef<View>(null);
  // Before the browser paints, so the copy never shows as plain white words for a frame; again when the
  // words' row changes size, as where each word starts sets its part of the band (new words: `watchWebShimmer`).
  useLayoutEffect(() => watchWebShimmer(copy.current, durationMs), [durationMs, size.width, size.height]);
  return (
    // Hidden from readers and touches: a copy of the words above, for the light only; `aria-hidden` is the web's.
    <View
      ref={copy}
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[style, WEB_SHIMMER_COPY_BOX]}
    >
      {children}
    </View>
  );
}

/** How often the phone's letters are recoloured: smooth to the eye, and only the few letters under the band change. */
const PHONE_FRAME_MS = 33;

/** The band's left edge, in letters, while `running`: from `from` to `to` every `durationMs`, as Paseo's track. */
function useBandPosition(running: boolean, from: number, to: number, durationMs: number): number {
  const [position, setPosition] = useState(from);
  useEffect(() => {
    setPosition(from);
    if (!running) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const share = ((Date.now() - startedAt) % durationMs) / durationMs;
      setPosition(from + (to - from) * share);
    }, PHONE_FRAME_MS);
    return () => clearInterval(timer);
  }, [running, from, to, durationMs]);
  return position;
}

/**
 * Words that shimmer while `active`. `render("base", paint)` draws them as they read; on a phone
 * `paint(text, start, colour)` gives the letters of `text` (whose first letter is letter `start` of the
 * words) in `colour`, those under the band mixed toward white, so it is one text with nothing laid
 * over it. On the web a copy, `render("peak")`, carries the light across them, clipped to its letters
 * (`web-shimmer.ts`). `characters` sets the pace, as in Paseo; `spanCharacters` (default the same) is
 * how many letters the words show, which the band crosses.
 */
export function Shimmer({
  active,
  characters,
  spanCharacters = characters,
  style,
  render,
}: {
  active: boolean;
  characters: number;
  spanCharacters?: number;
  style?: object;
  render: (tone: "base" | "peak", paint: (text: string, start: number, colour: string) => ReactNode) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const running = active && !reduced;
  const metrics = shimmerMetrics(spanCharacters);
  const durationMs = shimmerDurationMs(characters);
  const position = useBandPosition(running && !WEB, metrics.from, metrics.to, durationMs);
  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };
  const paint = (text: string, start: number, colour: string): ReactNode => {
    if (WEB || !running) return text;
    const runs = shimmerRuns(text, start, position, metrics.peakLetters);
    if (runs.every((run) => run.level === 0)) return text;
    return runs.map((run, index) => (run.level === 0 ? run.text : (
      // inherits colour: the run's own, a mix of the text's with white.
      <Text key={index} style={{ color: blendToWhite(colour, run.level) }}>{run.text}</Text>
    )));
  };
  let light: ReactNode = null;
  if (WEB && running && size.width > 0 && webShimmerSupported()) {
    light = (
      <WebShimmerCopy durationMs={durationMs} size={size} style={style}>
        {render("peak", paint)}
      </WebShimmerCopy>
    );
  }
  return (
    // Measured on the web while idle too: react-native-web watches a view's layout only when it has `onLayout` from the start.
    <View style={style} onLayout={WEB ? measure : undefined}>
      {render("base", paint)}
      {light}
    </View>
  );
}
