/** Lines a received message shows before it folds behind Show more (TR-220). */
export const RECEIVED_FOLD_LINES = 8;

/** Lines the user's own long message shows before it folds, as Paseo's long-message fold does. */
export const USER_FOLD_LINES = 6;

/** About how many characters a bubble line holds, for text with no line breaks. */
const CHARACTERS_PER_LINE = 40;

/** Whether a message is long enough to fold: more lines than the fold shows, by break or by wrapping. */
export function needsFold(text: string, foldLines: number = RECEIVED_FOLD_LINES): boolean {
  return text.split("\n").reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / CHARACTERS_PER_LINE)), 0) > foldLines;
}

/** The height a folded message shows: the fold's lines at the text's line height. Rendered blocks cannot take a line count, so the bubble clips instead. */
export function foldHeight(lineHeight: number, foldLines: number = RECEIVED_FOLD_LINES): number {
  return lineHeight * foldLines;
}

/** How many strips a fade is drawn in: enough to read as smooth, few enough to cost nothing. */
export const FADE_STEPS = 8;

/**
 * The opacity of each strip of the fade over a folded message's last lines, top to bottom: from clear to
 * the bubble's own colour. The plugin has no gradient, so the fade is these strips stacked.
 */
export function fadeOpacities(steps: number = FADE_STEPS): number[] {
  return Array.from({ length: steps }, (_, index) => Math.round(((index + 1) / steps) * 1000) / 1000);
}
