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

/**
 * The review head the owner recorded (`review-head: <sha>`), newest first. Owners write it into a
 * fresh EXECUTION record or an existing one, sometimes in a MILESTONE, so any record counts.
 */
export function reviewHead(notes: string | null): string | null {
  const records = noteRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const matches = [...(records[index] ?? "").matchAll(/\breview[ _-]?head\b[\s:=`*"']*([0-9a-f]{7,40})\b/gi)];
    const last = matches[matches.length - 1]?.[1];
    if (last !== undefined) return last.toLowerCase();
  }
  return null;
}

const PULL_REQUEST_URL = /https?:\/\/[^\s)<>`"'\]]+\/pull\/\d+/g;

/** The ticket's pull request: the newest PR URL in the notes, else one in the final summary. */
export function pullRequestUrl(notes: string | null, finalSummary: string | null): string | null {
  const records = noteRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const matches = (records[index] ?? "").match(PULL_REQUEST_URL);
    if (matches !== null) return matches[matches.length - 1] ?? null;
  }
  return finalSummary?.match(PULL_REQUEST_URL)?.[0] ?? null;
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
