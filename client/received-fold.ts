/** Lines a received message shows before it folds behind Show more (TR-220). */
export const RECEIVED_FOLD_LINES = 8;

/** Lines the user's own long message shows before it folds, as Paseo's long-message fold does. */
export const USER_FOLD_LINES = 6;

/** Characters per line that even a wide bubble cannot beat by much: text shorter than the fold's lines at this width is never measured. */
const SURELY_SHORT_CHARACTERS_PER_LINE = 20;

/**
 * Whether a message is worth measuring for a fold: it has as many line breaks as the fold shows, or more characters than
 * the fold's lines could hold at a narrow phone's width. How wide the bubble really is decides the rest, by measuring it
 * (`overflowsFold`), because a wide pane fits twice the characters a phone does and a guess folds text nothing hides.
 */
export function mayNeedFold(text: string, foldLines: number = RECEIVED_FOLD_LINES): boolean {
  return text.length > foldLines * SURELY_SHORT_CHARACTERS_PER_LINE || text.split("\n").length > foldLines;
}

/** Whether a body measured at `naturalHeight` is taller than the fold shows, with a pixel of slack for rounding. */
export function overflowsFold(naturalHeight: number, lineHeight: number, foldLines: number = RECEIVED_FOLD_LINES): boolean {
  return naturalHeight > foldHeight(lineHeight, foldLines) + 1;
}

/** The height a folded message shows: the fold's lines at the text's line height. Rendered blocks cannot take a line count, so the bubble clips instead. */
export function foldHeight(lineHeight: number, foldLines: number = RECEIVED_FOLD_LINES): number {
  return lineHeight * foldLines;
}

/**
 * The style of a folded body's clipping box, as Paseo's `MessagePreview` clips (`overflow: isNative ? "scroll" : "hidden"`).
 * A phone measures a text inside an `overflow: hidden` column at most as tall as the box (Yoga hands the child an at-most
 * height and the platform's text measure caps at it), so a folded message measured as fitting, unfolded, measured long and
 * folded again on every frame: the chat flickered and the app crashed. `scroll` clips the same but leaves the height open.
 * The web never caps, and would draw scroll bars for `scroll`.
 */
export function foldClipStyle(height: number, web: boolean): { maxHeight: number; overflow: "hidden" | "scroll" } {
  return { maxHeight: height, overflow: web ? "hidden" : "scroll" };
}

/**
 * The natural height to keep from a body's measure, given the height it was clipped at when measured (null: not clipped)
 * and the height already known (null: none). A clipped measure exactly at the clip cannot tell a body that fits exactly from
 * one a platform capped, so it keeps the known height: whatever a platform does, a body measured long stays folded. With
 * none known it is taken as it is, so a body exactly as tall as the fold opens; a capped one then measures long unclipped.
 */
export function settleMeasure(height: number, clippedAt: number | null, known: number | null): number {
  if (clippedAt !== null && known !== null && Math.abs(height - clippedAt) <= 1) return known;
  return height;
}

/**
 * A block of a folded body, measured from the body's top: a text with its line height, whose lines start at its top every
 * `lineHeight`; or, with `lineHeight` null, a block whose lines are not known (a heading, a code block, a table row) that a
 * fold may end above or below but never inside.
 */
export interface FoldBlock {
  top: number;
  height: number;
  lineHeight: number | null;
}

/** Slack for layout rounding, in points. */
const EDGE = 0.5;

/** Whether a fold ending at `cut` leaves every line of `block` whole. */
function cutsNoLine(block: FoldBlock, cut: number): boolean {
  const bottom = block.top + block.height;
  if (cut <= block.top + EDGE || cut >= bottom - EDGE) return true;
  if (block.lineHeight === null || block.lineHeight <= 0) return false;
  const lines = (cut - block.top) / block.lineHeight;
  return Math.abs(lines - Math.round(lines)) * block.lineHeight <= EDGE;
}

/**
 * Where a folded body ends: the lowest point at or above `foldHeight` that cuts no line of any block, so a folded message
 * ends between two lines rather than through one. With no blocks, or no such point in the fold's lower half (a tall image
 * or code block), it ends at `foldHeight`, as Paseo's fold always does.
 */
