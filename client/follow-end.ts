/**
 * A transcript that follows its end while the reader is there, and stays put
 * once they scroll up to read something.
 *
 * Shared by every agent chat, which streams: a
 * reply growing at the end is followed, and a question or permission request
 * arriving at the end is brought into view whole.
 */
import { useRef, useState } from "react";
import type { LayoutChangeEvent, LayoutRectangle, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";

/** How long after a row is first revealed its re-layouts still scroll to it: the transcript settling. */
const SETTLE_MS = 1500;

/** How close to the end still counts as being there, in points. */
const END_SLACK = 40;

/**
 * Whether a scroll position is at the end, judged against the shorter of the
 * content as it is now (`liveHeight`) and as `onContentSizeChange` last
 * reported it (`knownHeight`, 0 before the first report). A scroll event can
 * see content that has grown before `onContentSizeChange` has said so — on the
 * web that report waits for a ResizeObserver and a timer, while the event
 * fired as a scroll settles reads the live height — and judged against the
 * grown height the reader looks scrolled up, so the new message is never
 * followed, nor any after it. Content that shrank is judged as it is now,
 * since the scroll view has already clamped to it.
 */
export function isAtEnd(offsetY: number, viewportHeight: number, liveHeight: number, knownHeight: number): boolean {
  const end = knownHeight > 0 ? Math.min(knownHeight, liveHeight) : liveHeight;
  return offsetY + viewportHeight >= end - END_SLACK;
}

/**
 * Whether a row revealed at `firstAt` is scrolled to again on a new layout at `now`: only while the
 * transcript settles, and never once the reader has scrolled themselves.
 */
export function revealsAgain(firstAt: number, now: number, readerScrolled: boolean): boolean {
  return !readerScrolled && now - firstAt <= SETTLE_MS;
}

/**
 * What a new height of the transcript's viewport means (TR-069): a pane kept mounted while hidden
 * (`display: "none"`) lays out at height 0, and a browser forgets a hidden element's scroll position,
 * so the transcript is put back where it was when it shows again. Its first layout is not a return.
 */
export function viewportChange(wasHidden: boolean, previousHeight: number, height: number): "hidden" | "shown-again" | "resized" {
  if (height === 0) return previousHeight > 0 || wasHidden ? "hidden" : "resized";
  return wasHidden ? "shown-again" : "resized";
}

/**
 * Whether a card's layout is one the reader sees: a pane built hidden ahead of use (TR-069) lays its
 * rows out at height 0, and bringing those into view would spend their one reveal unseen.
 */
export function layoutShown(chatHidden: boolean, layout: { height: number }): boolean {
  return !chatHidden && layout.height > 0;
}

/**
 * Whether a scroll leaves the reader within a screen of the transcript's top, scrolled up from its end
 * (TR-169): time to read the page before it. At the end means a chat too short to scroll, or one
 * opening, where nothing was scrolled up to.
 */
export function nearTheTop(scroll: Pick<NativeScrollEvent, "contentOffset" | "contentSize" | "layoutMeasurement">): boolean {
  const viewportHeight = scroll.layoutMeasurement.height;
  if (viewportHeight === 0) return false;
  return scroll.contentOffset.y < viewportHeight && !isAtEnd(scroll.contentOffset.y, viewportHeight, scroll.contentSize.height, 0);
}

/** The phone's `maintainVisibleContentPosition`, without and with the error line. */
const KEEP_FIRST_ROW = { minIndexForVisible: 2 };
const KEEP_FIRST_ROW_UNDER_ERROR = { minIndexForVisible: 3 };

/**
 * What a phone keeps in place as earlier pages go in above the reader (TR-169): the first row on
 * screen. The transcript's children before the rows (the measuring anchor, the error when one shows,
 * and the "earlier messages" line) never move when rows go in after them, and a reader at the very
 * top would be anchored to one of them and left looking at the new page: they are skipped.
 */
export function keepVisibleFrom(errorShown: boolean): { minIndexForVisible: number } {
  return errorShown ? KEEP_FIRST_ROW_UNDER_ERROR : KEEP_FIRST_ROW;
}

/** A web scroll view's DOM node: what a browser lays out. */
export interface WebScrollNode {
  scrollHeight: number;
  scrollTop: number;
  style: { overflowAnchor?: string };
}

/** The DOM node behind a scroll view on the web, or null on a phone, whose scroll view has none. */
export function webScrollNode(scroller: unknown): WebScrollNode | null {
  const getNode = (scroller as { getScrollableNode?: unknown } | null)?.getScrollableNode;
  if (typeof getNode !== "function") return null;
  const node: unknown = getNode.call(scroller);
  if (typeof node !== "object" || node === null) return null;
  const { scrollHeight, style } = node as { scrollHeight?: unknown; style?: unknown };
  return typeof scrollHeight === "number" && typeof style === "object" && style !== null ? (node as WebScrollNode) : null;
}

/** How far a scroll may land from the offset asked for and still be the one asked for, in points. */
const OFFSET_SLACK = 2;

/**
 * What a scroll event says about the reader. `stale` while a reveal is asked for and not yet made
 * (TR-131): the event reports a scroll from before it, such as the opening's follow of the end, and
 * read as the reader's it would pin the end again and refuse the reveals that follow. `asked` when it
 * lands where a reveal scrolled (a reveal past the end lands clamped to it), `reader` otherwise once
 * something was revealed, and `free` before anything was.
 */
export function scrollEventKind(offsetY: number, furthest: number, revealOffsets: readonly number[], pendingReveals: number): "stale" | "asked" | "reader" | "free" {
  if (pendingReveals > 0) return "stale";
  if (revealOffsets.length === 0) return "free";
  return revealOffsets.some((y) => Math.abs(offsetY - Math.min(y, furthest)) <= OFFSET_SLACK) ? "asked" : "reader";
}

/**
 * `onScrolled` hears every scroll and viewport change (the offset and the visible height), for
 * anything that depends on what is on screen.
 */
export function useFollowEnd(onScrolled?: (offset: number, viewportHeight: number) => void) {
  const scroller = useRef<ScrollView>(null);
  const pinnedToEnd = useRef(true);
  /** The transcript's visible height, to tell whether a card fits in it. */
  const viewport = useRef(0);
  /** When each row revealed by `revealRow` was first brought into view. */
  const revealedAt = useRef(new Map<string, number>());
  /**
   * The offsets `revealRow` scrolled to, to tell its scrolls from the reader's: a scroll event can
   * report an earlier reveal's offset after a later one was asked for.
   */
  const revealOffsets = useRef<number[]>([]);
  /** Reveals asked for whose scroll has not run yet: scroll events until then are older than them. */
  const pendingReveals = useRef(0);
  /** Whether the reader has scrolled since a row was revealed: the transcript is theirs again. */
  const readerScrolled = useRef(false);
  /** Cards already brought into view, so one is scrolled to once, not on every re-layout. */
  const revealed = useRef(new Set<string>());
  /** The content height last reported by `onContentSizeChange` — what the end was last followed to. */
  const knownHeight = useRef(0);
  /** The scroll offset last reported. */
  const offset = useRef(0);
  /** Laid out at height 0 inside a hidden pane, to be put back where it was when it shows again. */
  const hidden = useRef(false);
  /** Whether the reader is away from the end, for the button that brings them back. */
  const [away, setAway] = useState(false);
  /** The web content's height and scroll before rows were put above the reader (TR-169). */
  const heldAt = useRef<{ height: number; top: number } | null>(null);

  /** Follow the end again — the reader just sent something, or answered something. */
  function pin(): void {
    pinnedToEnd.current = true;
  }

  /** Back to the end, now, whatever the reader was doing — the button's press. */
  function jumpToEnd(): void {
    pinnedToEnd.current = true;
    setAway(false);
    scroller.current?.scrollToEnd({ animated: false });
  }

  /** Back to the end, now, if that is where the reader was. */
  function keepAtEnd(): void {
    if (pinnedToEnd.current) scroller.current?.scrollToEnd({ animated: false });
  }

  /**
   * Brings a card into view once it has a size. Following the end is not
   * enough: it only happens while the transcript is pinned there, and the card
   * lays out after the content-size change that would have followed it, so the
   * view stopped where the card began. A card that fits is shown whole, with
   * the end of the transcript; one taller than the transcript is shown from
   * its top, where the question is. The layout must be in the transcript's
   * coordinates — the card's wrapper a direct child of the scroll view.
   *
   * The jump is instant: during an animated scroll every scroll event reads as
   * "not at the end", and content arriving mid-animation would not be followed.
   */
  function reveal(id: string, layout: LayoutRectangle): void {
    if (!layoutShown(hidden.current, layout)) return;
    if (revealed.current.has(id)) return;
    revealed.current.add(id);
    const fits = layout.height + 16 <= viewport.current;
    pinnedToEnd.current = fits;
    // After this layout pass, so the scroll view's content already includes the card.
    setTimeout(() => {
      if (fits) scroller.current?.scrollToEnd({ animated: false });
      else scroller.current?.scrollTo({ y: Math.max(0, layout.y - 8), animated: false });
    }, 0);
  }

  /**
   * Brings a card somewhere up the transcript into view (an open decision under the message that
   * asked it, or the acceptance card), where `showing` puts it, and stops following the end;
   * scrolling back down follows it again. The transcript is still laying out when the pane opens —
   * rows below arrive, and a cached transcript is redrawn — so for a moment after the first call each
   * new layout of the card scrolls to it again. `layout` is in the transcript's coordinates.
   */
  function revealRow(id: string, layout: LayoutRectangle, showing: (top: number, height: number, viewportHeight: number) => number): void {
    if (!layoutShown(hidden.current, layout)) return;
    const first = revealedAt.current.get(id);
    const now = Date.now();
    if (first === undefined) revealedAt.current.set(id, now);
    else if (!revealsAgain(first, now, readerScrolled.current)) return;
    pinnedToEnd.current = false;
    const y = showing(layout.y, layout.height, viewport.current);
    revealOffsets.current.push(y);
    pendingReveals.current += 1;
    setTimeout(() => {
      pendingReveals.current -= 1;
      offset.current = y;
      scroller.current?.scrollTo({ y, animated: false });
    }, 0);
  }

  /**
   * Keeps what the reader sees in place while rows are put above it (an earlier page, TR-169), on the
   * web: `holdBefore` as the rows are rendered (the page still shows the old ones), `holdAfter` as
   * they are committed, before the browser paints, so the view moves down by the height they add in
   * the same frame. `onContentSizeChange` comes a frame later. A browser's own scroll anchoring may
   * already have moved the view for the new rows, and for some insertions not others, so the view
   * is put where it was plus the height added, never moved by it. A phone keeps its place natively
   * (`maintainVisibleContentPosition`).
   */
  function holdBefore(): void {
    const node = pinnedToEnd.current ? null : webScrollNode(scroller.current);
    heldAt.current = node === null ? null : { height: node.scrollHeight, top: node.scrollTop };
  }

  function holdAfter(): void {
    const held = heldAt.current;
    heldAt.current = null;
    const node = webScrollNode(scroller.current);
    if (held === null || node === null || pinnedToEnd.current) return;
    const added = node.scrollHeight - held.height;
    if (added <= 0) return;
    // Off while the view is put back, so the browser does not move it again on the next layout.
    node.style.overflowAnchor = "none";
    node.scrollTop = held.top + added;
    offset.current = node.scrollTop;
    node.style.overflowAnchor = "";
  }

  /** Scrolls to an offset the reader asked for (a jump link), leaving the end unfollowed. */
  function scrollTo(y: number): void {
    pinnedToEnd.current = false;
    // Where it is heading, so content changing during the animation is not judged from the end it left.
    offset.current = y;
    scroller.current?.scrollTo({ y, animated: true });
  }

  /**
   * Where a scroll event puts the reader. The phone's scroll events are throttled with no last one
   * (React Native drops one within `scrollEventThrottle` of the one before), so a drag or fling that
   * stops at the end is reported short of it, sometimes past the slack (TR-167): the end of the drag
   * and of the fling, always sent, are judged too.
   */
  function scrolled(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    // A hidden pane's scroll view reports nothing about where the reader was.
    if (hidden.current || layoutMeasurement.height === 0) return;
    const kind = scrollEventKind(contentOffset.y, Math.max(0, contentSize.height - layoutMeasurement.height), revealOffsets.current, pendingReveals.current);
    // A stale event still says where the view is, as a reveal to the same offset fires none; it only must not decide following.
    if (kind !== "stale") {
      if (kind === "reader") readerScrolled.current = true;
      pinnedToEnd.current = isAtEnd(contentOffset.y, layoutMeasurement.height, contentSize.height, knownHeight.current);
      setAway(!pinnedToEnd.current);
    }
    offset.current = contentOffset.y;
    onScrolled?.(contentOffset.y, layoutMeasurement.height);
  }

  /** Spread onto the transcript's `ScrollView`. */
  const scrollProps = {
    ref: scroller,
    scrollEventThrottle: 100,
    onScroll: scrolled,
    onScrollEndDrag: scrolled,
    onMomentumScrollEnd: scrolled,
    onContentSizeChange(_width: number, height: number): void {
      knownHeight.current = height;
      // Content that shrank under a reader scrolled up can bring the end into view with no scroll event.
      if (!pinnedToEnd.current && !hidden.current && height > 0 && pendingReveals.current === 0 && isAtEnd(offset.current, viewport.current, height, height)) {
        pinnedToEnd.current = true;
        setAway(false);
      }
      keepAtEnd();
    },
    onLayout(event: LayoutChangeEvent): void {
      const height = event.nativeEvent.layout.height;
      const change = viewportChange(hidden.current, viewport.current, height);
      if (change === "hidden") {
        hidden.current = true;
        return;
      }
      viewport.current = height;
      if (change === "shown-again") {
        hidden.current = false;
        const y = offset.current;
        // After the pane is shown, so the scroll view has its size again.
        setTimeout(() => {
          if (pinnedToEnd.current) scroller.current?.scrollToEnd({ animated: false });
          else scroller.current?.scrollTo({ y, animated: false });
        }, 0);
      }
      onScrolled?.(offset.current, viewport.current);
    },
  };

  return { pin, keepAtEnd, reveal, revealRow, scrollTo, holdBefore, holdAfter, away, jumpToEnd, scrollProps, offset, viewport };
}
