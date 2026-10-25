import { describe, expect, it } from "vitest";

import { TIP_MARGIN, tipMaxWidth, tipOffset } from "./tip-placement";

describe("tipOffset", () => {
  it("starts at the button's left edge where the tooltip fits", () => {
    expect(tipOffset({ anchorLeft: 100, tipWidth: 200, paneWidth: 600 })).toBe(0);
  });

  it("moves left by what would pass the right edge", () => {
    expect(tipOffset({ anchorLeft: 400, tipWidth: 300, paneWidth: 600 })).toBe(600 - TIP_MARGIN - 300 - 400);
  });

  it("keeps a button at the very left inside the margin", () => {
    expect(tipOffset({ anchorLeft: 0, tipWidth: 200, paneWidth: 600 })).toBe(TIP_MARGIN);
  });

  it("starts at the margin when the pane is narrower than the tooltip", () => {
    expect(tipMaxWidth(200)).toBe(200 - 2 * TIP_MARGIN);
    expect(tipOffset({ anchorLeft: 120, tipWidth: 320, paneWidth: 200 })).toBe(TIP_MARGIN - 120);
  });
});
