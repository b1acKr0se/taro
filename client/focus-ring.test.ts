import { describe, expect, it } from "vitest";

import { FIELD_WEB_STYLE, focusRingStyle, pressableStyleWithRing } from "./focus-ring";

describe("focusRingStyle", () => {
  it("colours the ring on the web", () => {
    expect(focusRingStyle("#d97757", true)).toEqual({ outlineColor: "#d97757" });
  });

  it("leaves the page's ring without a colour, and adds nothing on a phone", () => {
    expect(focusRingStyle(null, true)).toBeNull();
    expect(focusRingStyle("#d97757", false)).toBeNull();
  });
});

describe("FIELD_WEB_STYLE", () => {
  it("removes the outline, without a colour cue in its place", () => {
    expect(FIELD_WEB_STYLE).toEqual({ outlineWidth: 0 });
  });
});

describe("pressableStyleWithRing", () => {
  const ring = { outlineColor: "#d97757" };

  it("puts the ring after a plain style, so it wins", () => {
    expect(pressableStyleWithRing({ padding: 4 }, ring)).toEqual([{ padding: 4 }, ring]);
    expect(pressableStyleWithRing(undefined, ring)).toEqual([undefined, ring]);
  });

  it("keeps a style of the press state a function", () => {
    const style = pressableStyleWithRing(({ pressed }) => ({ opacity: pressed ? 0.5 : 1 }), ring);
    expect(typeof style).toBe("function");
    if (typeof style !== "function") return;
    expect(style({ pressed: true, hovered: false, focused: false } as never)).toEqual([{ opacity: 0.5 }, ring]);
    expect(style({ pressed: false, hovered: false, focused: false } as never)).toEqual([{ opacity: 1 }, ring]);
  });

  it("returns the style untouched without a ring", () => {
    const style = { padding: 4 };
    expect(pressableStyleWithRing(style, null)).toBe(style);
  });
});
