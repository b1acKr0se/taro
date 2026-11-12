/**
 * Ticket ids drawn whole: a narrow column (a phone's View plan) broke `NA-002.01` after its hyphen,
 * leaving `NA-` at a line's end and the number on the next. Drawn text swaps that hyphen for a
 * non-breaking one (U+2011), which looks the same; link targets and addresses keep theirs. Pure.
 */
const NON_BREAKING_HYPHEN = "‑";

/** A link target, an autolink or a bare address (left as written), or a ticket id with what stands before it. */
const PIECE = /(\]\([^)]*\)|<[^>\s]+>|\b[a-z][a-z0-9+.-]*:\/\/\S+)|(^|[^\w/.\-])([A-Z][A-Z0-9]*)-(\d+(?:\.\d+)*)(?![\w-])/g;

/** The text with every ticket id's hyphen made non-breaking, for drawing only (never for text sent or copied into a command). */
export function unbreakableIds(text: string): string {
  return text.replace(PIECE, (whole: string, kept: string | undefined, before: string, prefix: string, number: string) =>
    kept !== undefined ? whole : `${before}${prefix}${NON_BREAKING_HYPHEN}${number}`,
  );
}
