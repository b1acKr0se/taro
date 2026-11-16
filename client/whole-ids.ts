/**
 * Which inline runs keep ticket ids whole (`../shared/unbreakable-ids`). Only prose does: plain text
 * and bold. A code span, a link's text and a file link stay exactly as written. On the web an id is a
 * `nowrap` run with its plain hyphen, so copying it gives the id; native has no `nowrap` for a run,
 * so the hyphen becomes U+2011 there. Pure, so the renderer's choice is tested without one.
 */
import { idPieces, nonBreakingId } from "../shared/unbreakable-ids";
import type { InlineToken } from "./file-links";

/** A run of a prose token as drawn: `nowrap` marks a web id run. */
export interface DrawnPiece {
  text: string;
  nowrap: boolean;
}

/** A prose token's runs; null for a token drawn as written. */
export function drawnPieces(token: InlineToken, web: boolean): DrawnPiece[] | null {
  if (token.kind !== "text" && token.kind !== "bold") return null;
  return idPieces(token.text).map((piece) =>
    !piece.id ? { text: piece.text, nowrap: false } : web ? { text: piece.text, nowrap: true } : { text: nonBreakingId(piece.text), nowrap: false },
  );
}
