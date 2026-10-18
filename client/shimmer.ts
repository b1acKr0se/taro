/**
 * How the shimmer runs over a running tool call's words (TR-183, TR-184): a white band crosses from
 * just before the words to their end, faster for short text.
 *
 * Ported from Paseo (5293dda, Apache-2.0): `computeShimmerMetrics`, `SHIMMER_GRADIENT` and the native
 * shimmer's track and gradient in `packages/app/src/components/message.tsx`. Changed: the phone's
 * gradient is drawn as layers of the words (`shimmerLayers`), as a plugin has no masked view there.
 */

/**
 * Paseo's band colour, white in both themes: the one colour outside `theme.colors` on a tool call
 * (TR-184). In a light theme it lightens the words, as Paseo's does.
 */
export const SHIMMER_LIGHT = "#ffffff";

/** Paseo's web band: clear at its edges, white across its middle fifth. */
export const SHIMMER_GRADIENT =
  "linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.45) 24%, #ffffff 40%, #ffffff 60%, rgba(255, 255, 255, 0.45) 76%, rgba(255, 255, 255, 0) 100%)";

/** One crossing's time: longer for more words, between 1 and 2.3 seconds. */
export function shimmerDurationMs(characters: number): number {
  const shortTextAdjustment = characters <= 12 ? 0.25 : 0;
  const seconds = Math.max(1, Math.min(2.3, 1.25 + characters * 0.008 - shortTextAdjustment));
  return Math.round(seconds * 1000);
}

/** The phone's band: 28% of the words' row (32 to 120 wide), its left edge from a band before the row to a band past it. */
export function shimmerMetrics(characters: number, width: number): { durationMs: number; peakWidth: number; from: number; to: number } {
  const peakWidth = Math.max(32, Math.min(120, width > 0 ? width * 0.28 : 0));
  return { durationMs: shimmerDurationMs(characters), peakWidth, from: -peakWidth, to: Math.max(0, width) + peakWidth };
}

/**
 * The web's band over the words from `spanStart` to `spanEnd` (x in the row): 22% of them (42 to
 * 120 wide), its left edge from a band before the first letter to the last letter.
 */
export function webShimmerTrack(spanStart: number, spanEnd: number): { peakWidth: number; trackStart: number; trackEnd: number } {
  const spanWidth = Math.max(1, spanEnd - spanStart);
  const peakWidth = Math.max(42, Math.min(120, spanWidth * 0.22));
  return { peakWidth, trackStart: spanStart - peakWidth, trackEnd: spanEnd };
}

/**
 * Paseo's phone gradient (clear, white at the middle, clear) as `count` layers of white words, each
 * narrower and centred in the last, outermost first. Laid over one another, the layers covering a
 * point build up `step / count` of white there, so the light rises in even steps to full white at the
 * middle: layer k's opacity is what takes the white from (k-1)/count to k/count.
 */
export function shimmerLayers(count: number): { share: number; opacity: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const before = index / count;
    const after = (index + 1) / count;
    return { share: (count - index) / count, opacity: 1 - (1 - after) / (1 - before) };
  });
}
