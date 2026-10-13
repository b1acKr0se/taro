import { describe, expect, it } from "vitest";

import { withAlpha } from "./tint";

describe("withAlpha", () => {
  it("appends an alpha byte to a six-digit hex colour", () => {
    expect(withAlpha("#1a2b3c", 0.5)).toBe("#1a2b3c80");
    expect(withAlpha("#FFFFFF", 1)).toBe("#FFFFFFff");
    expect(withAlpha("#000000", 0)).toBe("#00000000");
  });

  it("expands a three-digit hex colour first", () => {
    expect(withAlpha("#abc", 0.2)).toBe("#aabbcc33");
  });

  it("clamps the alpha", () => {
    expect(withAlpha("#abcdef", 2)).toBe("#abcdefff");
    expect(withAlpha("#abcdef", -1)).toBe("#abcdef00");
  });

  it("returns anything else unchanged", () => {
    expect(withAlpha("rgb(1, 2, 3)", 0.5)).toBe("rgb(1, 2, 3)");
    expect(withAlpha("red", 0.5)).toBe("red");
    expect(withAlpha("#abcdef12", 0.5)).toBe("#abcdef12");
    expect(withAlpha("#ggg", 0.5)).toBe("#ggg");
  });
});
