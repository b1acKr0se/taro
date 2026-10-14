import { FONT_SIZE } from "./type-scale";

/**
 * One button's measurements, shared by `IconButton`, the suggestion chips beside it (TR-070) and
 * `Segmented`. Every control is `height` tall whatever it holds (TR-077): an icon alone would make 28
 * points and a label in the platform's own line height anything from 29 to 32, so a header row of
 * mixed controls showed boxes of different heights.
 */
export const BUTTON = {
  height: 30,
  gap: 6,
  paddingHorizontal: 10,
  iconOnlyPaddingHorizontal: 7,
  paddingVertical: 6,
  borderRadius: 8,
  borderWidth: 1,
  iconSize: 14,
  fontSize: FONT_SIZE.small,
  /** A label's line, fixed so a one-line label fills the height exactly on every platform. */
  lineHeight: 16,
} as const;

/** `Segmented`'s track: its padding around the segments, and the segments' own corner radius. */
export const SEGMENTED = { padding: 2, gap: 2, segmentRadius: 6 } as const;
