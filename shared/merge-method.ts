/**
 * How Accept merges a pull request (TR-110): the setting's names, the `gh pr merge` flag for each,
 * and which methods the GitHub repository allows, as `gh repo view` reports them.
 */
import type { MergeMethod } from "./project";

export const MERGE_METHODS: readonly MergeMethod[] = ["merge", "rebase", "squash"];

export const MERGE_METHOD_TITLES: Readonly<Record<MergeMethod, string>> = { merge: "Merge commit", rebase: "Rebase", squash: "Squash" };

export function mergeFlag(method: MergeMethod): string {
  return `--${method}`;
}

/** The fields `gh repo view --json` takes for each method. */
export const GH_ALLOWED_FIELDS: Readonly<Record<MergeMethod, string>> = {
  merge: "mergeCommitAllowed",
  rebase: "rebaseMergeAllowed",
  squash: "squashMergeAllowed",
};

export type AllowedMergeMethods = Record<MergeMethod, boolean>;

/** `gh repo view --json …` output as the allowed methods; null when it does not say (not JSON, a field missing). */
export function parseAllowedMergeMethods(stdout: string): AllowedMergeMethods | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const fields = parsed as Record<string, unknown>;
  const allowed = { merge: fields[GH_ALLOWED_FIELDS.merge], rebase: fields[GH_ALLOWED_FIELDS.rebase], squash: fields[GH_ALLOWED_FIELDS.squash] };
  if (typeof allowed.merge !== "boolean" || typeof allowed.rebase !== "boolean" || typeof allowed.squash !== "boolean") return null;
  return allowed as AllowedMergeMethods;
}

/** A method's note in the settings form: why it cannot be chosen, or a warning on one already chosen; null when it is fine or unknown. */
export function mergeMethodNote(method: MergeMethod, allowed: AllowedMergeMethods | null, selected: boolean): string | null {
  if (allowed === null || allowed[method]) return null;
  return selected
    ? "GitHub does not allow this method for the repository: Accept will not merge until you pick another one or allow it on GitHub."
    : "GitHub does not allow this method for the repository.";
}

/** What each method does to the branch's commits, on its card in the settings form. */
export function mergeMethodDescription(method: MergeMethod, branch: string): string {
  if (method === "merge") return `Keeps every commit of the branch and adds a merge commit on ${branch}.`;
  if (method === "rebase") return `Puts the branch's commits on top of ${branch} one by one, as new commits; no merge commit.`;
  return `Folds the branch into one new commit on ${branch}; its separate commits are not kept.`;
}

/** The Merge method field's hint: whose email the new commit carries, and how the local base branch follows. */
export function mergeMethodHint(branch: string): string {
  return (
    'Merge commit and Squash make a new commit with your GitHub account\'s commit email (your personal address unless "Keep my email addresses private" is on); Rebase keeps each commit\'s author. ' +
    `After merging, Taro fast-forwards your local ${branch} to GitHub's while it is checked out with no changes or commits of its own.`
  );
}
