/**
 * A pull request's live state on GitHub (TR-152), as `gh pr view --json state,isDraft` reports it,
 * and the PR mark each state gets: grey draft, green open (ready), purple merged, red closed.
 */

export const PULL_REQUEST_STATES = ["draft", "open", "merged", "closed"] as const;

export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

/** The fields asked of `gh pr view --json`. */
export const GH_STATE_FIELDS = "state,isDraft";

/** `gh pr view --json state,isDraft` output as a state; null when it does not say (not JSON, a field missing, a state GitHub added later). */
export function parsePullRequestState(stdout: string): PullRequestState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { state, isDraft } = parsed as Record<string, unknown>;
  if (typeof state !== "string" || typeof isDraft !== "boolean") return null;
  switch (state.toUpperCase()) {
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "closed";
    case "OPEN":
      return isDraft ? "draft" : "open";
    default:
      return null;
  }
}

/** Merged and closed pull requests rarely change again (a closed one may reopen, so it is read again now and then). */
export function stateLifetimeMs(state: PullRequestState | null): number {
  if (state === "merged") return Number.POSITIVE_INFINITY;
  if (state === "closed") return 10 * 60_000;
  // gh missing, logged out or offline: ask again later, not on every poll.
  if (state === null) return 5 * 60_000;
  return 60_000;
}

export type PullRequestTone = "muted" | "open" | "merged" | "closed";

export interface PullRequestMark {
  icon: "GitPullRequest" | "GitPullRequestDraft" | "GitMerge" | "GitPullRequestClosed";
  tone: PullRequestTone;
  /** Said after "Open PR #42" to a screen reader; empty when the state is unknown. */
  spoken: string;
}

/**
 * The mark for what GitHub said and what the records say. A merge the records hold wins over an
 * older answer from GitHub; with no answer yet (or no gh) the mark is the records' alone: purple
 * merged, otherwise the grey PR icon.
 */
export function pullRequestMark(state: PullRequestState | null, recordedMerged: boolean): PullRequestMark {
  if (recordedMerged || state === "merged") return { icon: "GitMerge", tone: "merged", spoken: ", merged" };
  if (state === "draft") return { icon: "GitPullRequestDraft", tone: "muted", spoken: ", draft" };
  if (state === "open") return { icon: "GitPullRequest", tone: "open", spoken: ", ready" };
  if (state === "closed") return { icon: "GitPullRequestClosed", tone: "closed", spoken: ", closed" };
  return { icon: "GitPullRequest", tone: "muted", spoken: "" };
}
