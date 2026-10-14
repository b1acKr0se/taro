/**
 * A ticket's description as the Ticket tab shows it (TR-061): the user's words first, the
 * Manager's notes (`## Manager notes`, `## Manager's notes`, any case) apart, folded behind their
 * bullet count. Pure.
 */
import { plainText } from "./needs-you";

export interface DescriptionParts {
  /** Everything but the Manager's notes, as written. */
  userWords: string;
  /** The notes under their heading, without it; null when the description has none. */
  managerNotes: string | null;
  /** The notes' top-level bullets. */
  managerNoteCount: number;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const MANAGER_NOTES = /^manager(?:['’]?s)?\s+notes\b/i;
const FENCE = /^\s*(```|~~~)/;
const TOP_BULLET = /^(?:[-*+]|\d+[.)])\s+/;

export function descriptionParts(description: string | null): DescriptionParts {
  const lines = (description ?? "").replace(/\r\n?/g, "\n").split("\n");
  const words: string[] = [];
  const notes: string[] = [];
  let notesLevel: number | null = null;
  let found = false;
  let inFence = false;
  lines.forEach((line) => {
    if (FENCE.test(line)) inFence = !inFence;
    const heading = inFence ? null : HEADING.exec(line);
    if (heading !== null) {
      const level = (heading[1] ?? "#").length;
      if (MANAGER_NOTES.test((heading[2] ?? "").trim())) {
        notesLevel = level;
        found = true;
        return;
      }
      // A heading at the notes' level or above ends them.
      if (notesLevel !== null && level <= notesLevel) notesLevel = null;
    }
    if (notesLevel === null) words.push(line);
    else notes.push(line);
  });
  const managerNotes = found ? notes.join("\n").trim() : null;
  return {
    userWords: words.join("\n").trim(),
    managerNotes,
    managerNoteCount: managerNotes === null ? 0 : notes.filter((line) => TOP_BULLET.test(line)).length,
  };
}

/** The first sentence of some Markdown's first line of text, plain: no heading, fence, list or quote marks. */
export function firstTextLine(markdown: string | null): string | null {
  if (markdown === null) return null;
  let inFence = false;
  const line = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((part) => {
      if (FENCE.test(part)) {
        inFence = !inFence;
        return false;
      }
      return !inFence && !HEADING.test(part) && !/^\s*(?:[-*_=]\s*){3,}$/.test(part);
    })
    .map((part) => plainText(part.replace(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s*>\s*/, "")))
    .find((part) => part !== "");
  return line === undefined ? null : firstSentence(line);
}

/** Up to the first full stop followed by a new sentence; "v1.2" or "e.g. x" stay whole. */
export function firstSentence(line: string): string {
  return /^(.+?[.!?])\s+[A-Z(]/.exec(line)?.[1] ?? line;
}
