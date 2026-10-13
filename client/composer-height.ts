/**
 * How tall a phone's composer field is (TR-031): one line while empty, growing with what is typed up
 * to a few lines, then scrolling inside. Pure, so the rule is tested apart from the field.
 */
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

/** The field's own top and bottom padding. */
export const COMPOSER_FIELD_PADDING = SPACE.sm;

const LINE = lineHeightFor(FONT_SIZE.content);

/** One line of text and the field's padding. */
export const COMPOSER_ONE_LINE = LINE + 2 * COMPOSER_FIELD_PADDING;

/** Past this the field scrolls rather than pushing the chat off the screen. */
export const COMPOSER_MAX_LINES = 5;

/** `contentHeight` is what the field last measured its text at (padding included), or null before it has. */
export function composerFieldHeight(draft: string, contentHeight: number | null): number {
  // An emptied field reports its old height until it re-measures; empty is always one line.
  if (draft === "" || contentHeight === null) return COMPOSER_ONE_LINE;
  return Math.min(Math.max(contentHeight, COMPOSER_ONE_LINE), LINE * COMPOSER_MAX_LINES + 2 * COMPOSER_FIELD_PADDING);
}
