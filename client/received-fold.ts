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

/** How many strips a fade is drawn in: enough to read as smooth, few enough to cost nothing. */
export const FADE_STEPS = 8;

/**
 * The opacity of each strip of the fade over a folded message's last lines, top to bottom: from clear to
 * the bubble's own colour. The plugin has no gradient, so the fade is these strips stacked.
 */
export function fadeOpacities(steps: number = FADE_STEPS): number[] {
  return Array.from({ length: steps }, (_, index) => Math.round(((index + 1) / steps) * 1000) / 1000);
}
