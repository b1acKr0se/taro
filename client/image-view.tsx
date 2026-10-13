/**
 * An image in a chat (and, from TR-021.02, in a ticket's evidence): a thumbnail that opens full
 * size, in a gallery of the images beside it that zooms and pans (TR-033; the arithmetic is in
 * `./zoom`). The client cannot read the daemon's disk, so a `file://` URI or an absolute path is read
 * through `taro.image.read`, which serves only the directories Taro's images live in; an `https://`
 * image loads directly.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Modal, PanResponder, Platform, Pressable, Text, View, type GestureResponderEvent } from "react-native";

import { readImageRpc } from "../shared/contracts";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE } from "./type-scale";
import {
  DOUBLE_TAP_MS,
  FIT,
  frameOf,
  gestureEnd,
  gestureMove,
  gestureStart,
  isAtFit,
  isZoomedIn,
  tapOutcome,
  toggleRealSize,
  wheelAt,
  zoomPercent,
  type Gesture,
  type Point,
  type Size,
  type Tap,
  type Transform,
} from "./zoom";

const THUMBNAIL_HEIGHT = 160;

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

/** One image of a gallery: what `ImageThumbnail` takes as `source` and `alt`. */
export interface GalleryImage {
  source: string;
  alt: string;
}

function labelOf(alt: string): string {
  return alt.trim() === "" ? "Image" : alt;
}

