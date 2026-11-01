/**
 * How the shimmer runs over a running tool call's words (TR-183, TR-184): a white band crosses from
 * just before the words to their end, faster for short text.
 *
 * Ported from Paseo (5293dda, Apache-2.0): `computeShimmerMetrics`, `SHIMMER_GRADIENT` and the native
 * shimmer's track and gradient in `packages/app/src/components/message.tsx`. Changed: the phone's
 * gradient is drawn by colouring the letters themselves (`shimmerRuns`), as a plugin has no masked view there.
 */

/**
 * Paseo's band colour, white in both themes: the one colour outside `theme.colors` on a tool call
 * (TR-184). In a light theme it lightens the words, as Paseo's does.
 */
export const SHIMMER_LIGHT = "#ffffff";

/** Paseo's web band: clear at its edges, white across its middle fifth. */
export const SHIMMER_GRADIENT =
  "linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.45) 24%, #ffffff 40%, #ffffff 60%, rgba(255, 255, 255, 0.45) 76%, rgba(255, 255, 255, 0) 100%)";

/**
 * Where the web's light copy sits over the words (TR-189): pinned to their edges, never given their
 * measured width, as react-native-web measures a view to a whole pixel. Rounded down, the copy's
 * words no longer fit, wrap onto a second line and, centred on the row, show half a line up.
 */
export const WEB_SHIMMER_COPY_BOX = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;

/** One crossing's time: longer for more words, between 1 and 2.3 seconds. */
export function shimmerDurationMs(characters: number): number {
  const shortTextAdjustment = characters <= 12 ? 0.25 : 0;
  const seconds = Math.max(1, Math.min(2.3, 1.25 + characters * 0.008 - shortTextAdjustment));
  return Math.round(seconds * 1000);
}

/** Pixels one letter takes, on average: turns Paseo's 32 to 120 px band into letters, as a phone cannot measure single letters. */
const LETTER_WIDTH = 7;

/**
 * The phone's band over `characters` letters, as Paseo's: 28% of the words' width (32 to 120 px,
 * here in letters), its left edge from a band before the words to a band past them, in the time
 * `shimmerDurationMs` gives. It spans the words, never their row, so a short text crosses as slowly as a long one.
 */
export function shimmerMetrics(characters: number): { durationMs: number; peakLetters: number; from: number; to: number } {
  const letters = Math.max(0, characters);
  const peakLetters = Math.max(32 / LETTER_WIDTH, Math.min(120 / LETTER_WIDTH, letters * 0.28));
  return { durationMs: shimmerDurationMs(letters), peakLetters, from: -peakLetters, to: letters + peakLetters };
}

/** Paseo's gradient at `across` (0 to 1) of the band: clear at the edges, 45% at a quarter, white across the middle fifth. */
export function shimmerBandLevel(across: number): number {
  if (!(across > 0 && across < 1)) return 0;
  const stops: [number, number][] = [[0, 0], [0.24, 0.45], [0.4, 1], [0.6, 1], [0.76, 0.45], [1, 0]];
  for (let index = 1; index < stops.length; index += 1) {
    const [end, endLevel] = stops[index]!;
    const [start, startLevel] = stops[index - 1]!;
    if (across <= end) return startLevel + ((endLevel - startLevel) * (across - start)) / (end - start);
  }
  return 0;
}

/** How white each letter is drawn, in steps of a sixteenth so neighbours merge into one run. */
const LEVEL_STEPS = 16;

/**
 * `text` (whose first letter is letter `start` of the words) cut into runs of letters at one level of
 * white, the band's left edge at letter `position` and `peakLetters` wide. Letters out of the band are
 * one run at level 0 however long, so a long command costs no more than a short one.
 */
export function shimmerRuns(text: string, start: number, position: number, peakLetters: number): { text: string; level: number }[] {
  const runs: { text: string; level: number }[] = [];
  const push = (piece: string, level: number) => {
    if (piece === "") return;
    const previous = runs[runs.length - 1];
    if (previous !== undefined && previous.level === level) previous.text += piece;
    else runs.push({ text: piece, level });
  };
  const first = Math.max(0, Math.min(text.length, Math.floor(position - start)));
  const last = Math.max(first, Math.min(text.length, Math.ceil(position + peakLetters - start)));
  push(text.slice(0, first), 0);
  Array.from(text.slice(first, last)).reduce((offset, letter) => {
    const across = (start + offset + 0.5 - position) / peakLetters;
    push(letter, Math.round(shimmerBandLevel(across) * LEVEL_STEPS) / LEVEL_STEPS);
    return offset + letter.length;
  }, first);
  push(text.slice(last), 0);
  return runs;
}

/** `colour` mixed with white by `level` (0 to 1): hex or rgb()/rgba(); a colour it cannot read turns white past one half. */
export function blendToWhite(colour: string, level: number): string {
  if (level <= 0) return colour;
  const channels = readChannels(colour);
  if (channels === null) return level >= 0.5 ? SHIMMER_LIGHT : colour;
  const [red, green, blue, alpha] = channels;
  const mix = (channel: number) => Math.round(channel + (255 - channel) * level);
  return `rgba(${mix(red)}, ${mix(green)}, ${mix(blue)}, ${Math.round((alpha + (1 - alpha) * level) * 1000) / 1000})`;
}

function readChannels(colour: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(colour.trim())?.[1];
  if (hex !== undefined) {
    const full = hex.length <= 4 ? Array.from(hex, (digit) => digit + digit).join("") : hex;
    const byte = (index: number) => parseInt(full.slice(index * 2, index * 2 + 2), 16);
    return [byte(0), byte(1), byte(2), full.length === 8 ? byte(3) / 255 : 1];
  }
  const functional = /^rgba?\(([^)]*)\)$/i.exec(colour.trim())?.[1];
  if (functional !== undefined) {
    const parts = functional.split(/[\s,/]+/).filter((part) => part !== "").map(Number);
    if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
  }
  return null;
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

/** Most letters the light's copy lays out: a phone row shows far fewer, and each copy is drawn every frame. */
export const SHIMMER_COPY_LIMIT = 200;

/**
 * What the phone's light copy draws of a one-line `numberOfLines={1}` text: its first line, cut at
 * `SHIMMER_COPY_LIMIT`, so a long multi-line command costs each of the layers no more than a short one (TR-243).
 */
export function shimmerCopyText(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.slice(0, SHIMMER_COPY_LIMIT);
}
