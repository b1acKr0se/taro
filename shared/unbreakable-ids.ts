/**
 * Ticket ids drawn whole: a narrow column (a phone's View plan) broke `NA-002.01` after its hyphen,
 * leaving `NA-` at a line's end and the number on the next. The renderer splits prose into pieces
 * here and keeps each id piece on one line: on the web a `nowrap` run with the plain hyphen, so a
 * copied id still matches; on native the hyphen becomes a non-breaking one (U+2011), as React
 * Native has no `nowrap` for a run. Code spans and link text never reach this. Pure.
 */
const NON_BREAKING_HYPHEN = "‑";

/** A link target, an autolink or a bare address (left as written), or a ticket id with what stands before it. */
const PIECE = /(\]\([^)]*\)|<[^>\s]+>|\b[a-z][a-z0-9+.-]*:\/\/\S+)|(^|[^\w/.\-])([A-Z][A-Z0-9]*-\d+(?:\.\d+)*)(?![\w-])/g;

/** A run of prose: a ticket id to keep on one line, or the text around it. */
export interface IdPiece {
  text: string;
  id: boolean;
}

/** The prose split into ticket ids and the text between them, every character kept as written. */
export function idPieces(text: string): IdPiece[] {
  const pieces: IdPiece[] = [];
  let pending = "";
  let last = 0;
  for (const match of text.matchAll(PIECE)) {
    const id = match[3];
    if (id === undefined) continue;
    const start = (match.index ?? 0) + (match[2] ?? "").length;
    pending += text.slice(last, start);
    if (pending !== "") pieces.push({ text: pending, id: false });
    pending = "";
    pieces.push({ text: id, id: true });
    last = start + id.length;
  }
  pending += text.slice(last);
  if (pending !== "") pieces.push({ text: pending, id: false });
  return pieces;
}

/** An id as native draws it: its hyphen non-breaking, so the line never breaks inside it. */
export function nonBreakingId(id: string): string {
  return id.replace("-", NON_BREAKING_HYPHEN);
}
