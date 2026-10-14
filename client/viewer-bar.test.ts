import { describe, expect, it } from "vitest";

import { captionOf, viewerBarText } from "./viewer-bar";

describe("viewerBarText", () => {
  it("names the option and the position, the caption under them", () => {
    expect(viewerBarText({ title: "Floating pills", alt: "the list on a phone", index: 0, count: 2 })).toEqual({ heading: "Floating pills · 1 of 2", caption: "the list on a phone" });
  });

  it("names the option alone when it has one image", () => {
    expect(viewerBarText({ title: "Side rail", alt: "the list", index: 0, count: 1 })).toEqual({ heading: "Side rail", caption: "the list" });
  });

  it("keeps the position alone without an option, and no heading for a single image", () => {
    expect(viewerBarText({ alt: "the board on a phone", index: 2, count: 3 })).toEqual({ heading: "3 of 3", caption: "the board on a phone" });
    expect(viewerBarText({ title: "  ", alt: "the board", index: 0, count: 1 })).toEqual({ heading: null, caption: "the board" });
  });

  it("calls an image without a caption Image", () => {
    expect(captionOf("")).toBe("Image");
    expect(captionOf("  ")).toBe("Image");
    expect(viewerBarText({ alt: "", index: 0, count: 1 }).caption).toBe("Image");
  });
});
