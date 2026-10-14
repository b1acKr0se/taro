/**
 * Keeping what the reader types clear of the on-screen keyboard.
 *
 * Paseo moves its own composer with `react-native-keyboard-controller`, which
 * is not among the modules a plugin may import, and a plugin surface is not
 * resized when the keyboard opens — so fields disappeared under it. React
 * Native's `KeyboardAvoidingView` is importable but measures itself against its
 * parent, which inside the host's screen needs an offset nobody here can know,
 * and `automaticallyAdjustKeyboardInsets` is iOS-only. So everything here
 * measures in window coordinates instead, the same space the keyboard's frame
 * is reported in, which is exact wherever the host puts the surface:
 *
 * - `useKeyboardOverlap` pads a view (the chat pane, composer included) clear
 *   of the keyboard;
 * - `KeyboardScrollView` (or `useKeyboardScroll` on a scroll view of your own)
 *   adds room at the end of its content for the part the keyboard covers and
 *   scrolls the focused field above the keyboard: when the keyboard opens, on
 *   the field's focus, and as its content grows while the reader types. Every
 *   field passes `useRevealFocused()` as its `onFocus`: that is how a scroll
 *   area knows the focused field is its own, not one in a modal over it or in
 *   the composer under it. A field followed by its own action passes that row
 *   (`useRevealFocused(actionsRef)`), and the two are revealed together.
 *
 * Where the platform resizes the window for the keyboard itself, the overlap
 * measures as zero and nothing moves. On the web, a phone browser's keyboard
 * shrinks the visual viewport, which stands in for the keyboard's frame.
 */
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  StatusBar,
  TextInput,
  View,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type ScrollView as NativeScrollView,
} from "react-native";

import { createFieldClaims, holds, keyboardRoom, revealOffset, revealSpan, roomNeeded, visibleSpan, type Span } from "./keyboard-reveal";

/** The keyboard's top edge in window coordinates (null once it hides), and how long its move takes. */
type KeyboardListener = (top: number | null, duration: number) => void;

/** A window-coordinate box, as `measureInWindow` reports it. */
interface WindowBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The parts of the browser's visual viewport read here; typed locally, the project has no DOM types. */
interface VisualViewportLike {
  height: number;
  offsetTop: number;
  scale: number;
  addEventListener(type: "resize" | "scroll", listener: () => void): void;
  removeEventListener(type: "resize" | "scroll", listener: () => void): void;
}

interface ElementLike {
  tagName?: string;
  getBoundingClientRect?(): { left: number; right: number; top: number; bottom: number };
}

interface BrowserLike {
  innerHeight: number;
  visualViewport?: VisualViewportLike | null;
  document?: { activeElement?: ElementLike | null };
}

/** Less than this shrinking of the viewport is the browser's own bars moving, not a keyboard, in points. */
const WEB_KEYBOARD_MIN = 80;

function browser(): BrowserLike | null {
  const candidate = globalThis as unknown as Partial<BrowserLike>;
  return typeof candidate.innerHeight === "number" ? (candidate as BrowserLike) : null;
}

/** The focused element on the web, when it is a field the reader types in. */
function focusedWebField(): ElementLike | null {
  const active = browser()?.document?.activeElement ?? null;
  return active !== null && (active.tagName === "INPUT" || active.tagName === "TEXTAREA") ? active : null;
}

/** Hears the keyboard's frame: native keyboard events, or the visual viewport in a browser. */
function listenToKeyboard(listener: KeyboardListener): () => void {
  if (Platform.OS === "web") {
    const window = browser();
    const viewport = window?.visualViewport ?? null;
    if (window === null || viewport === null) return () => undefined;
    const onViewport = () => {
      const bottom = viewport.offsetTop + viewport.height;
      // Zooming shrinks the visual viewport too; a keyboard leaves the scale alone.
      const keyboard = Math.abs(viewport.scale - 1) < 0.01 && window.innerHeight - bottom >= WEB_KEYBOARD_MIN && focusedWebField() !== null;
      listener(keyboard ? bottom : null, 0);
    };
    viewport.addEventListener("resize", onViewport);
    viewport.addEventListener("scroll", onViewport);
    return () => {
      viewport.removeEventListener("resize", onViewport);
      viewport.removeEventListener("scroll", onViewport);
    };
  }
  // Android reports the keyboard's top in screen coordinates, but `measureInWindow` there counts
  // from below the status bar (React Native's RootViewUtil.getViewportOffset): bring it across.
  const origin = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  const shown = (event: KeyboardEvent) => listener(event.endCoordinates.screenY - origin, event.duration);
  const hidden = (event: KeyboardEvent) => listener(null, event.duration);
  // iOS announces every frame change before it happens, show and hide
  // included; Android only reports after the fact.
  const subscriptions =
    Platform.OS === "ios"
      ? [Keyboard.addListener("keyboardWillChangeFrame", shown), Keyboard.addListener("keyboardWillHide", hidden)]
      : [Keyboard.addListener("keyboardDidShow", shown), Keyboard.addListener("keyboardDidHide", hidden)];
  return () => {
    subscriptions.map((subscription) => subscription.remove());
  };
}