export function foldCut(blocks: readonly FoldBlock[], foldHeight: number): number {
  const candidates = blocks.flatMap((block) => {
    const bottom = block.top + block.height;
    if (block.lineHeight === null || block.lineHeight <= 0) return [block.top, bottom];
    const step = block.lineHeight;
    return [...Array.from({ length: Math.round(block.height / step) + 1 }, (_, index) => block.top + index * step), bottom];
  });
  const fitting = candidates.filter((cut) => cut <= foldHeight + EDGE && cut >= foldHeight / 2 && blocks.every((block) => cutsNoLine(block, cut)));
  return fitting.length === 0 ? foldHeight : Math.min(foldHeight, Math.max(...fitting));
}

/** How many lines the fade over a folded message covers. */
export const FADE_LINES = 3;

/** How much of the bubble's colour covers the last line at its very bottom: never all of it, so the last line stays whole. */
export const FADE_COVER = 0.9;

/** The strips of a fade `height` points tall: about two points each, so no band shows. */
export function fadeSteps(height: number): number {
  return Math.max(1, Math.round(height / 2));
}

/**
 * The opacity of each strip of the fade over a folded message's last lines, top to bottom: rising slowly, then faster, to
 * `FADE_COVER` at the bottom. The plugin has no gradient, so the fade is these strips stacked. The fold ends between lines
 * (`foldCut`), so the fade dims whole lines and never has to hide a cut one.
 */
export function fadeOpacities(steps: number, cover: number = FADE_COVER): number[] {
  return Array.from({ length: steps }, (_, index) => Math.round(Math.pow((index + 0.5) / steps, 1.5) * cover * 1000) / 1000);
}

/** The fade a host without gradient styles gets: one line, lighter, so the stacked strips stay too few and too faint to read as bands. */
export const FALLBACK_FADE_LINES = 1;
export const FALLBACK_FADE_COVER = 0.7;

/** The first React Native release whose views take a `linear-gradient` background style (`experimental_backgroundImage`). */
const GRADIENT_MINIMUM_MINOR = 76;

/**
 * Whether this host draws a gradient background style: the web always does (CSS), the phone app when its React Native is
 * 0.76 or newer. A host that does not say its version gets the fallback, as an older one ignores the style and would show no fade.
 */
export function gradientFadeSupported(platform: { OS: string; constants?: unknown }): boolean {
  if (platform.OS === "web") return true;
  const version = typeof platform.constants === "object" && platform.constants !== null ? Reflect.get(platform.constants, "reactNativeVersion") : undefined;
  const major = typeof version === "object" && version !== null ? Reflect.get(version, "major") : undefined;
  const minor = typeof version === "object" && version !== null ? Reflect.get(version, "minor") : undefined;
  if (typeof major !== "number" || typeof minor !== "number") return false;
  return major > 0 || minor >= GRADIENT_MINIMUM_MINOR;
}

/** Stops along the fade, as a share of its height: the same easing as the strips, so both look alike. */
const GRADIENT_STOPS = [0, 0.25, 0.5, 0.75, 1] as const;

/** The CSS `linear-gradient` from clear at the top to `FADE_COVER` of `colour` at the bottom; `shade` turns the colour and a strength into a colour string. */
export function fadeGradient(shade: (alpha: number) => string): string {
  const stops = GRADIENT_STOPS.map((at) => `${shade(Math.round(Math.pow(at, 1.5) * FADE_COVER * 1000) / 1000)} ${Math.round(at * 100)}%`);
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

/**
 * What a body shows before and after it is measured: until then it is only clipped (no fade, no button), so a message that
 * fits never flashes them; once measured, `overflowing` shows the button and the fade, and `folded` the clip.
 */
export function foldState(candidate: boolean, natural: number | null, open: boolean, lineHeight: number, foldLines: number = RECEIVED_FOLD_LINES): { overflowing: boolean; folded: boolean } {
  const overflowing = candidate && natural !== null && overflowsFold(natural, lineHeight, foldLines);
  return { overflowing, folded: candidate && !open && (natural === null || overflowing) };
}

/** A body's measured fold: its natural height and where its fold ends (null until its lines are measured). */
export interface MeasuredFold {
  natural: number;
  cut: number | null;
}

/** Folds measured for a text at a window width, so a row drawn again (a pending message becoming its timeline row) starts with its fold settled. Lost when the app reloads. */
const folds = new Map<string, MeasuredFold>();
const REMEMBERED_LIMIT = 200;

export function rememberedFold(key: string): MeasuredFold | null {
  return folds.get(key) ?? null;
}

export function rememberFold(key: string, fold: MeasuredFold): void {
  folds.delete(key);
  folds.set(key, fold);
  if (folds.size > REMEMBERED_LIMIT) {
    const oldest = folds.keys().next();
    if (!oldest.done) folds.delete(oldest.value);
  }
}
