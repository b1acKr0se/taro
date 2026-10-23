/** Lines a received message shows before it folds behind Show more (TR-220). */
export const RECEIVED_FOLD_LINES = 8;

/** About how many characters a bubble line holds, for text with no line breaks. */
const CHARACTERS_PER_LINE = 40;

/** Whether a received message is long enough to fold: more lines than the fold shows, by break or by wrapping. */
export function needsFold(text: string): boolean {
  return text.split("\n").reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / CHARACTERS_PER_LINE)), 0) > RECEIVED_FOLD_LINES;
}

/** The height a folded message shows: the fold's lines at the text's line height. Rendered blocks cannot take a line count, so the bubble clips instead. */
export function foldHeight(lineHeight: number): number {
  return lineHeight * RECEIVED_FOLD_LINES;
}
