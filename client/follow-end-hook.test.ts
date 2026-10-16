import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The hook runs once, outside a component: each ref a plain box, `away` read from its setter. */
const state = vi.hoisted(() => ({ away: false }));
vi.mock("react", () => ({
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: boolean) => {
    state.away = initial;
    return [initial, (value: boolean) => (state.away = value)];
  },
}));

import { useFollowEnd } from "./follow-end";

const VIEWPORT = 600;

function scrollEvent(y: number, contentHeight: number) {
  return { nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 400, height: contentHeight }, layoutMeasurement: { width: 400, height: VIEWPORT } } } as never;
}

/** A transcript 3000 high in a 600 viewport, laid out and followed to its end (2400). */
function transcript() {
  const follow = useFollowEnd();
  const scroller = { scrollToEnd: vi.fn(), scrollTo: vi.fn() };
  (follow.scrollProps.ref as { current: unknown }).current = scroller;
  follow.scrollProps.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: VIEWPORT } } } as never);
  follow.scrollProps.onContentSizeChange(400, 3000);
  follow.scrollProps.onScroll(scrollEvent(2400, 3000));
  scroller.scrollToEnd.mockClear();
  return { follow, scroller };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the button back to the end (TR-167)", () => {
  it("shows once the reader scrolls up", () => {
    const { follow } = transcript();
    follow.scrollProps.onScroll(scrollEvent(1000, 3000));
    expect(state.away).toBe(true);
  });

  it("hides when a phone drag stops at the end after the last throttled scroll event stopped short", () => {
    const { follow } = transcript();
    follow.scrollProps.onScroll(scrollEvent(1000, 3000));
    // The phone's last scroll event inside its 100 ms throttle; the rest of the drag sends none.
    follow.scrollProps.onScroll(scrollEvent(2300, 3000));
    expect(state.away).toBe(true);
    follow.scrollProps.onScrollEndDrag(scrollEvent(2400, 3000));
    expect(state.away).toBe(false);
  });

  it("hides when a phone fling comes to rest at the end", () => {
    const { follow } = transcript();
    follow.scrollProps.onScroll(scrollEvent(1000, 3000));
    follow.scrollProps.onScrollEndDrag(scrollEvent(1200, 3000));
    follow.scrollProps.onScroll(scrollEvent(2290, 3000));
    expect(state.away).toBe(true);
    follow.scrollProps.onMomentumScrollEnd(scrollEvent(2400, 3000));
    expect(state.away).toBe(false);
  });

  it("follows the end again after reaching it by a drag end", () => {
    const { follow, scroller } = transcript();
    follow.scrollProps.onScroll(scrollEvent(1000, 3000));
    follow.scrollProps.onScrollEndDrag(scrollEvent(2400, 3000));
    follow.scrollProps.onContentSizeChange(400, 3200);
    expect(scroller.scrollToEnd).toHaveBeenCalled();
  });

  it("stays when a drag stops short of the end", () => {
    const { follow } = transcript();
    follow.scrollProps.onScroll(scrollEvent(1000, 3000));
    follow.scrollProps.onScrollEndDrag(scrollEvent(2300, 3000));
    expect(state.away).toBe(true);
  });

  it("hides when content shrinking under a scrolled-up reader brings the end into view, and follows it again", () => {
    const { follow, scroller } = transcript();
    follow.scrollProps.onScroll(scrollEvent(1000, 3000));
    // A card below folds: 1000 + 600 is the new end, and nothing scrolled.
    follow.scrollProps.onContentSizeChange(400, 1600);
    expect(state.away).toBe(false);
    follow.scrollProps.onContentSizeChange(400, 1800);
    expect(scroller.scrollToEnd).toHaveBeenCalled();
  });

  it("stays when content grows or shrinks with the end still out of view", () => {
    const { follow, scroller } = transcript();
    follow.scrollProps.onScroll(scrollEvent(1000, 3000));
    follow.scrollProps.onContentSizeChange(400, 3400);
    follow.scrollProps.onContentSizeChange(400, 2000);
    expect(state.away).toBe(true);
    expect(scroller.scrollToEnd).not.toHaveBeenCalled();
  });

  it("is not pinned by a hidden pane's content measuring 0", () => {
    const { follow, scroller } = transcript();
    follow.scrollProps.onScroll(scrollEvent(1000, 3000));
    follow.scrollProps.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 0 } } } as never);
    follow.scrollProps.onContentSizeChange(400, 0);
    expect(state.away).toBe(true);
    expect(scroller.scrollToEnd).not.toHaveBeenCalled();
  });

  it("does not undo a card brought into view up the transcript when content changes before its scroll is reported", () => {
    const { follow, scroller } = transcript();
    follow.revealRow("card", { x: 0, y: 1000, width: 400, height: 200 }, (top) => top - 8);
    // Before the reveal's scroll runs: the last offset reported is still the end.
    follow.scrollProps.onContentSizeChange(400, 3010);
    vi.runAllTimers();
    expect(scroller.scrollTo).toHaveBeenCalledWith({ y: 992, animated: false });
    // After it runs, before its scroll event.
    follow.scrollProps.onContentSizeChange(400, 3020);
    expect(scroller.scrollToEnd).not.toHaveBeenCalled();
  });

  it("does not undo a jump link's scroll when content changes before its scroll is reported", () => {
    const { follow, scroller } = transcript();
    follow.scrollTo(900);
    follow.scrollProps.onContentSizeChange(400, 3020);
    expect(scroller.scrollToEnd).not.toHaveBeenCalled();
  });
});

