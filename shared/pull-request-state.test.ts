// TR-152: the PR mark follows the pull request's state on GitHub.
import { describe, expect, it } from "vitest";

import { parsePullRequestState, pullRequestMark, stateLifetimeMs } from "./pull-request-state";

describe("parsePullRequestState", () => {
  it("reads draft, open, merged and closed, whatever the case", () => {
    expect(parsePullRequestState(JSON.stringify({ state: "OPEN", isDraft: true }))).toBe("draft");
    expect(parsePullRequestState(JSON.stringify({ state: "OPEN", isDraft: false }))).toBe("open");
    expect(parsePullRequestState(JSON.stringify({ state: "open", isDraft: false }))).toBe("open");
    expect(parsePullRequestState(JSON.stringify({ state: "MERGED", isDraft: false }))).toBe("merged");
    expect(parsePullRequestState(JSON.stringify({ state: "CLOSED", isDraft: false }))).toBe("closed");
    // A draft closed without merging is closed.
    expect(parsePullRequestState(JSON.stringify({ state: "CLOSED", isDraft: true }))).toBe("closed");
  });

  it("is null for anything else", () => {
    expect(parsePullRequestState("")).toBeNull();
    expect(parsePullRequestState("null")).toBeNull();
    expect(parsePullRequestState("[]")).toBeNull();
    expect(parsePullRequestState(JSON.stringify({ state: "OPEN" }))).toBeNull();
    expect(parsePullRequestState(JSON.stringify({ isDraft: false }))).toBeNull();
    expect(parsePullRequestState(JSON.stringify({ state: "OPEN", isDraft: "false" }))).toBeNull();
    expect(parsePullRequestState(JSON.stringify({ state: "LOCKED", isDraft: false }))).toBeNull();
  });
});

describe("stateLifetimeMs", () => {
  it("keeps a merge for good, a closed PR ten minutes, an open one a minute and a failure five", () => {
    expect(stateLifetimeMs("merged")).toBe(Number.POSITIVE_INFINITY);
    expect(stateLifetimeMs("closed")).toBe(600_000);
    expect(stateLifetimeMs("open")).toBe(60_000);
    expect(stateLifetimeMs("draft")).toBe(60_000);
    expect(stateLifetimeMs(null)).toBe(300_000);
  });
});

describe("pullRequestMark", () => {
  it("gives each state its icon, tone and spoken word", () => {
    expect(pullRequestMark("draft", false)).toEqual({ icon: "GitPullRequestDraft", tone: "muted", spoken: ", draft" });
    expect(pullRequestMark("open", false)).toEqual({ icon: "GitPullRequest", tone: "open", spoken: ", ready" });
    expect(pullRequestMark("merged", false)).toEqual({ icon: "GitMerge", tone: "merged", spoken: ", merged" });
    expect(pullRequestMark("closed", false)).toEqual({ icon: "GitPullRequestClosed", tone: "closed", spoken: ", closed" });
  });

  it("falls back to the records before GitHub answers", () => {
    expect(pullRequestMark(null, false)).toEqual({ icon: "GitPullRequest", tone: "muted", spoken: "" });
    expect(pullRequestMark(null, true)).toEqual({ icon: "GitMerge", tone: "merged", spoken: ", merged" });
  });

  it("lets a recorded merge win over an older answer from GitHub", () => {
    for (const state of ["draft", "open", "closed"] as const) expect(pullRequestMark(state, true).tone).toBe("merged");
  });
});
