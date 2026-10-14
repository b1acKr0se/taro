/**
 * An image in a chat (and, from TR-021.02, in a ticket's evidence): a thumbnail that opens full
 * size, in a gallery of the images beside it that zooms and pans (TR-033; the arithmetic is in
 * `./zoom`; the top bar, the safe area and smooth gestures are TR-042; clearing the macOS desktop
 * app's window controls is TR-048). The client cannot read the
 * daemon's disk, so a `file://` URI or an absolute path is read through `taro.image.read`, which serves only the directories Taro's images live in; an `https://`
 * image loads directly.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Modal, PanResponder, Platform, SafeAreaView, StatusBar, Text, View, type GestureResponderEvent, type ViewStyle } from "react-native";

import { readImageRpc } from "../shared/contracts";
import { watchFullScreen } from "./desktop-window";
import { ErrorBoundary } from "./error-boundary";
import { Pressable } from "./focus";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { captionOf, viewerBarText } from "./viewer-bar";
import { isMacDesktopShell, windowControlsInset } from "./window-chrome";
import {
  DOUBLE_TAP_MS,
  FIT,
  frameOf,
  gestureEnd,
  gestureMove,
  gestureStart,
  isAtFit,
  isZoomedIn,
  positionAt,
  settleEasing,
  tapOutcome,
  toggleRealSize,
  wheelAt,
  type Ease,
  type Gesture,
  type Point,
  type Size,
  type Tap,
  type Transform,
} from "./zoom";

const THUMBNAIL_HEIGHT = 160;
const CAPTION_MIN_WIDTH = 120;

type ImageSource = { kind: "local"; path: string } | { kind: "remote"; uri: string } | { kind: "none" };

function sourceOf(source: string): ImageSource {
  if (source.startsWith("file://") || source.startsWith("/")) return { kind: "local", path: source };
  if (source.startsWith("https://")) return { kind: "remote", uri: source };
  return { kind: "none" };
}

/** The image as a URI the `Image` component can draw: undefined while loading, null when it cannot be had. */
function useImageUri(source: ImageSource): string | null | undefined {
  const read = useRpc(readImageRpc);
  const path = source.kind === "local" ? source.path : "";
  const query = useQuery({
    queryKey: ["taro", "image", path] as const,
    queryFn: () => read({ path }),
    enabled: source.kind === "local",
    // An image file does not change under its name: evidence and sent images are written once.
    staleTime: Infinity,
    retry: 1,
  });
  if (source.kind === "remote") return source.uri;
  if (source.kind === "none") return null;
  if (query.isError) return null;
  if (query.data === undefined) return undefined;
  return query.data.image === null ? null : `data:${query.data.image.mimeType};base64,${query.data.image.data}`;
}

/** The image's size in pixels once known: the thumbnail keeps its shape, the gallery fits and zooms it. */
function useImageSize(uri: string | null | undefined): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    if (typeof uri !== "string") return;
    let current = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (current && width > 0 && height > 0) setSize({ width, height });
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [uri]);
  return size;
}

/** One image of a gallery: what `ImageThumbnail` takes as `source` and `alt`, and the decision option it shows, if any (TR-055). */
export interface GalleryImage {
  source: string;
  alt: string;
  title?: string;
}

const labelOf = captionOf;

