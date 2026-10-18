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
 * is layers of a white copy of the words, each seen through a window sliding with the band (TR-184);
 * and the time redraws when its text changes (`working-time.ts`), not every second.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Text, View, type LayoutChangeEvent } from "react-native";

import { isWorking } from "../shared/pending-sends";
import { shimmerDurationMs, shimmerLayers, shimmerMetrics } from "./shimmer";
import { SPACE } from "./spacing";
import { SYNCED_LOADER_DOT_COUNT, SYNCED_LOADER_DURATION_MS, syncedLoaderDotSteps } from "./synced-loader-state";
import { FONT_SIZE } from "./type-scale";
import { useWorkingElapsed } from "./use-working-elapsed";
import { startWebShimmer, webShimmerSupported } from "./web-shimmer";

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

/** Null unless a turn runs: Paseo's loader and how long the turn has run, under a chat's last message. */
export function WorkingStatus({ theme, status, turnStartedAt }: { theme: PluginTheme; status: string | null | undefined; turnStartedAt: string | null | undefined }) {
  if (!isWorking(status)) return null;
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

/** The phone's gradient, in layers: enough that its steps read as one soft band, as Paseo's. */
const SHIMMER_LAYERS = shimmerLayers(8);

/** A phone's layer: a window `share` of the band wide sliding with it, over the white copy held still beneath (the copy moves back as far as the window moves). */
function ShimmerBand({
  band,
  travel,
  peakWidth,
  size,
  style,
  children,
}: {
  band: (typeof SHIMMER_LAYERS)[number];
  travel: Animated.Value;
  peakWidth: number;
  size: { width: number; height: number };
  style: object | undefined;
  children: ReactNode;
}) {
  const offset = (peakWidth * (1 - band.share)) / 2;
  const left = useMemo(() => Animated.add(travel, offset), [travel, offset]);
  const back = useMemo(() => Animated.multiply(left, -1), [left]);
  return (
    // Hidden from readers and touches: a copy of the words above, for the light only.
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", left: 0, top: 0, width: peakWidth * band.share, height: size.height, overflow: "hidden", opacity: band.opacity, transform: [{ translateX: left }] }}
    >
      <Animated.View style={[style, { position: "absolute", left: 0, top: 0, width: size.width, height: size.height, transform: [{ translateX: back }] }]}>{children}</Animated.View>
    </Animated.View>
  );
}

/** The web's copy of the words, laid over them, with Paseo's gradient clipped to its letters (`web-shimmer.ts`). */
function WebShimmerCopy({ durationMs, size, style, children }: { durationMs: number; size: { width: number; height: number }; style: object | undefined; children: ReactNode }) {
  const copy = useRef<View>(null);
  // Again when the words' row changes size: where each word starts sets its part of the band.
  useEffect(() => startWebShimmer(copy.current, durationMs), [durationMs, size.width, size.height]);
  return (
    // Hidden from readers and touches: a copy of the words above, for the light only; `aria-hidden` is the web's.
    <View
      ref={copy}
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[style, { position: "absolute", left: 0, top: 0, width: size.width, height: size.height }]}
    >
      {children}
    </View>
  );
}

/**
 * Words that shimmer while `active`: `render("base")` draws them as they read, and a copy,
 * `render("peak")` (in `SHIMMER_LIGHT` on a phone), carries the light across them. The copy is laid
 * out at the words' width, so it lines up letter for letter, cut where the words are cut.
 * `characters` sets the pace, as in Paseo.
 */
export function Shimmer({ active, characters, style, render }: { active: boolean; characters: number; style?: object; render: (tone: "base" | "peak") => ReactNode }) {
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const moving = active && !reduced && size.width > 0;
  const metrics = shimmerMetrics(characters, size.width);
  const travel = useRef(new Animated.Value(metrics.from)).current;
  useLoop(travel, metrics.from, metrics.to, metrics.durationMs, !moving || WEB);
  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };
  let light: ReactNode = null;
  if (moving && WEB) {
    light = webShimmerSupported() ? (
      <WebShimmerCopy durationMs={shimmerDurationMs(characters)} size={size} style={style}>
        {render("peak")}
      </WebShimmerCopy>
    ) : null;
  } else if (moving) {
    light = SHIMMER_LAYERS.map((band, index) => (
      <ShimmerBand key={index} band={band} travel={travel} peakWidth={metrics.peakWidth} size={size} style={style}>
        {render("peak")}
      </ShimmerBand>
    ));
  }
  return (
    // Measured on the web while idle too: react-native-web watches a view's layout only when it has `onLayout` from the start.
    <View style={style} onLayout={active || WEB ? measure : undefined}>
      {render("base")}
      {light}
    </View>
  );
}