/** Moves with the keyboard on iOS, as its own views do; Android and the web just snap. */
function animate(duration: number): void {
  if (Platform.OS !== "ios" || !(duration > 0)) return;
  LayoutAnimation.configureNext({ duration, update: { duration, type: LayoutAnimation.Types.keyboard } });
}

type Measurable = { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void };

function measure(target: Measurable, done: (box: WindowBox) => void): void {
  target.measureInWindow((x, y, width, height) => done({ left: x, right: x + width, top: y, bottom: y + height }));
}

/** The focused text field, if one has focus: a native input, or the browser's element. */
function focusedField(): object | null {
  if (Platform.OS === "web") return focusedWebField();
  return (TextInput.State.currentlyFocusedInput() as object | null) ?? null;
}

/** A field's box in the window. */
function measureField(field: object, done: (box: WindowBox) => void): void {
  if (Platform.OS === "web") {
    const rect = (field as ElementLike).getBoundingClientRect?.();
    if (rect !== undefined) done({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    return;
  }
  measure(field as Measurable, done);
}

/** How far the keyboard covers `target`, so the view can pad itself clear of it. */
export function useKeyboardOverlap(target: RefObject<View | null>): number {
  const [overlap, setOverlap] = useState(0);

  // The padding sits inside the view, so it does not change the frame being
  // measured; there is no feedback loop.
  useEffect(
    () =>
      listenToKeyboard((top, duration) => {
        const view = target.current;
        if (top === null || view === null) {
          animate(duration);
          setOverlap(0);
          return;
        }
        measure(view, (box) => {
          animate(duration);
          setOverlap(keyboardRoom(box, top));
        });
      }),
    [target],
  );

  return overlap;
}

/** The scroll area whose field has focus, if any: only that one moves for the keyboard. */
const claims = createFieldClaims<object>();

/** Claims the area for the focused field, with the view revealed beside it (its action row), if any. */
type Claim = (companion: Measurable | null) => void;

const RevealContext = createContext<Claim>(() => releaseFocus());

/**
 * A text field's `onFocus`: claims the scroll area around it and brings the
 * field into view, also when the keyboard is already open. Outside a scroll
 * area (the composer, a modal) it tells every area the focus is not theirs.
 */
export function useRevealFocused(companion?: RefObject<View | null>): () => void {
  const claim = useContext(RevealContext);
  return () => claim((companion?.current ?? null) as Measurable | null);
}

export const KeyboardRevealProvider = RevealContext.Provider;

/** Fields inside are no scroll area's, as in a modal over one: the host places those. */
export function KeyboardRevealBoundary({ children }: { children: ReactNode }) {
  return <RevealContext.Provider value={releaseFocus}>{children}</RevealContext.Provider>;
}

function releaseFocus(): void {
  claims.release();
}

/**
 * Keeps the focused field inside `scroller` above the keyboard. Render `room`
 * as space at the end of the content, call the handlers from the scroll view's
 * own, and hand `claim` to the fields through `KeyboardRevealProvider`.
 */
export function useKeyboardScroll(scroller: RefObject<NativeScrollView | null>) {
  /** This area's identity, for `claims`. */
  const self = useRef({}).current;
  const [room, setRoom] = useState(0);
  const roomNow = useRef(0);
  /** The view shown together with the focused field: its action row, so Submit stays above the keyboard. */
  const revealedWith = useRef<Measurable | null>(null);
  /** The area's height when last measured without room, for `roomNeeded`. */
  const bareHeight = useRef<number | null>(null);
  const keyboardTop = useRef<number | null>(null);
  const offset = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  function place(): void {
    const top = keyboardTop.current;
    const view = scroller.current;
    if (top === null || view === null) return;
    const field = focusedField();
    if (!claims.owns(self, field) || field === null) {
      releaseRoom();
      return;
    }
    const native = typeof view.getNativeScrollRef === "function" ? view.getNativeScrollRef() : null;
    measure((native ?? view) as unknown as Measurable, (area) => {
      if (roomNow.current === 0) bareHeight.current = area.bottom - area.top;
      const needed = roomNeeded(area, bareHeight.current, roomNow.current, top);
      if (needed !== roomNow.current) {
        // The room lands first, or the scroll would stop at the old end; its render reveals again.
        roomNow.current = needed;
        setRoom(needed);
        return;
      }
      measureField(field, (box) => {
        if (!holds(area, box)) return;
        const scrollTo = (span: Span) =>
          liveOffset(view, native, area, (current) => {
            const y = revealOffset(span, visibleSpan(area, top), current);
            if (y !== null) view.scrollTo({ y, animated: true });
          });
        const companion = revealedWith.current;
        if (companion === null) scrollTo(box);
        else measure(companion, (actions) => scrollTo(revealSpan(box, actions)));
      });
    });
  }

  /**
   * The scroll offset as it is now. `onScroll` arrives throttled and after the fact, and misses
   * scrolls made here (the room going, the transcript kept at its end), which aimed reveals short:
   * the web reads the scroll node's own offset, native the content's place under the area's top.
   */
  function liveOffset(view: NativeScrollView, native: unknown, area: WindowBox, done: (offset: number) => void): void {
    if (Platform.OS === "web") {
      const scrollTop = (native as { scrollTop?: unknown } | null)?.scrollTop;
      done(typeof scrollTop === "number" ? scrollTop : offset.current);
      return;
    }
    const withInner = view as unknown as { getInnerViewRef?: () => unknown };
    const inner = typeof withInner.getInnerViewRef === "function" ? (withInner.getInnerViewRef() as Measurable | null) : null;
    if (inner === null) {
      done(offset.current);
      return;
    }
    measure(inner, (content) => done(Math.max(0, area.top - content.top)));
  }

  /** Brings the focused field into view after this layout pass, if the keyboard is open. */
  function reveal(): void {
    if (keyboardTop.current === null) return;
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      place();
    }, 0);
  }

  function releaseRoom(): void {
    if (roomNow.current === 0) return;
    roomNow.current = 0;
    setRoom(0);
  }

  /** A field inside took focus. */
  function claim(companion: Measurable | null): void {
    // React Native records the focused input before calling `onFocus`, so this is the claiming field.
    claims.claim(self, focusedField());
    revealedWith.current = companion;
    reveal();
  }

  useEffect(() => {
    const stop = listenToKeyboard((top) => {
      keyboardTop.current = top;
      if (top !== null) reveal();
      else releaseRoom();
    });
    return () => {
      stop();
      if (pending.current !== null) clearTimeout(pending.current);
      claims.releaseArea(self);
    };
  }, [scroller]);

  useEffect(reveal, [room]);

  return {
    room,
    claim,
    onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
      offset.current = event.nativeEvent.contentOffset.y;
    },
    /** The scroll view moved or resized (the chat pane padding itself clear, say): measure again. */
    onLayout: reveal,
    /** A field grew as the reader typed. */
    onContentSizeChange: reveal,
  };
}

/** The host's `ScrollView`, keeping the focused field inside it above the keyboard. */
export function KeyboardScrollView({
  children,
  onScroll,
  onLayout,
  onContentSizeChange,
  ...props
}: ScrollViewProps & { children?: ReactNode }) {
  const scroller = useRef<NativeScrollView>(null);
  const keyboard = useKeyboardScroll(scroller);
  return (
    <ScrollView
      ref={scroller}
      scrollEventThrottle={100}
      {...props}
      onScroll={(event) => {
        keyboard.onScroll(event);
        onScroll?.(event);
      }}
      onLayout={(event: LayoutChangeEvent) => {
        keyboard.onLayout();
        onLayout?.(event);
      }}
      onContentSizeChange={(width: number, height: number) => {
        keyboard.onContentSizeChange();
        onContentSizeChange?.(width, height);
      }}
    >
      <KeyboardRevealProvider value={keyboard.claim}>{children}</KeyboardRevealProvider>
      {keyboard.room > 0 ? <View style={{ height: keyboard.room }} /> : null}
    </ScrollView>
  );
}
