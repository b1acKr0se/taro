/**
 * The ticket's check log: each check run through `taro check -- <command>`, with its exit code, its
 * last summary line and the commit it ran at. `taro deliver` offers the newest run of each command at
 * the delivered head as EVIDENCE `check:` lines, so an owner no longer copies results by hand.
 * Pure and import-free: the `taro` command runs it under Node type stripping.
 */

export interface CheckEntry {
  at: string;
  command: string;
  exitCode: number | null;
  summary: string;
  /** The commit checked out when it ran; null outside a git repository. */
  head: string | null;
  /** Tracked files differed from that commit, so the run checked something else. */
  dirty: boolean;
  /** Untracked files sat in the tree, so the run may have passed on a file the commit lacks. */
  untracked?: boolean;
  /** Where it ran, relative to the repository root ("" at the root; "api/" in a monorepo's package). */
  prefix?: string;
}

const SUMMARY_LIMIT = 200;

// Colour and cursor codes a test runner prints even into a file.
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** Words a runner's closing line carries ("Tests  12 passed", "3 failing", "Found 0 errors", "ok"). */
const SUMMARY_WORDS = /\b(?:pass(?:ed|es|ing)?|fail(?:ed|s|ing|ures?)?|errors?|warnings?|tests?|ok|success(?:ful)?|skipped)\b/i;

function lines(text: string): string[] {
  return text
    .replace(ANSI, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function clip(line: string): string {
  const flat = line.replace(/\s+/g, " ");
  return flat.length <= SUMMARY_LIMIT ? flat : `${flat.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`;
}

/** The last line that reads as a summary, standard output first; else the last line printed; "" for none. */
export function summaryLine(stdout: string, stderr: string): string {
  for (const stream of [stdout, stderr]) {
    const found = lines(stream).reverse().find((line) => SUMMARY_WORDS.test(line));
    if (found !== undefined) return clip(found);
  }
  const last = [...lines(stdout), ...lines(stderr)].pop();
  return last === undefined ? "" : clip(last);
}

/** The ticket a branch works on: `taro/tr-12` and a reopened round's `taro/tr-12-2` are TR-12; null for any other branch. */
export function ticketFromBranch(branch: string): string | null {
  const match = /^taro\/([a-z][a-z0-9]*-\d+(?:\.\d+)*)(?:-\d+)?$/i.exec(branch.trim());
  return match === null ? null : (match[1] ?? "").toUpperCase();
}

/** The log's entries, one JSON object a line; a line that is not one is skipped. */
export function parseCheckLog(text: string | null): CheckEntry[] {
  if (text === null) return [];
  return text.split("\n").flatMap((line): CheckEntry[] => {
    if (line.trim() === "") return [];
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (typeof value.command !== "string" || typeof value.at !== "string") return [];
      return [
        {
          at: value.at,
          command: value.command,
          exitCode: typeof value.exitCode === "number" ? value.exitCode : null,
          summary: typeof value.summary === "string" ? value.summary : "",
          head: typeof value.head === "string" ? value.head : null,
          dirty: value.dirty === true,
          untracked: value.untracked === true,
          prefix: typeof value.prefix === "string" ? value.prefix : "",
        },
      ];
    } catch {
      return [];
    }
  });
}

/** One entry as the log's line. */
export function checkLogLine(entry: CheckEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

/** An entry as an EVIDENCE `check:` line: `check: <command> — exit <code>; <summary>`. */
export function checkEvidenceLine(entry: CheckEntry): string {
  const exit = entry.exitCode === null ? "killed" : `exit ${entry.exitCode}`;
  return `check: ${entry.command} — ${exit}${entry.summary === "" ? "" : `; ${entry.summary}`}`;
}

/**
 * The checks to offer for `head` (any, when null): the newest run of each command that ran at that commit with no
 * uncommitted change, oldest run first. `others` counts runs left out (another commit, or
 * uncommitted changes), so the owner knows to run them again.
 */
export function checksAtHead(entries: readonly CheckEntry[], head: string | null): { offered: CheckEntry[]; others: number } {
  const newest = new Map<string, CheckEntry>();
  let others = 0;
  for (const entry of entries) {
    // No head (an investigation delivers no commit): every run counts.
    if (head !== null && (entry.head !== head || entry.dirty)) {
      others += 1;
      continue;
    }
    newest.delete(entry.command);
    newest.set(entry.command, entry);
  }
  return { offered: [...newest.values()], others };
}

/**
 * The earlier run `taro check` may answer instead of running `command` again: the newest run of that command at `head`
 * from the same directory with nothing uncommitted or untracked beside it, when it passed. A failed newest run is never reused (it may have been the flaky one), and
 * with no head (outside git) nothing is known about what ran.
 */
export function reusableCheck(entries: readonly CheckEntry[], command: string, head: string | null, prefix = ""): CheckEntry | null {
  if (head === null) return null;
  const newest = entries.filter((entry) => entry.command === command && entry.head === head && (entry.prefix ?? "") === prefix && !entry.dirty && entry.untracked !== true).pop();
  return newest !== undefined && newest.exitCode === 0 ? newest : null;
}

/** The paths in `git status --porcelain` output, tracked changes and untracked files apart. */
export function strayChanges(porcelain: string): { tracked: string[]; untracked: string[] } {
  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.trim() === "") continue;
    (line.startsWith("??") ? untracked : tracked).push(line.slice(3));
  }
  return { tracked, untracked };
}

/** The warning printed before a check runs beside uncommitted work; null when the tree is clean. */
export function strayWarning(stray: { tracked: readonly string[]; untracked: readonly string[] }): string | null {
  const list = (paths: readonly string[]): string => `${paths.slice(0, 3).join(", ")}${paths.length > 3 ? `, ${paths.length - 3} more` : ""}`;
  const parts: string[] = [];
  if (stray.tracked.length > 0) parts.push(`changed tracked files (${list(stray.tracked)}) make this run not offered as evidence: commit or restore them first, or the run is wasted`);
  if (stray.untracked.length > 0) parts.push(`untracked files (${list(stray.untracked)}) may change the result`);
  return parts.length === 0 ? null : parts.join("; ");
}
