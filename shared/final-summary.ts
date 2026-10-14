/**
 * A FINAL summary in the template's short format (`skill/templates/final.md`, TR-061): What
 * changed, How it was verified and Limitations as bullets, each heading a Markdown heading, a bold
 * line or a line ending in a colon. Pure. A FINAL without What changed is an older free-form one and
 * stays Markdown.
 */
import { finalSummaryBody } from "./execution";

export type FinalSectionKey = "changed" | "verified" | "limitations";

/** The template's sections in order, with their bullet limits. */
export const FINAL_SECTIONS: readonly { key: FinalSectionKey; heading: string; limit: number }[] = [
  { key: "changed", heading: "What changed", limit: 5 },
  { key: "verified", heading: "How it was verified", limit: 3 },
  { key: "limitations", heading: "Limitations", limit: 3 },
];

export interface FinalSections {
  changed: string[];
  verified: string[];
  limitations: string[];
  /** Everything else (the revision line, prose, other sections) as Markdown; empty when none. */
  rest: string;
}

const HEADING = /^\s*(?:#{1,6}\s+(.+?)\s*#*|\*\*(.+?):?\*\*:?|([A-Z][^:]{2,40}):)\s*$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
/** The revision line Accept and the reader need ("Revision: <sha> · PR: <url>"), wherever it is written. */
const REVISION_LINE = /^\s*(?:revision|pr|branch|commit|review[ _-]?head)\b[^:\n]{0,20}:/i;

function sectionKey(heading: string): FinalSectionKey | null {
  const normalized = heading.replace(/:$/, "").trim().toLowerCase();
  return FINAL_SECTIONS.find((section) => section.heading.toLowerCase() === normalized)?.key ?? null;
}

/** The FINAL's sections, or null when it has no What changed section. */
export function finalSections(finalSummary: string | null): FinalSections | null {
  if (finalSummary === null) return null;
  const sections: Record<FinalSectionKey, string[]> = { changed: [], verified: [], limitations: [] };
  const rest: string[] = [];
  let current: FinalSectionKey | null = null;
  let found = false;
  let inFence = false;
  finalSummaryBody(finalSummary)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line) => {
      if (FENCE.test(line)) inFence = !inFence;
      const heading = inFence ? null : HEADING.exec(line);
      if (heading !== null) {
        const key = sectionKey(heading[1] ?? heading[2] ?? heading[3] ?? "");
        if (key !== null) {
          current = key;
          if (key === "changed") found = true;
          return;
        }
        // Another heading ends the section; it and what follows stay as written.
        current = null;
      }
      // A code block or the revision line is not a bullet: it stays with the rest, as written.
      if (current === null || inFence || FENCE.test(line) || REVISION_LINE.test(line)) {
        rest.push(line);
        return;
      }
      const bullet = BULLET.exec(line);
      const items = sections[current];
      if (bullet !== null) items.push((bullet[1] ?? "").trim());
      else if (line.trim() === "") return;
      // An indented line wraps the bullet above it; a plain line is a bullet of its own.
      else if (/^\s+/.test(line) && items.length > 0) items[items.length - 1] = `${items[items.length - 1] ?? ""} ${line.trim()}`;
      else items.push(line.trim());
    });
  if (!found) return null;
  return { ...sections, rest: rest.join("\n").trim() };
}