export function ImageThumbnail({
  source,
  alt,
  theme,
  height = THUMBNAIL_HEIGHT,
  set,
  index = 0,
}: {
  source: string;
  alt: string;
  theme: PluginTheme;
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
  if (uri === undefined) return <View accessibilityLabel={`${label}, loading`} style={frame} />;
  if (uri === null) {
    return (
      <View accessibilityLabel={`${label}: image not available`} style={frame}>
        <Text style={note}>Image not available</Text>
      </View>
    );
  }
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${label}, open full size`} style={frame} onPress={() => setOpen(true)}>
        <Image source={{ uri }} accessibilityLabel={label} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
      </Pressable>
      <ImageGallery images={images} start={open ? Math.min(Math.max(0, index), images.length - 1) : null} theme={theme} onClose={() => setOpen(false)} />
    </>
  );
}

/** The full-size view: the image at `start` of `images`, closed while `start` is null. */
export function ImageGallery({ images, start, theme, onClose }: { images: readonly GalleryImage[]; start: number | null; theme: PluginTheme; onClose: () => void }) {
  const [index, setIndex] = useState(start ?? 0);
  useEffect(() => {
    if (start !== null) setIndex(start);
  }, [start]);
  const shown = images[index];
  return (
    <Modal visible={start !== null} transparent animationType="fade" onRequestClose={onClose}>
      {start === null || shown === undefined ? null : (
        // Keyed by position, so each image starts at fit with its own gesture state.
        <GalleryPage key={index} image={shown} index={index} count={images.length} theme={theme} onIndex={setIndex} onClose={onClose} />
      )}
    </Modal>
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

/** A wheel delta in lines (Firefox) as pixels, so every browser zooms at the same rate. */
const WHEEL_LINE = 16;
const SETTLE_MS = 180;

function GalleryPage({
  image,
  index,
  count,
  theme,
  onIndex,
  onClose,
}: {
  image: GalleryImage;
  index: number;
  count: number;
  theme: PluginTheme;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { colors } = theme;
  const kind = useMemo(() => sourceOf(image.source), [image.source]);
  const uri = useImageUri(kind);
  const natural = useImageSize(uri);
  const label = labelOf(image.alt);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const frame = useMemo(() => frameOf(stage, natural), [stage, natural]);
  // Only what the header reads is state, so a moving finger does not re-render the page.
  const [percent, setPercent] = useState(0);
  const [atFit, setAtFit] = useState(true);
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const stageRef = useRef<View>(null);
  // Gesture handlers are made once and read the latest of everything through this.
  const live = useRef({ frame, index, count, onIndex, onClose, transform: FIT, origin: { x: 0, y: 0 } });
  live.current = { ...live.current, frame, index, count, onIndex, onClose };
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<Tap | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPercent(zoomPercent(live.current.transform, frame.pointsPerPixel));
  }, [frame.pointsPerPixel]);

  /** Shows a transform at once (following fingers) or eased (a tap, a button, a snap back). */
  function show(next: Transform, eased: boolean): void {
    live.current.transform = next;
    setPercent(zoomPercent(next, live.current.frame.pointsPerPixel));
    setAtFit(isAtFit(next));
    if (!eased) {
      translateX.setValue(next.x);
      translateY.setValue(next.y);
      scale.setValue(next.scale);
      return;
    }
    Animated.parallel([
      Animated.timing(translateX, { toValue: next.x, duration: SETTLE_MS, useNativeDriver: false }),
      Animated.timing(translateY, { toValue: next.y, duration: SETTLE_MS, useNativeDriver: false }),
      Animated.timing(scale, { toValue: next.scale, duration: SETTLE_MS, useNativeDriver: false }),
    ]).start();
  }
  const showRef = useRef(show);
  showRef.current = show;

  /** Stops an easing under a new touch and takes the image from where it is, not where it was heading. */
  function holdStill(): void {
    const held = { ...live.current.transform };
    translateX.stopAnimation((value) => {
      held.x = value;
    });
    translateY.stopAnimation((value) => {
      held.y = value;
    });
    scale.stopAnimation((value) => {
      held.scale = value;
    });
    live.current.transform = held;
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
    if (outcome.kind === "zoom") showRef.current(outcome.transform, true);
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
        if (step.transform !== null) showRef.current(step.transform, false);
      },
      onPanResponderRelease: (_event, moved) => {
        const state = gesture.current;
        gesture.current = null;
        if (state === null) return;
        const { transform: current, index: at, count: total, frame: bounds } = live.current;
        const end = gestureEnd(state, current, moved, Date.now(), at, total, bounds);
        if (end.kind === "tap") onTap(end.at);
        else if (end.kind === "show") live.current.onIndex(end.index);
        else if (end.kind === "settle") showRef.current(end.transform, true);
      },
      onPanResponderTerminate: () => {
        const state = gesture.current;
        gesture.current = null;
        if (state !== null && !isZoomedIn(state.start)) showRef.current(state.start, true);
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
      showRef.current(wheelAt(live.current.transform, delta, event.ctrlKey, at, live.current.frame), false);
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

  const button = { paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 };
  const buttonText = { color: colors.foreground, fontSize: FONT_SIZE.small };
  const arrow = {
    position: "absolute" as const,
    top: "50%" as const,
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: withAlpha(colors.surface1, 0.85),
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  const arrowText = { color: colors.foreground, fontSize: FONT_SIZE.display, lineHeight: FONT_SIZE.display + 2 };

  return (
    <View style={{ flex: 1, backgroundColor: withAlpha(colors.surface0, 0.94), padding: SPACE.lg, gap: SPACE.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
        <Text numberOfLines={1} style={{ flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>
          {count > 1 ? `${index + 1} / ${count}  ` : ""}
          {label}
        </Text>
        {natural === null ? null : (
          <>
            <Text accessibilityLabel={`Zoom ${percent} percent`} style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>
              {percent}%
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={atFit ? "Show at real size" : "Fit to screen"}
              onPress={() => show(toggleRealSize(live.current.transform, frame), true)}
              style={button}
            >
              <Text style={buttonText}>{atFit ? "100%" : "Fit"}</Text>
            </Pressable>
          </>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={button}>
          <Text style={buttonText}>Close</Text>
        </Pressable>
      </View>
      <View
        ref={stageRef}
        onLayout={(event) => onStageLayout(event.nativeEvent.layout.width, event.nativeEvent.layout.height)}
        style={{ flex: 1, overflow: "hidden" }}
        {...responder.panHandlers}
      >
        {uri === null ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small, textAlign: "center", marginTop: SPACE.xl }}>Image not available</Text>
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
        {index > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Previous image" onPress={() => onIndex(index - 1)} style={[arrow, { left: SPACE.sm }]}>
            <Text style={arrowText}>‹</Text>
          </Pressable>
        ) : null}
        {index < count - 1 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Next image" onPress={() => onIndex(index + 1)} style={[arrow, { right: SPACE.sm }]}>
            <Text style={arrowText}>›</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
