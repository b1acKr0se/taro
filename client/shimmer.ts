/**
 * How the shimmer runs over a running tool call's words (TR-183): a bright band crosses from just
 * before the words to their end, faster for short text.
 *
 * Ported from Paseo (5293dda, Apache-2.0): `computeShimmerMetrics` in
 * `packages/app/src/components/message.tsx`. Changed: one band for web and native alike (a plugin has
 * neither CSS text clipping nor a masked view), so it travels the native band's track.
 */
export function shimmerMetrics(characters: number, width: number): { durationMs: number; peakWidth: number; from: number; to: number } {
  const shortTextAdjustment = characters <= 12 ? 0.25 : 0;
  const seconds = Math.max(1, Math.min(2.3, 1.25 + characters * 0.008 - shortTextAdjustment));
  const peakWidth = Math.max(32, Math.min(120, width > 0 ? width * 0.28 : 0));
  return { durationMs: Math.round(seconds * 1000), peakWidth, from: -peakWidth, to: Math.max(0, width) };
}
