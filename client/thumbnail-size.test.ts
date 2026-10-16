import { describe, expect, it } from "vitest";

import { bubbleImageRoom, MIN_FRAME_WIDTH, thumbnailCopySize, thumbnailFrame, UNKNOWN_ASPECT } from "./thumbnail-size";

describe("thumbnailFrame", () => {
  it("shrinks a wide image to the bubble's room, keeping its shape", () => {
    // The reproduction: a 2200 × 360 table at 160 px tall was 978 px wide in a 299 px bubble.
    const frame = thumbnailFrame({ width: 2200, height: 360 }, 160, 299);
    expect(frame.width).toBe(299);
    expect(frame.height).toBeCloseTo(299 / (2200 / 360));
    expect(frame.width / frame.height).toBeCloseTo(2200 / 360);
  });

  it("keeps a small image at its usual thumbnail size", () => {
    expect(thumbnailFrame({ width: 120, height: 90 }, 160, 299)).toEqual({ width: 160 * (120 / 90), height: 160 });
  });

  it("keeps an image exactly as wide as the room at its usual size", () => {
    expect(thumbnailFrame({ width: 300, height: 160 }, 160, 300)).toEqual({ width: 300, height: 160 });
  });

  it("keeps a tall image at the usual height, narrow", () => {
    expect(thumbnailFrame({ width: 300, height: 600 }, 160, 299)).toEqual({ width: 80, height: 160 });
  });

  it("gives a very tall image a frame wide enough to tap", () => {
    expect(thumbnailFrame({ width: 300, height: 1800 }, 160, 299)).toEqual({ width: MIN_FRAME_WIDTH, height: 160 });
  });

  it("never makes the tap floor wider than the room", () => {
    expect(thumbnailFrame({ width: 10, height: 1000 }, 160, 30)).toEqual({ width: 30, height: 160 });
  });

  it("uses the placeholder shape until the image's size is known, fitted too", () => {
    expect(thumbnailFrame(null, 160)).toEqual({ width: 160 * UNKNOWN_ASPECT, height: 160 });
    expect(thumbnailFrame(null, 160, 120)).toEqual({ width: 120, height: 90 });
    expect(thumbnailFrame({ width: 0, height: 0 }, 160)).toEqual({ width: 160 * UNKNOWN_ASPECT, height: 160 });
  });

  it("follows the image's shape alone without a room, as other thumbnails do", () => {
    expect(thumbnailFrame({ width: 2200, height: 360 }, 160)).toEqual({ width: 160 * (2200 / 360), height: 160 });
  });

  it("shows nothing wider than a room of zero or less", () => {
    expect(thumbnailFrame({ width: 2200, height: 360 }, 160, 0)).toEqual({ width: 0, height: 0 });
    expect(thumbnailFrame({ width: 2200, height: 360 }, 160, -10).width).toBe(0);
  });
});

describe("bubbleImageRoom", () => {
  it("is the bubble's share of the chat less padding and border on both sides", () => {
    expect(bubbleImageRoom(400, 12, 1)).toBeCloseTo(400 * 0.88 - 26);
  });

  it("is never negative", () => {
    expect(bubbleImageRoom(0, 12, 1)).toBe(0);
  });
});

describe("thumbnailCopySize", () => {
  it("shrinks a large screenshot to the thumbnail's device pixels, in its own shape", () => {
    // A 1440 × 900 desktop shot in a 160-tall thumbnail, three device pixels a point.
    const frame = thumbnailFrame({ width: 1440, height: 900 }, 160);
    expect(thumbnailCopySize({ width: 1440, height: 900 }, frame, 3)).toEqual({ width: 768, height: 480 });
  });

  it("covers a letterboxing frame on both sides: a very tall image fills its minimum width", () => {
    const natural = { width: 300, height: 6000 };
    const frame = thumbnailFrame(natural, 160, 299);
    const copy = thumbnailCopySize(natural, frame, 2);
    expect(copy).toEqual({ width: 96, height: 1920 });
    expect(copy!.width).toBeGreaterThanOrEqual(frame.width * 2);
    expect(copy!.height).toBeGreaterThanOrEqual(frame.height * 2);
  });

  it("rounds up, never to less than a pixel", () => {
    expect(thumbnailCopySize({ width: 1001, height: 3 }, { width: 100, height: 0.3 }, 1)).toEqual({ width: 101, height: 1 });
    expect(thumbnailCopySize({ width: 10000, height: 1 }, { width: 1, height: 0.0001 }, 1)).toEqual({ width: 1, height: 1 });
  });

  it("makes no copy of an image already no larger than the thumbnail", () => {
    expect(thumbnailCopySize({ width: 480, height: 300 }, { width: 256, height: 160 }, 3)).toBeNull();
    expect(thumbnailCopySize({ width: 768, height: 480 }, { width: 256, height: 160 }, 3)).toBeNull();
    expect(thumbnailCopySize({ width: 769, height: 481 }, { width: 256, height: 160 }, 3)).not.toBeNull();
  });

  it("makes no copy for an empty image or frame", () => {
    expect(thumbnailCopySize({ width: 0, height: 900 }, { width: 256, height: 160 }, 3)).toBeNull();
    expect(thumbnailCopySize({ width: 1440, height: 900 }, { width: 0, height: 160 }, 3)).toBeNull();
    expect(thumbnailCopySize({ width: 1440, height: 900 }, { width: 256, height: 0 }, 3)).toBeNull();
  });
});
