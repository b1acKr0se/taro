/**
 * The evidence an owner records before Accept (TR-021): an `EVIDENCE <time> — …` notes record whose
 * lines are `check:`, `review:`, `ux:`, `coverage:`, `screenshot:` and `screenshots: none`. Owners write it by hand, so
 * the parsing tolerates the label's case, a bullet in front, and three separators. Only the newest
 * record of the round in progress counts (TR-229: a reopened ticket presents again); whether it is enough is judged here, whether a file exists is told by the caller.
 */
import { roundRecords } from "./execution";

export interface ParsedEvidence {
  checks: { command: string; result: string }[];
  review: string | null;
  /** The visual check (TR-060): the owner's user's-eyes pass and the reviewer's final visual verdict. */
  ux: string | null;
  /**
   * The coverage map (TR-079): each section or state the change renders, with the screenshots that
   * show it, so a section nobody captured (a parent's children) is named rather than missed.
   */
  coverage: { section: string; files: string[] }[];
  screenshots: { file: string; caption: string }[];
  /** The reason after `screenshots: none`; "" when the line has no reason; null without the line. */
  screenshotsNone: string | null;
}

export interface JudgedEvidence {
  checks: { command: string; result: string }[];
  review: string | null;
  ux: string | null;
  coverage: { section: string; files: string[] }[];
  screenshots: { file: string; caption: string; present: boolean }[];
  screenshotsNone: string | null;
  missing: string[];
  complete: boolean;
}

/** The text split at its first separator, the em dash before the plain ones (a command may contain ` - `). */
export function splitAtSeparator(text: string): [string, string] {
  for (const separator of [" — ", " -- ", " - "]) {
    const index = text.indexOf(separator);
    if (index >= 0) return [text.slice(0, index).trim(), text.slice(index + separator.length).trim()];
  }
  // A trailing separator with nothing after it is an empty result, not part of the command.
  const trailing = /^(.*?)\s+(?:—|--|-)$/.exec(text);
  return trailing === null ? [text.trim(), ""] : [(trailing[1] ?? "").trim(), ""];
}

/** A line that belongs to an EVIDENCE record even in capitals (`CHECK: …`), which `noteRecords` takes for a record of its own. */
const EVIDENCE_LINE = /^(checks?|review|ux|coverage|screenshots?)\s*:/i;

/** The EVIDENCE records of the round in progress (TR-229), each with the capitalised evidence lines `noteRecords` split off it. */
function evidenceRecords(notes: string | null): string[] {
  const records: string[] = [];
  let open = false;
  for (const record of roundRecords(notes)) {
    if (/^EVIDENCE\b/.test(record)) {
      records.push(record);
      open = true;
    } else if (open && EVIDENCE_LINE.test(record)) {
      records[records.length - 1] += `\n${record}`;
    } else {
      open = false;
    }
  }
  return records;
}

export function parseEvidence(notes: string | null): ParsedEvidence | null {
  const records = evidenceRecords(notes);
  const record = records[records.length - 1];
  if (record === undefined) return null;
  const parsed: ParsedEvidence = { checks: [], review: null, ux: null, coverage: [], screenshots: [], screenshotsNone: null };
  // The first line is the record's own heading.
  for (const rawLine of record.split("\n").slice(1)) {
    const line = rawLine.replace(/^[\s>*•-]+/, "").replace(/\*\*/g, "").trim();
    const labelled = /^(checks?|review|ux|coverage|screenshots?)\s*:\s*(.*)$/i.exec(line);
    if (labelled === null) continue;
    const label = (labelled[1] ?? "").toLowerCase();
    const value = (labelled[2] ?? "").trim();
    if (label.startsWith("check")) {
      const [command, result] = splitAtSeparator(value);
      parsed.checks.push({ command, result });
    } else if (label === "review") {
      if (value !== "") parsed.review = value;
    } else if (label === "ux") {
      if (value !== "") parsed.ux = value;
    } else if (label === "coverage") {
      const [section, files] = splitAtSeparator(value);
      if (section !== "") parsed.coverage.push({ section, files: coverageFiles(files) });
    } else {
      const [first, rest] = splitAtSeparator(value);
      // `screenshot: none` is the same as `screenshots: none`; a file is never called that.
      if (first.toLowerCase() === "none") parsed.screenshotsNone = rest;
      else if (first !== "") parsed.screenshots.push({ file: first.replace(/^`+|`+$/g, ""), caption: rest });
    }
  }
  return parsed;
}

