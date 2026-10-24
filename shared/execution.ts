/**
 * Facts read back from a ticket's EXECUTION records. Owners write these by hand,
 * so the parsing tolerates the usual variants (`workspace wks_…`, `workspace: wks_…`,
 * `workspace id \`wks_…\``) and reads every record of the round in progress, newest first: a
 * relaunched owner's record may leave out what an earlier one said, and a reopened ticket's earlier
 * rounds (TR-229) delivered something else.
 */

import { MERGE_METHOD_TITLES, mergeFlag } from "./merge-method";
import type { MergeMethod } from "./project";
import { reopenRound, roundNotes } from "./reopen";

/** The notes split into records; each record starts a line with its upper-case name. */
export function noteRecords(notes: string | null): string[] {
  if (notes === null) return [];
  return notes
    .split(/\n(?=[A-Z][A-Z-]{2,}\b)/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

/** The records of the round in progress (TR-229): after the latest REOPENED record, else all of them. */
export function roundRecords(notes: string | null): string[] {
  return noteRecords(roundNotes(notes));
}

/** The owners named in every round's EXECUTION records (`owner <id>`), oldest first, each once. */
export function executionOwners(notes: string | null): string[] {
  const owners = noteRecords(notes)
    .filter((record) => /^EXECUTION\b/.test(record))
    .flatMap((record) => [...record.matchAll(/\bowner[\s:=`*"']+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi)].map((match) => (match[1] ?? "").toLowerCase()));
  return [...new Set(owners)];
}

function newestExecutionMatch(notes: string | null, pattern: RegExp): string | null {
  const records = roundRecords(notes).filter((record) => /^EXECUTION\b/.test(record));
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
  const records = roundRecords(notes);
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
  return newestRecordMatch(notes, new RegExp(REVIEW_HEAD.source, "gi"))?.toLowerCase() ?? null;
}

/** `review-head: <full sha>` as owners write it; one pattern, so presenting again and merging agree. */
const REVIEW_HEAD = /\breview[ _-]?head\b[\s:=`*"']*([0-9a-f]{40})(?![0-9a-z])/i;

const PULL_REQUEST_URL = /https?:\/\/[^\s)<>`"'\]]+\/pull\/\d+/g;

/**
 * The ticket's pull request: the newest one recorded as `pr: <url>`; else the newest PR URL in the
 * notes, then in the final summary. The label wins because notes also cite other projects' PRs.
 * A reopened round never reads the final summary: Reopen keeps the earlier round's, whose pull
 * request is merged already (TR-229).
 */
export function pullRequestUrl(notes: string | null, finalSummary: string | null): string | null {
  return (
    newestRecordMatch(notes, new RegExp(`\\bpr\\b[*\\s]*[:=][\\s\`*"']*(${PULL_REQUEST_URL.source})`, "gi")) ??
    newestRecordMatch(notes, new RegExp(`(${PULL_REQUEST_URL.source})`, "g")) ??
    (reopenRound(notes) === 1 ? finalSummary?.match(PULL_REQUEST_URL)?.[0] : undefined) ??
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

/** Where a pull request merges and how (TR-110): the project's merge method, and the main checkout whose base branch follows. */
export interface PullRequestMergeTarget {
  method: MergeMethod;
  baseBranch: string;
  repoPath: string;
}

/**
 * What Accept tells the owner of a pull-request ticket: the PR and head to merge with the project's
 * method, then the base branch in the main checkout to fast-forward from origin (TR-110), or not to merge at all.
 */
export function pullRequestMergeInstruction(notes: string | null, finalSummary: string | null, target: PullRequestMergeTarget): string {
  const head = reviewHead(notes);
  const url = pullRequestUrl(notes, finalSummary);
  // Without both, "the head I reviewed" is unknowable, so merging anything would merge unreviewed code.
  if (head === null || url === null)
    return `Do not merge: the ticket records ${head === null ? "no review-head" : `review-head ${head}`} and ${url === null ? "no PR URL" : `PR ${url}`}. Record both in EXECUTION and present it again.`;
  const { method, baseBranch, repoPath } = target;
  const title = MERGE_METHOD_TITLES[method];
  return (
    `Merge ${url} now as roles/owner.md says (Accept, pull request), with the project's merge method, ${title}, only if its headRefOid is still the recorded review head ${head}: ` +
    `gh pr merge ${url} ${mergeFlag(method)} --match-head-commit ${head}. Confirm its state is MERGED (an earlier Accept may have merged it already: then go on). ` +
    `Then bring ${baseBranch} in the main checkout (${repoPath}) up to origin, only while it is on ${baseBranch} and git -C ${repoPath} status --porcelain prints nothing (an untracked file counts): ` +
    `git -C ${repoPath} fetch origin ${baseBranch}, then git -C ${repoPath} merge --ff-only origin/${baseBranch}. ` +
    "Then record ACCEPTANCE ending with its merge field, merge: merged <merge commit>, and set the ticket Done. " +
    "If the head moved, do not merge; present it again. " +
    `If GitHub refuses the ${title} method, do not use another: record NOT-MERGED with GitHub's reason. ` +
    `If ${baseBranch} cannot fast-forward (uncommitted changes, another branch checked out, commits origin lacks, the fetch failed), do not touch it, and still finish: the pull request merged, so the ticket closes. Say in the ACCEPTANCE prose that local ${baseBranch} was not updated, with the reason and what I do.`
  );
}

/**
 * What Accept tells the owner of a local-branch ticket (TR-109): fast-forward the base branch in the
 * main checkout to the reviewed head, or not at all. roles/owner.md holds what to do when a check fails.
 */
export function localMergeInstruction(notes: string | null, baseBranch: string, repoPath: string): string {
  const head = reviewHead(notes);
  // As for a pull request: without the head the user reviewed, a fast-forward could land unreviewed code.
  if (head === null) return "Do not merge: the ticket records no review-head. Record it in EXECUTION and present it again.";
  return (
    `Fast-forward ${baseBranch} to your branch in the main checkout (${repoPath}) as roles/owner.md says (Accept, local branch), only while your branch head is still the recorded review head ${head} and the main checkout is clean and on ${baseBranch}. ` +
    `If ${baseBranch} moved, rebase first, and fast-forward only if the rebase applied with no conflicts and the checks pass. Then record ACCEPTANCE and set the ticket Done. ` +
    "A moved head, a conflict or failing checks: do not merge; fix it on your branch and present it again. " +
    `A dirty main checkout or one on another branch: do not touch it; record NOT-MERGED with the reason.`
  );
}

/** What the plugin records when the user presses Accept (TR-031): when, and what merges, if anything. */
export interface AcceptedRecord {
  at: string;
  /** "into main", "the pull request", or null when the owner only closes the ticket. */
  merging: string | null;
}

/** `byPlugin`: the plugin runs Accept's steps itself (TR-141), so a restart picks them up again. */
export function acceptedRecordText(at: string, merging: string | null, byPlugin = false): string {
  return `ACCEPTED ${at} — the user accepted; merging: ${merging ?? "none"}${byPlugin ? "; by: the plugin" : ""}`;
}

/**
 * The newest ACCEPTED record, unless since then the owner did not merge (NOT-MERGED, TR-109) or
 * merged a pull request but could not bring the local base branch up to it (NOT-SYNCED, TR-110),
 * presented again (a later EVIDENCE record, or an EXECUTION record with a new review head: the head
 * moved, so nothing merged) or the user asked for changes (CHANGES-REQUESTED). Until the owner sets Done, the card says it merges.
 */
export function acceptedRecord(notes: string | null): AcceptedRecord | null {
  const records = roundRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (/^(?:EVIDENCE|CHANGES-REQUESTED|NOT-MERGED|NOT-SYNCED)\b/.test(record)) return null;
    if (/^EXECUTION\b/.test(record) && REVIEW_HEAD.test(record)) return null;
    const match = /^ACCEPTED\s+(\S+)[^\n]*?merging:\s*([^;\n]+)/.exec(record);
    if (match !== null) {
      const merging = (match[2] ?? "").trim();
      return { at: match[1] ?? "", merging: merging === "none" || merging === "" ? null : merging };
    }
  }
  return null;
}

/**
 * Whether the plugin's own Accept steps (TR-141) were cut off: the ticket still merges after an
 * ACCEPTED record the plugin runs, and neither an outcome nor a hand-off to an owner followed it.
 */
export function pluginAcceptPending(notes: string | null): boolean {
  if (acceptedRecord(notes) === null) return false;
  const records = roundRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (/^(?:ACCEPT-HANDOFF|ACCEPTANCE)\b/.test(record)) return false;
    if (/^ACCEPTED\b/.test(record)) return /;\s*by:\s*the plugin\s*$/.test(record.split("\n")[0] ?? "");
  }
  return false;
}

/**
 * The ticket's branch from the newest EXECUTION record that names one (`branch taro/sh-12`). Owners
 * also log their reviewers there ("checking the whole branch at 1826b13", "branch main..taro/sh-12"),
 * so only a name with a slash and no range counts: Taro's branches are `taro/<id>`.
 */
export function executionBranch(notes: string | null): string | null {
  const records = roundRecords(notes).filter((record) => /^EXECUTION\b/.test(record));
  for (let index = records.length - 1; index >= 0; index--) {
    for (const match of (records[index] ?? "").matchAll(/\bbranch\b[\s:=`*"']*([A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9_])/gi)) {
      const name = match[1] ?? "";
      if (name.includes("/") && !name.includes("..")) return name;
    }
  }
  return null;
}

/**
 * Why the owner did not finish after Accept: a problem on the user's side, such as a dirty main checkout.
 * Either nothing merged (NOT-MERGED, TR-109), or the pull request merged and the local base branch
 * could not fast-forward to it (NOT-SYNCED, TR-110; since TR-215 Accept closes the ticket instead, and only older tickets carry the record).
 */
export interface NotMergedRecord {
  at: string;
  reason: string;
  merged: boolean;
}

/**
 * The newest NOT-MERGED or NOT-SYNCED record, until the user presses Accept again or asks for changes, the
 * owner asks a question that ends the delivery (DELIVERY-ENDED, TR-130), or the owner presents again (EVIDENCE, or a new review head): each makes the reason stale.
 */
export function notMergedRecord(notes: string | null): NotMergedRecord | null {
  const records = roundRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (/^(?:EVIDENCE|CHANGES-REQUESTED|DELIVERY-ENDED|ACCEPTED)\b/.test(record)) return null;
    if (/^EXECUTION\b/.test(record) && REVIEW_HEAD.test(record)) return null;
    const match = /^NOT-(MERGED|SYNCED)\s+(\S+)[ \t]*(?:[\u2014\u2013:-]+[ \t]*)?([^\n]*)/.exec(record);
    if (match !== null) {
      const reason = (match[3] ?? "").trim();
      return { at: match[2] ?? "", reason: reason === "" ? "the owner gave no reason" : reason, merged: match[1] === "SYNCED" };
    }
  }
  return null;
}

/** The fixed merge field of an ACCEPTANCE record (TR-114): `merge: merged <sha>`, `merge: not merged — <reason>`, `merge: none`. */
const MERGE_FIELD = /(?:^|[\s;,(—])merge:[ \t]*(merged|not merged|none)\b/gi;

/**
 * Whether the ticket's pull request merged, as its owner recorded at Accept. The newest ACCEPTANCE
 * record's merge field decides. Records written before the field existed are prose ("state MERGED",
 * "squash-merged as <sha>", "Merge: squash …"), so for those only the plugin's own ACCEPTED note
 * saying it merges the pull request, followed by an ACCEPTANCE record naming a PR and "MERGED" or a
 * merge commit, counts as merged.
 */
export function pullRequestMerged(notes: string | null): boolean {
  const records = roundRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (!/^ACCEPTANCE\b/.test(record)) continue;
    const fields = [...record.matchAll(MERGE_FIELD)];
    const field = fields[fields.length - 1]?.[1];
    if (field !== undefined) return field.toLowerCase() === "merged";
    // No lookbehind for "NOT MERGED": the client bundle runs on the phone's Hermes.
    const merged = /\bMERGED\b/.test(record.replace(/\bNOT[ -]MERGED\b/g, "")) || /\bmerge commit\b/i.test(record);
    if (!PULL_REQUEST_URL_ONCE.test(record) || !merged) return false;
    // The prose alone may describe a merge the plugin never asked for; its ACCEPTED note says it did.
    return records.slice(0, index).some((earlier) => /^ACCEPTED\b[^\n]*merging:\s*the pull request/i.test(earlier));
  }
  return false;
}

const PULL_REQUEST_URL_ONCE = new RegExp(PULL_REQUEST_URL.source);

/**
 * What the newest ACCEPTANCE record says merged, for the manager's Done wake-up (TR-147): its merge
 * field's value (`merged 0a1b2c3`, `not merged — <reason>`, `none`), or for a record written before
 * the field, its prose, clipped. Null with no ACCEPTANCE record (a ticket set Done by hand).
 */
export function acceptanceMerge(notes: string | null): string | null {
  const records = roundRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (!/^ACCEPTANCE\b/.test(record)) continue;
    const field = [...record.matchAll(MERGE_FIELD)].pop();
    if (field !== undefined) {
      const start = (field.index ?? 0) + field[0].toLowerCase().indexOf("merge:") + "merge:".length;
      return clip(record.slice(start).split("\n")[0] ?? "");
    }
    return clip(record.replace(/^ACCEPTANCE\s+\S+\s*(?:—|--|-)?\s*/, ""));
  }
  return null;
}

const MERGE_TEXT_LIMIT = 200;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MERGE_TEXT_LIMIT ? flat : `${flat.slice(0, MERGE_TEXT_LIMIT - 1).trimEnd()}…`;
}

