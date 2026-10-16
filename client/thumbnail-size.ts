/**
 * The size of an image sent in the user's bubble (TR-098). The bubble sizes itself to what it holds,
 * so a thumbnail as tall as usual and as wide as its shape made a wide screenshot push the bubble off
 * the pane. Here the thumbnail keeps its usual height until that would be wider than the bubble's
 * room, then shrinks, height with width, so the whole image shows in its own shape.
 */

/** The thumbnail's shape before the image's own size is known. */
export const UNKNOWN_ASPECT = 4 / 3;
/** A very tall image's frame is at least this wide, the image letterboxed in it, so it stays easy to tap. */
export const MIN_FRAME_WIDTH = 48;
/** The share of the chat's width the user's bubble may take. */
export const USER_BUBBLE_SHARE = 0.88;

export interface FrameSize {
  width: number;
  height: number;
}

/**
 * The frame of a thumbnail `height` tall for an image of `size` (null while unknown). Without `room`
 * its width follows the image; with it, the frame is never wider than `room`.
 */
export function thumbnailFrame(size: FrameSize | null, height: number, room?: number): FrameSize {
  const aspect = size === null || size.width <= 0 || size.height <= 0 ? UNKNOWN_ASPECT : size.width / size.height;
  const natural = { width: height * aspect, height };
  if (room === undefined) return natural;
  const limit = Math.max(0, room);
  const fitted = natural.width <= limit ? natural : { width: limit, height: limit / aspect };
  return { width: Math.min(limit, Math.max(fitted.width, MIN_FRAME_WIDTH)), height: fitted.height };
}

/** The width an image in the user's bubble may take: the bubble's share of the chat, less its padding and border on both sides. */
export function bubbleImageRoom(chatWidth: number, paddingHorizontal: number, borderWidth: number): number {
  return Math.max(0, chatWidth * USER_BUBBLE_SHARE - 2 * (paddingHorizontal + borderWidth));
}

/**
 * The size in device pixels of a copy small enough to draw a thumbnail of `frame` (layout units) at
 * `pixelRatio`, covering it, for an image of `natural` pixels (TR-164); null when the image is no
 * larger than that, so it is drawn as it is.
 */
export function thumbnailCopySize(natural: FrameSize, frame: FrameSize, pixelRatio: number): FrameSize | null {
  if (natural.width <= 0 || natural.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const scale = Math.max((frame.width * pixelRatio) / natural.width, (frame.height * pixelRatio) / natural.height);
  if (scale >= 1) return null;
  return { width: Math.max(1, Math.ceil(natural.width * scale)), height: Math.max(1, Math.ceil(natural.height * scale)) };
}