/** The screenshot names after a coverage line's separator: `a.png, b.png` (backticks and "and" allowed); "none" names none. */
function coverageFiles(text: string): string[] {
  return text
    .split(/\s*,\s*|\s+and\s+|\s+\+\s+/)
    .map((file) => file.trim().replace(/^`+|`+$/g, ""))
    .filter((file) => file !== "" && file.toLowerCase() !== "none");
}

/** A bare file name inside the ticket's evidence folder: no path, no way out of it. */
export function isBareFileName(file: string): boolean {
  return file !== "" && !/[\\/]/.test(file) && !file.includes("..");
}

export function judgeEvidence(
  parsed: ParsedEvidence | null,
  options: {
    investigation: boolean;
    existingFiles: ReadonlySet<string>;
    /** Accepted already (Done): its record predates the coverage map and gates nothing, so a missing map is not reported. */
    accepted?: boolean;
  },
): JudgedEvidence {
  if (parsed === null) {
    return { checks: [], review: null, ux: null, coverage: [], screenshots: [], screenshotsNone: null, missing: ["an EVIDENCE record"], complete: false };
  }
  const checks = parsed.checks.filter((check) => check.command !== "" && check.result !== "");
  const screenshots = parsed.screenshots.map((shot) => ({
    ...shot,
    present: isBareFileName(shot.file) && options.existingFiles.has(shot.file),
  }));
  const missing: string[] = [];
  if (checks.length === 0) missing.push("a check with its result");
  if (!options.investigation) {
    if (parsed.review === null) missing.push("the review outcome");
    if (screenshots.length === 0) {
      if (parsed.screenshotsNone === null) missing.push("screenshots (or screenshots: none with a reason)");
      else if (parsed.screenshotsNone === "") missing.push("a reason after screenshots: none");
    } else {
      // Screenshots are not proof until someone looked at them with the user's eyes (TR-060).
      if (parsed.ux === null) missing.push("the visual check (ux:)");
      if (!(options.accepted ?? false)) missing.push(...missingCoverage(parsed));
    }
    for (const shot of screenshots) {
      // The caption is what tells the reader what the image shows (TR-055).
      if (shot.caption === "") missing.push(`a caption for screenshot ${shot.file}`);
      if (shot.present) continue;
      missing.push(isBareFileName(shot.file) ? `screenshot file ${shot.file}` : `a plain file name for screenshot ${shot.file} (no folders)`);
    }
  }
  return {
    checks,
    review: parsed.review,
    ux: parsed.ux,
    coverage: parsed.coverage,
    screenshots,
    screenshotsNone: parsed.screenshotsNone === "" ? null : parsed.screenshotsNone,
    missing,
    complete: missing.length === 0,
  };
}

/**
 * What the coverage map lacks (TR-079): the map itself, a screenshot for a section, or a section's
 * screenshot that is not one of the record's (a typo, or a file never listed).
 */
function missingCoverage(parsed: ParsedEvidence): string[] {
  if (parsed.coverage.length === 0) return ["the coverage map (coverage: <section or state> — <screenshot>)"];
  const listed = new Set(parsed.screenshots.map((shot) => shot.file));
  return parsed.coverage.flatMap(({ section, files }) => {
    if (files.length === 0) return [`a screenshot for ${section} (coverage:)`];
    return files.filter((file) => !listed.has(file)).map((file) => `a screenshot: line for ${file}, which the coverage of ${section} names`);
  });
}

/**
 * The evidence in one line, for a board card: "2 checks · review · 3 screenshots", or what is missing.
 * The card's place for it is TR-026's to settle; this is only the words.
 */
export function evidenceSummary(evidence: Pick<JudgedEvidence, "checks" | "review" | "screenshots" | "screenshotsNone" | "missing" | "complete">): string {
  if (!evidence.complete) return `Evidence missing: ${evidence.missing.join(", ")}`;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (evidence.checks.length > 0) parts.push(plural(evidence.checks.length, "check"));
  if (evidence.review !== null) parts.push("review");
  if (evidence.screenshots.length > 0) parts.push(plural(evidence.screenshots.length, "screenshot"));
  else if (evidence.screenshotsNone !== null) parts.push(`no screenshots: ${evidence.screenshotsNone}`);
  return parts.join(" · ");
}
