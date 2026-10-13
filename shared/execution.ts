/**
 * Facts read back from a ticket's EXECUTION records. Owners write these by hand,
 * so the parsing tolerates the usual variants (`workspace wks_…`, `workspace: wks_…`,
 * `workspace id \`wks_…\``) and reads every record, newest first: a relaunched
 * owner's record may leave out what an earlier one said.
 */

/** The notes split into records; each record starts a line with its upper-case name. */
export function noteRecords(notes: string | null): string[] {
  if (notes === null) return [];
  return notes
    .split(/\n(?=[A-Z][A-Z-]{2,}\b)/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

function newestExecutionMatch(notes: string | null, pattern: RegExp): string | null {
  const records = noteRecords(notes).filter((record) => /^EXECUTION\b/.test(record));
  for (let index = records.length - 1; index >= 0; index--) {
    const match = pattern.exec(records[index] ?? "")?.[1];
    if (match !== undefined) return match;
  }
  return null;
}

/** The Paseo workspace the ticket's owner worked in, from the newest EXECUTION record that names one. */
export function executionWorkspace(notes: string | null): string | null {
  return newestExecutionMatch(notes, /\bworkspace(?:[ _-]?id)?\b[\s:=`*"']*(wks_[A-Za-z0-9]+)/i);
}

/** The machine the ticket's owner ran on (`machine` or `host`), from the newest EXECUTION record that names one. */
export function executionMachine(notes: string | null): string | null {
  // A sentence's full stop is not part of the name; a wrong name would hide the card's Relaunch.
  return newestExecutionMatch(notes, /\b(?:machine|host(?:name)?)\b[\s:=`*"']*([A-Za-z0-9][A-Za-z0-9._-]*)/i)?.replace(/\.+$/, "") ?? null;
}

/** The last match's first group in the newest record that has one. */
function newestRecordMatch(notes: string | null, pattern: RegExp): string | null {
  const records = noteRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const matches = [...(records[index] ?? "").matchAll(pattern)];
    const last = matches[matches.length - 1]?.[1];
    if (last !== undefined) return last;
  }
  return null;
}

/**
 * The review head the owner recorded (`review-head: <sha>`), newest first. Owners write it into a
 * fresh EXECUTION record or an existing one, sometimes in a MILESTONE, so any record counts. Only a
 * full sha: `gh pr merge --match-head-commit` refuses a short one, and owners mention the head
 * abbreviated in later notes ("review-head 1960d60… recorded"), which must not replace it.
 */
export function reviewHead(notes: string | null): string | null {
  return newestRecordMatch(notes, /\breview[ _-]?head\b[\s:=`*"']*([0-9a-f]{40})(?![0-9a-z])/gi)?.toLowerCase() ?? null;
}

const PULL_REQUEST_URL = /https?:\/\/[^\s)<>`"'\]]+\/pull\/\d+/g;

/**
 * The ticket's pull request: the newest one recorded as `pr: <url>`; else the newest PR URL in the
 * notes, then in the final summary. The label wins because notes also cite other projects' PRs.
 */
export function pullRequestUrl(notes: string | null, finalSummary: string | null): string | null {
  return (
    newestRecordMatch(notes, new RegExp(`\\bpr\\b[*\\s]*[:=][\\s\`*"']*(${PULL_REQUEST_URL.source})`, "gi")) ??
    newestRecordMatch(notes, new RegExp(`(${PULL_REQUEST_URL.source})`, "g")) ??
    finalSummary?.match(PULL_REQUEST_URL)?.[0] ??
    null
  );
}

/**
 * The final summary as the user reads it: without the record header an owner writes before it
 * ("FINAL 2026-10-13T17:50Z —"), which is for the tracker, not for reading.
 */
export function finalSummaryBody(finalSummary: string): string {
  return finalSummary.replace(/^\s*\**FINAL\**(?:\s+\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)?\s*(?:[\u2014\u2013:-]+\s*)?/, "").trim();
}

/** What Accept tells the owner of a pull-request ticket: the PR and head to merge, or not to merge at all. */
export function pullRequestMergeInstruction(notes: string | null, finalSummary: string | null): string {
  const head = reviewHead(notes);
  const url = pullRequestUrl(notes, finalSummary);
  // Without both, "the head I reviewed" is unknowable, so merging anything would merge unreviewed code.
  if (head === null || url === null)
    return `Do not merge: the ticket records ${head === null ? "no review-head" : `review-head ${head}`} and ${url === null ? "no PR URL" : `PR ${url}`}. Record both in EXECUTION and present it again.`;
  return `Merge ${url} now as roles/owner.md says, only if its headRefOid is still the recorded review head ${head} (gh pr merge ${url} --match-head-commit ${head}); confirm it merged, then record ACCEPTANCE and set the ticket Done. If the head moved, do not merge; present it again.`;
}

/** What the plugin records when the user presses Accept (TR-031): when, and what the owner merges, if anything. */
export interface AcceptedRecord {
  at: string;
  /** "into main", "the pull request", or null when the owner only closes the ticket. */
  merging: string | null;
}

export function acceptedRecordText(at: string, merging: string | null): string {
  return `ACCEPTED ${at} — the user accepted; merging: ${merging ?? "none"}`;
}

/**
 * The newest ACCEPTED record, unless since then the owner presented again (a later EVIDENCE record,
 * or an EXECUTION record with a new review head: the head moved, so nothing merged) or the user
 * asked for changes (CHANGES-REQUESTED). Until the owner sets Done, the card says it merges.
 */
export function acceptedRecord(notes: string | null): AcceptedRecord | null {
  const records = noteRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (/^(?:EVIDENCE|CHANGES-REQUESTED)\b/.test(record)) return null;
    if (/^EXECUTION\b/.test(record) && /\breview[ _-]?head\b[\s:=`*"']*[0-9a-f]{40}(?![0-9a-z])/i.test(record)) return null;
    const match = /^ACCEPTED\s+(\S+)[^\n]*?merging:\s*([^\n]+)/.exec(record);
    if (match !== null) {
      const merging = (match[2] ?? "").trim();
      return { at: match[1] ?? "", merging: merging === "none" || merging === "" ? null : merging };
    }
  }
  return null;
}
