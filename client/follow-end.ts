/**
 * A transcript that follows its end while the reader is there, and stays put
 * once they scroll up to read something.
 *
 * Shared by the first mate's chat and the Watch view, which both stream: a
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
  /** Cards already brought into view, so one is scrolled to once, not on every re-layout. */
  const revealed = useRef(new Set<string>());
  /** The content height last reported by `onContentSizeChange` — what the end was last followed to. */
  const knownHeight = useRef(0);
  /** The scroll offset last reported. */
  const offset = useRef(0);
  /** Whether the reader is away from the end, for the button that brings them back. */
  const [away, setAway] = useState(false);

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
   * Brings a row somewhere up the transcript into view (an open decision drawn under the message that
   * asked it), its end at the bottom of the screen, and stops following the end; scrolling back down
   * follows it again. The transcript is still laying out when the pane opens — rows below arrive, and
   * a cached transcript is redrawn — so for a moment after the first call each new layout of the row
   * scrolls to it again. `layout` is in the transcript's coordinates.
   */
  function revealRow(id: string, layout: LayoutRectangle, showingEnd: (top: number, height: number, viewportHeight: number) => number): void {
    const first = revealedAt.current.get(id);
    const now = Date.now();
    if (first === undefined) revealedAt.current.set(id, now);
    else if (now - first > SETTLE_MS) return;
    pinnedToEnd.current = false;
    setTimeout(() => scroller.current?.scrollTo({ y: showingEnd(layout.y, layout.height, viewport.current), animated: false }), 0);
  }

  /** Scrolls to an offset the reader asked for (a jump link), leaving the end unfollowed. */
  function scrollTo(y: number): void {
    pinnedToEnd.current = false;
    scroller.current?.scrollTo({ y, animated: true });
  }

  /** Spread onto the transcript's `ScrollView`. */
  const scrollProps = {
    ref: scroller,
    scrollEventThrottle: 100,
    onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      pinnedToEnd.current = isAtEnd(contentOffset.y, layoutMeasurement.height, contentSize.height, knownHeight.current);
      setAway(!pinnedToEnd.current);
      offset.current = contentOffset.y;
      onScrolled?.(contentOffset.y, layoutMeasurement.height);
    },
    onContentSizeChange(_width: number, height: number): void {
      knownHeight.current = height;
      keepAtEnd();
    },
    onLayout(event: LayoutChangeEvent): void {
      viewport.current = event.nativeEvent.layout.height;
      onScrolled?.(offset.current, viewport.current);
    },
  };

  return { pin, keepAtEnd, reveal, revealRow, scrollTo, away, jumpToEnd, scrollProps, offset, viewport };
}
