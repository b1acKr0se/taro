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
  it("moves the view down by the height it adds, so the same line stays on screen", () => {
    const { follow, scroller } = transcript();
    follow.scrollProps.onScroll(scrollEvent(120, 3000));
    follow.holdPosition();
    follow.scrollProps.onContentSizeChange(400, 4500);
    expect(scroller.scrollTo).toHaveBeenCalledWith({ y: 1620, animated: false });
    expect(follow.offset.current).toBe(1620);
  });

  it("counts from where the reader scrolled to while the page was read", () => {
    const { follow, scroller } = transcript();
    follow.scrollProps.onScroll(scrollEvent(300, 3000));
    follow.holdPosition();
    follow.scrollProps.onScroll(scrollEvent(40, 3000));
    follow.scrollProps.onContentSizeChange(400, 3800);
    expect(scroller.scrollTo).toHaveBeenCalledWith({ y: 840, animated: false });
  });

  it("holds only the next growth: later growth at the end leaves the reader be", () => {
    const { follow, scroller } = transcript();
    follow.scrollProps.onScroll(scrollEvent(120, 3000));
    follow.holdPosition();
    follow.scrollProps.onContentSizeChange(400, 4500);
    scroller.scrollTo.mockClear();
    follow.scrollProps.onContentSizeChange(400, 4600);
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing for a reader following the end", () => {
    const { follow, scroller } = transcript();
    follow.holdPosition();
    follow.scrollProps.onContentSizeChange(400, 4500);
    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollToEnd).toHaveBeenCalled();
  });

  it("leaves the button back to the end showing", () => {
    const { follow } = transcript();
    follow.scrollProps.onScroll(scrollEvent(120, 3000));
    follow.holdPosition();
    follow.scrollProps.onContentSizeChange(400, 4500);
    follow.scrollProps.onScroll(scrollEvent(1620, 4500));
    expect(state.away).toBe(true);
  });
});
