import { describe, expect, it } from "vitest";

import { createTabDrag, EDGE_PX, EDGE_STEP_PX, edgeStep } from "./tab-drag";

describe("a tab drag", () => {
  it("puts a tab back when the finger lifts after a hold with no move (it must not stay lifted)", () => {
    const drag = createTabDrag();
    drag.lift("a", 0);
    expect(drag.lifted()).toBe("a");
    expect(drag.cancelHold()).toBe(true);
    expect(drag.lifted()).toBeNull();
    expect(drag.finish()).toBeNull();
  });

  it("keeps the tab once a move began, so the release after a drag is not a cancel", () => {
    const drag = createTabDrag();
    drag.lift("a", 0);
    drag.move(5, 0);
    expect(drag.cancelHold()).toBe(false);
    expect(drag.lifted()).toBe("a");
  });

  it("shifts by the finger's move plus how far the row scrolled since the lift", () => {
    const drag = createTabDrag();
    drag.lift("a", 100);
    expect(drag.move(30, 100)).toBe(30);
    expect(drag.move(30, 160)).toBe(90);
    // The row scrolls on its own while the finger stands still.
    expect(drag.scrolled(200)).toBe(130);
    expect(drag.finish()).toEqual({ name: "a", shift: 130 });
  });

  it("starts a new lift from zero and finishes with nothing lifted", () => {
    const drag = createTabDrag();
    drag.lift("a", 0);
    drag.move(50, 0);
    drag.finish();
    drag.lift("b", 20);
    expect(drag.shift()).toBe(0);
    expect(drag.moved()).toBe(false);
    expect(drag.finish()).toEqual({ name: "b", shift: 0 });
    expect(drag.finish()).toBeNull();
  });

  it("cancels nothing when nothing is lifted", () => {
    expect(createTabDrag().cancelHold()).toBe(false);
  });
});

describe("edgeStep", () => {
  it("scrolls left near the left edge, right near the right edge, and not in the middle", () => {
    expect(edgeStep(EDGE_PX - 1, 300)).toBe(-EDGE_STEP_PX);
    expect(edgeStep(-20, 300)).toBe(-EDGE_STEP_PX);
    expect(edgeStep(300 - EDGE_PX + 1, 300)).toBe(EDGE_STEP_PX);
    expect(edgeStep(150, 300)).toBe(0);
    expect(edgeStep(EDGE_PX, 300)).toBe(0);
  });

  it("does nothing before the row has a width", () => {
    expect(edgeStep(0, 0)).toBe(0);
  });
});
