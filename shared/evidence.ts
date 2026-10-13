/**
 * The evidence an owner records before Accept (TR-021): an `EVIDENCE <time> — …` notes record whose
 * lines are `check:`, `review:`, `screenshot:` and `screenshots: none`. Owners write it by hand, so
 * the parsing tolerates the label's case, a bullet in front, and three separators. Only the newest
 * record counts; whether it is enough is judged here, whether a file exists is told by the caller.
 */
import { noteRecords } from "./execution";

export interface ParsedEvidence {
  checks: { command: string; result: string }[];
  review: string | null;
  screenshots: { file: string; caption: string }[];
  /** The reason after `screenshots: none`; "" when the line has no reason; null without the line. */
  screenshotsNone: string | null;
}

export interface JudgedEvidence {
  checks: { command: string; result: string }[];
  review: string | null;
  screenshots: { file: string; caption: string; present: boolean }[];
  screenshotsNone: string | null;
  missing: string[];
  complete: boolean;
}

/** The text split at its first separator, the em dash before the plain ones (a command may contain ` - `). */
function splitAtSeparator(text: string): [string, string] {
  for (const separator of [" — ", " -- ", " - "]) {
    const index = text.indexOf(separator);
    if (index >= 0) return [text.slice(0, index).trim(), text.slice(index + separator.length).trim()];
  }
  // A trailing separator with nothing after it is an empty result, not part of the command.
  const trailing = /^(.*?)\s+(?:—|--|-)$/.exec(text);
  return trailing === null ? [text.trim(), ""] : [(trailing[1] ?? "").trim(), ""];
}

export function parseEvidence(notes: string | null): ParsedEvidence | null {
  const records = noteRecords(notes).filter((record) => /^EVIDENCE\b/.test(record));
  const record = records[records.length - 1];
  if (record === undefined) return null;
  const parsed: ParsedEvidence = { checks: [], review: null, screenshots: [], screenshotsNone: null };
  // The first line is the record's own heading.
  for (const rawLine of record.split("\n").slice(1)) {
    const line = rawLine.replace(/^[\s>*•-]+/, "").replace(/\*\*/g, "").trim();
    const labelled = /^(checks?|review|screenshots?)\s*:\s*(.*)$/i.exec(line);
    if (labelled === null) continue;
    const label = (labelled[1] ?? "").toLowerCase();
    const value = (labelled[2] ?? "").trim();
    if (label.startsWith("check")) {
      const [command, result] = splitAtSeparator(value);
      parsed.checks.push({ command, result });
    } else if (label === "review") {
      if (value !== "") parsed.review = value;
    } else {
      const [first, rest] = splitAtSeparator(value);
      if (label === "screenshots" && first.toLowerCase() === "none") parsed.screenshotsNone = rest;
      else if (first !== "") parsed.screenshots.push({ file: first.replace(/^`+|`+$/g, ""), caption: rest });
    }
  }
  return parsed;
}

/** A bare file name inside the ticket's evidence folder: no path, no way out of it. */
export function isBareFileName(file: string): boolean {
  return file !== "" && !/[\\/]/.test(file) && !file.includes("..");
}

export function judgeEvidence(
  parsed: ParsedEvidence | null,
  options: { investigation: boolean; existingFiles: ReadonlySet<string> },
): JudgedEvidence {
  if (parsed === null) {
    return { checks: [], review: null, screenshots: [], screenshotsNone: null, missing: ["an EVIDENCE record"], complete: false };
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
    }
    for (const shot of screenshots) {
      if (shot.present) continue;
      missing.push(isBareFileName(shot.file) ? `screenshot file ${shot.file}` : `a plain file name for screenshot ${shot.file} (no folders)`);
    }
  }
  return {
    checks,
    review: parsed.review,
    screenshots,
    screenshotsNone: parsed.screenshotsNone === "" ? null : parsed.screenshotsNone,
    missing,
    complete: missing.length === 0,
  };
}