export function ImageThumbnail({
  source,
  alt,
  theme,
  height = THUMBNAIL_HEIGHT,
  set,
  index = 0,
  captioned = false,
}: {
  source: string;
  alt: string;
  theme: PluginTheme;
  /** Shows the alt text under the thumbnail, two lines at most and no wider than it (TR-055). */
  captioned?: boolean;
  /** The thumbnail's height; its width follows the image. */
  height?: number;
  /** The images the full-size view moves through (those of one message or evidence record), this one at `index`; alone without. */
  set?: readonly GalleryImage[];
  index?: number;
}) {
  const kind = useMemo(() => sourceOf(source), [source]);
  const uri = useImageUri(kind);
  const size = useImageSize(uri);
  const [open, setOpen] = useState(false);
  const { colors } = theme;
  const label = labelOf(alt);
  const frame = {
    height,
    width: height * (size === null ? 4 / 3 : size.width / size.height),
    maxWidth: "100%" as const,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    overflow: "hidden" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  const note = { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, padding: SPACE.sm, textAlign: "center" as const };
  const images = set === undefined || set.length === 0 ? [{ source, alt }] : set;

  if (kind.kind === "none") return <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>[{label}]</Text>;
  const shown =
    uri === undefined ? (
      <View accessibilityLabel={`${label}, loading`} style={frame} />
    ) : uri === null ? (
      <View accessibilityLabel={`${label}: image not available`} style={frame}>
        <Text style={note}>Image not available</Text>
      </View>
    ) : (
      <>
        <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${label}, open full size`} style={frame} onPress={() => setOpen(true)}>
          <Image source={{ uri }} accessibilityLabel={label} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
        </Pressable>
        <ImageGallery images={images} start={open ? Math.min(Math.max(0, index), images.length - 1) : null} onClose={() => setOpen(false)} />
      </>
    );
  if (!captioned || alt.trim() === "") return shown;
  return (
    // A portrait shot is narrow: its caption gets room for a few words a line, the shot at its left.
    <View style={{ width: Math.max(frame.width, CAPTION_MIN_WIDTH), maxWidth: "100%", gap: SPACE.xxs }}>
      {shown}
      <Text numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) }}>
        {alt}
      </Text>
    </View>
  );
}

/** The full-size view: the image at `start` of `images`, closed while `start` is null. */
export function ImageGallery({ images, start, onClose }: { images: readonly GalleryImage[]; start: number | null; onClose: () => void }) {
  const [index, setIndex] = useState(start ?? 0);
  useEffect(() => {
    if (start !== null) setIndex(start);
  }, [start]);
  const shown = images[index];
  return (
    // Drawn under Android's status and navigation bars, as the app's edge-to-edge screens are, so the
    // top bar can pad by the status bar's height itself.
    <Modal visible={start !== null} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {start === null || shown === undefined ? null : (
        // Keyed by position, so each image starts at fit with its own gesture state. A failure inside stays in the viewer, not the whole plugin (TR-054).
        <ErrorBoundary key={index} label="image viewer" fallback={<ViewerFailed onClose={onClose} />}>
          <GalleryPage image={shown} index={index} count={images.length} onIndex={setIndex} onClose={onClose} />
        </ErrorBoundary>
      )}
    </Modal>
  );
}

/** The viewer when it failed: the image's backdrop, a line saying so and a way out, with nothing that could fail again. */
function ViewerFailed({ onClose }: { onClose: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: VIEWER.backdrop, alignItems: "center", justifyContent: "center", padding: SPACE.xl, gap: SPACE.md }}>
      <Text style={{ color: VIEWER.textMuted, fontSize: FONT_SIZE.small, textAlign: "center" }}>This image could not be shown.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={SPACE.xs} style={{ minHeight: 44, paddingHorizontal: SPACE.lg, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: VIEWER.textMuted }}>
        <Text style={{ color: VIEWER.text, fontSize: FONT_SIZE.body, fontWeight: "600" }}>Close</Text>
      </Pressable>
    </View>
  );
}

/** What the web's DOM offers that this file uses; the plugin is typed without the DOM library. */
interface WebElement {
  addEventListener(type: string, listener: (event: WebWheelEvent) => void, options?: { passive: boolean }): void;
  removeEventListener(type: string, listener: (event: WebWheelEvent) => void): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}
interface WebWheelEvent {
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  clientX: number;
  clientY: number;
  preventDefault(): void;
}
interface WebKeyEvent {
  key: string;
}
interface WebDocument {
  addEventListener(type: string, listener: (event: WebKeyEvent) => void): void;
  removeEventListener(type: string, listener: (event: WebKeyEvent) => void): void;
}

/**
 * The strip the macOS desktop app keeps for its traffic lights (`./window-chrome`), zero on the web, on a
 * phone and in full screen. The shell is looked up when the viewer opens, as Paseo's app injects it.
 */
function useWindowControlsInset(): number {
  const web = Platform.OS === "web";
  const shell: unknown = web ? (globalThis as { paseoDesktop?: unknown }).paseoDesktop : undefined;
  const userAgent = web ? ((globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? "") : "";
  const mac = isMacDesktopShell(shell, userAgent);
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    if (!mac) return;
    return watchFullScreen((globalThis as { paseoDesktop?: unknown }).paseoDesktop, setFullScreen);
  }, [mac]);
  return windowControlsInset(shell, userAgent, fullScreen);
}

/** Electron's title-bar dragging, as Paseo's own desktop screens mark it; React Native's style types do not know the property. */
const WINDOW_DRAG = { WebkitAppRegion: "drag" } as unknown as ViewStyle;
const WINDOW_NO_DRAG = { WebkitAppRegion: "no-drag" } as unknown as ViewStyle;

/** A wheel delta in lines (Firefox) as pixels, so every browser zooms at the same rate. */
const WHEEL_LINE = 16;
const SETTLE_MS = 180;
/** Eased moves run on the UI thread on a phone; the web has no native driver. */
const NATIVE_DRIVER = Platform.OS !== "web";
const VALUE_CONFIG = NATIVE_DRIVER ? { useNativeDriver: true } : undefined;
/** The top bar's row, below the status bar: a touch target's height. */
const BAR_HEIGHT = 52;
/** How far the bar's fade reaches below the bar, and in how many steps (core React Native draws no gradient); it stays dense behind the controls and drops off below them. */
const FADE_REACH = 28;
const FADE_STEPS = 24;
const FADE_ALPHA = 0.9;
/**
 * The viewer's own colours, the one place Taro draws outside `theme.colors`: an enlarged image sits
 * on opaque black in either theme, so nothing behind it shows through (the user's choice, TR-042),
 * and the theme has no black, nor text that reads on it in the light theme.
 */
const VIEWER = { backdrop: "#000000", text: "#ffffff", textMuted: withAlpha("#ffffff", 0.7) } as const;

function GalleryPage({
  image,
  index,
  count,
  onIndex,
  onClose,
}: {
  image: GalleryImage;
  index: number;
  count: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const kind = useMemo(() => sourceOf(image.source), [image.source]);
  const uri = useImageUri(kind);
  const natural = useImageSize(uri);
  const label = labelOf(image.alt);
  const bar = viewerBarText({ title: image.title, alt: image.alt, index, count });
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  // The bar's height with its safe-area padding: the image at fit keeps clear of it and its fade, top and bottom.
  const [barHeight, setBarHeight] = useState(0);
  const frame = useMemo(() => frameOf(stage, natural, { width: 0, height: barHeight + FADE_REACH }), [stage, natural, barHeight]);
  // The only state a gesture touches is whether the image is at fit, set when that changes; a moving
  // finger only sets the animated values, so it never re-renders the page.
  const [atFit, setAtFit] = useState(true);
  const atFitShown = useRef(true);
  // Native from the start on a phone: setting a native value goes straight to the UI thread, where a
  // JS-side one makes Fabric commit the image's view again on every set (three per finger move).
  const translateX = useRef(new Animated.Value(0, VALUE_CONFIG)).current;
  const translateY = useRef(new Animated.Value(0, VALUE_CONFIG)).current;
  const scale = useRef(new Animated.Value(1, VALUE_CONFIG)).current;
  const stageRef = useRef<View>(null);
  // Gesture handlers are made once and read the latest of everything through this.
  const live = useRef({ frame, index, count, onIndex, onClose, transform: FIT, origin: { x: 0, y: 0 } });
  live.current = { ...live.current, frame, index, count, onIndex, onClose };
  const gesture = useRef<Gesture | null>(null);
  const easing = useRef<Ease | null>(null);
  const lastTap = useRef<Tap | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showFit(transform: Transform): void {
    const fit = isAtFit(transform);
    if (fit === atFitShown.current) return;
    atFitShown.current = fit;
    setAtFit(fit);
  }

  /** Puts the image at a transform at once, following fingers: animated values only. */
  function place(next: Transform): void {
    live.current.transform = next;
    translateX.setValue(next.x);
    translateY.setValue(next.y);
    scale.setValue(next.scale);
  }

  /**
   * Eases the image to a transform (a tap, a button, a snap back), from where it is, even part way
   * through another ease; the bar's Fit / 1:1 follows once it is there.
   */
  function settle(next: Transform): void {
    const now = Date.now();
    const ease = { from: positionAt(easing.current, live.current.transform, now, SETTLE_MS), to: next, startedAt: now };
    easing.current = ease;
    live.current.transform = next;
    const timing = (value: Animated.Value, toValue: number) => Animated.timing(value, { toValue, duration: SETTLE_MS, easing: settleEasing, useNativeDriver: NATIVE_DRIVER });
    Animated.parallel([timing(translateX, next.x), timing(translateY, next.y), timing(scale, next.scale)]).start(({ finished }) => {
      // A native ease reports its end later: a newer ease may have started since.
      if (!finished || easing.current !== ease) return;
      easing.current = null;
      showFitRef.current(next);
    });
  }
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const placeRef = useRef(place);
  placeRef.current = place;
  const showFitRef = useRef(showFit);
  showFitRef.current = showFit;

  /**
   * Stops an easing under a new touch and takes the image from where it is, not where it was heading.
   * Where it is comes from the easing's own curve: the native driver reports values only later.
   */
  function holdStill(): void {
    const moving = easing.current;
    if (moving === null) return;
    easing.current = null;
    translateX.stopAnimation();
    translateY.stopAnimation();
    scale.stopAnimation();
    placeRef.current(positionAt(moving, live.current.transform, Date.now(), SETTLE_MS));
  }

  /** A touch in stage coordinates, measured from the stage's centre. */
  function stagePoint(pageX: number, pageY: number): Point {
    const { origin, frame: bounds } = live.current;
    return { x: pageX - origin.x - bounds.stage.width / 2, y: pageY - origin.y - bounds.stage.height / 2 };
  }
  function pointsOf(event: GestureResponderEvent): Point[] {
    const touches = event.nativeEvent.touches;
    if (touches.length === 0) return [stagePoint(event.nativeEvent.pageX, event.nativeEvent.pageY)];
    return touches.map((touch) => stagePoint(touch.pageX, touch.pageY));
  }

  function onTap(at: Point): void {
    const tap = { at, time: Date.now() };
    const outcome = tapOutcome(lastTap.current, tap, live.current.transform, live.current.frame);
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    lastTap.current = outcome.kind === "zoom" ? null : tap;
    if (outcome.kind === "zoom") settleRef.current(outcome.transform);
    // Waits to see that this is not the first of a double-tap.
    else if (outcome.kind === "close") closeTimer.current = setTimeout(() => live.current.onClose(), DOUBLE_TAP_MS);
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        holdStill();
        gesture.current = gestureStart(live.current.transform, pointsOf(event), Date.now());
      },
      onPanResponderMove: (event) => {
        if (gesture.current === null) return;
        const { transform: current, count: total, frame: bounds } = live.current;
        const step = gestureMove(gesture.current, current, pointsOf(event), total, bounds);
        gesture.current = step.gesture;
        if (step.transform !== null) placeRef.current(step.transform);
      },
      onPanResponderRelease: (_event, moved) => {
        const state = gesture.current;
        gesture.current = null;
        if (state === null) return;
        const { transform: current, index: at, count: total, frame: bounds } = live.current;
        const end = gestureEnd(state, current, moved, Date.now(), at, total, bounds);
        if (end.kind === "tap") onTap(end.at);
        else if (end.kind === "show") live.current.onIndex(end.index);
        else if (end.kind === "settle") settleRef.current(end.transform);
        // An ease just started updates the bar when it lands.
        if (easing.current === null) showFitRef.current(live.current.transform);
      },
      onPanResponderTerminate: () => {
        const state = gesture.current;
        gesture.current = null;
        if (state === null) return;
        if (!isZoomedIn(state.start)) settleRef.current(state.start);
        if (easing.current === null) showFitRef.current(live.current.transform);
      },
    }),
  ).current;

  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  // The web's wheel (a trackpad pinch arrives as a wheel with ctrl held) and arrow and Escape keys.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const element = stageRef.current as unknown as WebElement | null;
    const page = (globalThis as { document?: WebDocument }).document;
    function onWheel(event: WebWheelEvent): void {
      event.preventDefault();
      const box = element?.getBoundingClientRect();
      if (box === undefined) return;
      holdStill();
      const at = { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 };
      const delta = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE : event.deltaY;
      const next = wheelAt(live.current.transform, delta, event.ctrlKey, at, live.current.frame);
      placeRef.current(next);
      showFitRef.current(next);
    }
    function onKey(event: WebKeyEvent): void {
      const { index: at, count: total } = live.current;
      if (event.key === "Escape") live.current.onClose();
      else if (event.key === "ArrowLeft" && at > 0) live.current.onIndex(at - 1);
      else if (event.key === "ArrowRight" && at < total - 1) live.current.onIndex(at + 1);
    }
    if (element !== null && typeof element.addEventListener === "function") element.addEventListener("wheel", onWheel, { passive: false });
    page?.addEventListener("keydown", onKey);
    return () => {
      if (element !== null && typeof element.removeEventListener === "function") element.removeEventListener("wheel", onWheel);
      page?.removeEventListener("keydown", onKey);
    };
  }, []);

  function onStageLayout(width: number, height: number): void {
    setStage({ width, height });
    stageRef.current?.measureInWindow((x, y) => {
      live.current.origin = { x, y };
    });
  }

  // Android draws the modal under its status bar (statusBarTranslucent); iOS pads in SafeAreaView; the web needs neither.
  const statusBarHeight = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  const SafeArea = Platform.OS === "ios" ? SafeAreaView : View;
  // The macOS desktop app's traffic lights sit over the window's top-left corner: the bar goes below their strip, which drags the window as the title bar would.
  const windowControls = useWindowControlsInset();
  const control = { minWidth: 44, height: 44, alignItems: "center" as const, justifyContent: "center" as const, borderRadius: 22 };
  const controlText = { color: VIEWER.text, fontSize: FONT_SIZE.body, fontWeight: "600" as const };

  return (
    <View style={{ flex: 1, backgroundColor: VIEWER.backdrop }}>
      <View
        ref={stageRef}
        onLayout={(event) => onStageLayout(event.nativeEvent.layout.width, event.nativeEvent.layout.height)}
        style={{ flex: 1, overflow: "hidden" }}
        {...responder.panHandlers}
      >
        {uri === null ? (
          <Text style={{ color: VIEWER.textMuted, fontSize: FONT_SIZE.small, textAlign: "center", marginTop: barHeight + SPACE.xl }}>Image not available</Text>
        ) : uri === undefined || frame.fitted.width === 0 ? null : (
          <Animated.View
            style={{
              position: "absolute",
              left: (stage.width - frame.fitted.width) / 2,
              top: (stage.height - frame.fitted.height) / 2,
              width: frame.fitted.width,
              height: frame.fitted.height,
              transform: [{ translateX }, { translateY }, { scale }],
            }}
          >
            <Image source={{ uri }} accessibilityLabel={label} resizeMode="contain" style={{ width: "100%", height: "100%" }} />
          </Animated.View>
        )}
      </View>
      {/* Over the stage; touches between the controls pass through to it. */}
      <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }} onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}>
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: -FADE_REACH }}>
          {Array.from({ length: FADE_STEPS }, (_, step) => (
            <View key={step} style={{ flex: 1, backgroundColor: withAlpha(VIEWER.backdrop, FADE_ALPHA * (1 - (step / FADE_STEPS) ** 2)) }} />
          ))}
        </View>
        <SafeArea pointerEvents="box-none">
          {windowControls === 0 ? null : <View style={[{ height: windowControls }, WINDOW_DRAG]} />}
          <View
            pointerEvents="box-none"
            style={[{ marginTop: statusBarHeight, height: BAR_HEIGHT, flexDirection: "row", alignItems: "center", paddingHorizontal: SPACE.xs }, windowControls === 0 ? null : WINDOW_NO_DRAG]}
          >
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={SPACE.xs} style={control}>
              <Text style={{ color: VIEWER.text, fontSize: FONT_SIZE.subtitle + 4 }}>✕</Text>
            </Pressable>
            <View pointerEvents="none" style={{ flex: 1, alignItems: "center", paddingHorizontal: SPACE.sm }}>
              {bar.heading === null ? null : (
                <Text numberOfLines={1} style={controlText}>
                  {bar.heading}
                </Text>
              )}
              <Text numberOfLines={1} style={bar.heading === null ? controlText : { color: VIEWER.textMuted, fontSize: FONT_SIZE.caption }}>
                {bar.caption}
              </Text>
            </View>
            {natural === null ? (
              <View style={control} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={atFit ? "Show at real size" : "Fit to screen"}
                onPress={() => settle(toggleRealSize(live.current.transform, live.current.frame))}
                hitSlop={SPACE.xs}
                style={control}
              >
                <Text style={controlText}>{atFit ? "1:1" : "Fit"}</Text>
              </Pressable>
            )}
          </View>
        </SafeArea>
      </View>
    </View>
  );
}