describe("an earlier page put above the reader (TR-169)", () => {
  /** A transcript on the web, its DOM node standing in for what the browser lays out. */
  function webTranscript() {
    const { follow, scroller } = transcript();
    const node = { scrollHeight: 3000, scrollTop: 2400, style: { overflowAnchor: "" } };
    Object.assign(scroller, { getScrollableNode: () => node });
    return { follow, scroller, node };
  }

  /** The reader scrolls to `y`, then a page `added` high goes in above them. */
  function pageIn(follow: ReturnType<typeof useFollowEnd>, node: { scrollHeight: number; scrollTop: number; style: { overflowAnchor: string } }, y: number, added: number) {
    follow.scrollProps.onScroll(scrollEvent(y, node.scrollHeight));
    node.scrollTop = y;
    follow.holdBefore();
    node.scrollHeight += added;
    let anchoringWhileMeasured: string | undefined;
    Object.defineProperty(node, "scrollTop", {
      configurable: true,
      get: () => y,
      set: (value: number) => {
        anchoringWhileMeasured = node.style.overflowAnchor;
        Object.defineProperty(node, "scrollTop", { configurable: true, writable: true, value });
      },
    });
    follow.holdAfter();
    return () => anchoringWhileMeasured;
  }

  it("moves the view down by the height it adds, in the same frame, so the same line stays on screen", () => {
    const { follow, node } = webTranscript();
    pageIn(follow, node, 120, 1500);
    expect(node.scrollTop).toBe(1620);
    expect(follow.offset.current).toBe(1620);
  });

  it("measures from where the reader is as the rows go in", () => {
    const { follow, node } = webTranscript();
    pageIn(follow, node, 40, 800);
    expect(node.scrollTop).toBe(840);
  });

  it("puts the view at the same place when the browser's scroll anchoring already moved it", () => {
    const { follow, node } = webTranscript();
    follow.scrollProps.onScroll(scrollEvent(120, 3000));
    node.scrollTop = 120;
    follow.holdBefore();
    node.scrollHeight += 1500;
    // The browser laid the rows out before the layout effect and anchored the view itself.
    node.scrollTop = 1620;
    follow.holdAfter();
    expect(node.scrollTop).toBe(1620);
  });

  it("turns the browser's scroll anchoring off while it moves the view, and back on after", () => {
    const { follow, node } = webTranscript();
    const anchoring = pageIn(follow, node, 120, 1500);
    expect(anchoring()).toBe("none");
    expect(node.style.overflowAnchor).toBe("");
  });

  it("holds only the rows it was told of: later growth at the end leaves the reader be", () => {
    const { follow, node, scroller } = webTranscript();
    pageIn(follow, node, 120, 1500);
    follow.scrollProps.onContentSizeChange(400, 4500);
    follow.scrollProps.onContentSizeChange(400, 4600);
    follow.holdAfter();
    expect(node.scrollTop).toBe(1620);
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing for a reader following the end", () => {
    const { follow, node } = webTranscript();
    follow.holdBefore();
    node.scrollHeight += 1500;
    follow.holdAfter();
    expect(node.scrollTop).toBe(2400);
  });

  it("does nothing on a phone, which keeps the place natively", () => {
    const { follow, scroller } = transcript();
    Object.assign(scroller, { getScrollableNode: () => 42 });
    follow.scrollProps.onScroll(scrollEvent(120, 3000));
    follow.holdBefore();
    follow.holdAfter();
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it("leaves the button back to the end showing", () => {
    const { follow, node } = webTranscript();
    pageIn(follow, node, 120, 1500);
    follow.scrollProps.onScroll(scrollEvent(1620, 4500));
    expect(state.away).toBe(true);
  });
});
