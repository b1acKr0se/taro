import { describe, expect, it } from "vitest";

import { acceptanceText, changedPaths, handoffText, ownerIsWarm, parsePullRequestView, WARM_OWNER_MS } from "./accept-merge";
import { acceptedRecord, acceptedRecordText, executionBranch, pluginAcceptPending, pullRequestMerged } from "./execution";

const now = Date.parse("2026-01-02T12:00:00Z");

describe("ownerIsWarm (TR-141)", () => {
  it("is warm under five minutes since the last turn ended, cold from five minutes on", () => {
    expect(ownerIsWarm(new Date(now - 1_000).toISOString(), false, now)).toBe(true);
    expect(ownerIsWarm(new Date(now - WARM_OWNER_MS + 1).toISOString(), false, now)).toBe(true);
    expect(ownerIsWarm(new Date(now - WARM_OWNER_MS).toISOString(), false, now)).toBe(false);
    expect(ownerIsWarm(new Date(now - 8 * 3_600_000).toISOString(), false, now)).toBe(false);
  });

  it("is warm mid-turn whatever the time, and cold when the time is unknown or unreadable", () => {
    expect(ownerIsWarm(new Date(now - 8 * 3_600_000).toISOString(), true, now)).toBe(true);
    expect(ownerIsWarm(null, true, now)).toBe(true);
    expect(ownerIsWarm(null, false, now)).toBe(false);
    expect(ownerIsWarm("not a time", false, now)).toBe(false);
  });
});

describe("parsePullRequestView", () => {
  it("reads state, head and merge commit, normalising case", () => {
    expect(parsePullRequestView(JSON.stringify({ state: "merged", headRefOid: "ABC", mergeCommit: { oid: "DEF" } }))).toEqual({ state: "MERGED", headRefOid: "abc", mergeCommit: "def" });
    expect(parsePullRequestView(JSON.stringify({ state: "OPEN", headRefOid: "abc", mergeCommit: null }))).toEqual({ state: "OPEN", headRefOid: "abc", mergeCommit: null });
    expect(parsePullRequestView(JSON.stringify({ state: "OPEN", headRefOid: "abc", mergeCommit: { oid: "" } }))?.mergeCommit).toBeNull();
  });

  it("is null for anything else", () => {
    expect(parsePullRequestView("")).toBeNull();
    expect(parsePullRequestView("null")).toBeNull();
    expect(parsePullRequestView(JSON.stringify({ state: "OPEN" }))).toBeNull();
    expect(parsePullRequestView(JSON.stringify({ state: 1, headRefOid: "abc" }))).toBeNull();
  });
});

describe("changedPaths", () => {
  it("lists up to three paths, then how many more", () => {
    expect(changedPaths(" M a.ts\n")).toBe("a.ts");
    expect(changedPaths("?? a\n M b\nA  c\n")).toBe("a, b, c");
    expect(changedPaths("?? a\n M b\nA  c\n D d\n?? e\n")).toBe("a, b, c and 2 more");
    expect(changedPaths("")).toBe("");
  });
});

describe("the plugin's records", () => {
  it("ends ACCEPTANCE with the merge field the board reads", () => {
    const text = acceptanceText("2026-01-02T00:00:00.000Z", "NT-1", "Accepted abc, PR https://example.test/o/r/pull/7; merged it", "merged def");
    expect(text).toBe('ACCEPTANCE 2026-01-02T00:00:00.000Z — user: "I accept NT-1." Accepted abc, PR https://example.test/o/r/pull/7; merged it; accepted and closed by the plugin; merge: merged def');
    const notes = `${acceptedRecordText("2026-01-02T00:00Z", "the pull request", true)}\n${text}`;
    expect(pullRequestMerged(notes)).toBe(true);
  });

  it("keeps the card's merging words without the plugin's tag", () => {
    expect(acceptedRecord(acceptedRecordText("2026-01-02T00:00Z", "into main", true))).toEqual({ at: "2026-01-02T00:00Z", merging: "into main" });
    expect(acceptedRecord(acceptedRecordText("2026-01-02T00:00Z", null, true))).toEqual({ at: "2026-01-02T00:00Z", merging: null });
    expect(acceptedRecord(acceptedRecordText("2026-01-02T00:00Z", "into main"))).toEqual({ at: "2026-01-02T00:00Z", merging: "into main" });
  });
});

describe("pluginAcceptPending", () => {
  const accepted = acceptedRecordText("2026-01-02T00:00Z", "into main", true);

  it("is pending after the plugin's ACCEPTED with nothing after it", () => {
    expect(pluginAcceptPending(`EVIDENCE 2026-01-01T00:00Z — x\n${accepted}`)).toBe(true);
    expect(pluginAcceptPending(`${accepted}\nMILESTONE 2026-01-02T00:01Z — noted`)).toBe(true);
  });

  it("is not pending after an outcome, a hand-off, or for an owner-run Accept", () => {
    expect(pluginAcceptPending(null)).toBe(false);
    expect(pluginAcceptPending(`${accepted}\n${handoffText("2026-01-02T00:01Z", "x", "the owner o")}`)).toBe(false);
    expect(pluginAcceptPending(`${accepted}\nACCEPTANCE 2026-01-02T00:01Z — merge: merged a`)).toBe(false);
    expect(pluginAcceptPending(`${accepted}\nNOT-MERGED 2026-01-02T00:01Z — dirty`)).toBe(false);
    expect(pluginAcceptPending(`${accepted}\nNOT-SYNCED 2026-01-02T00:01Z — dirty`)).toBe(false);
    expect(pluginAcceptPending(`${accepted}\nCHANGES-REQUESTED 2026-01-02T00:01Z — the user: "x"`)).toBe(false);
    expect(pluginAcceptPending(acceptedRecordText("2026-01-02T00:00Z", "into main"))).toBe(false);
  });

  it("is pending again after a later Accept on the same ticket", () => {
    const later = acceptedRecordText("2026-01-02T01:00Z", "into main", true);
    expect(pluginAcceptPending(`${accepted}\nNOT-MERGED 2026-01-02T00:01Z — dirty\n${later}`)).toBe(true);
  });
});

describe("executionBranch", () => {
  it("reads the branch from the newest EXECUTION record that names one", () => {
    expect(executionBranch("EXECUTION 2026-01-01T00:00Z — owner o, worktree /w, branch taro/nt-1, base 1a74a56")).toBe("taro/nt-1");
    expect(executionBranch("EXECUTION 2026-01-01T00:00Z — branch: `taro/nt-2`.")).toBe("taro/nt-2");
    expect(executionBranch("EXECUTION 2026-01-01T00:00Z — branch taro/nt-1\nEXECUTION 2026-01-02T00:00Z — review-head: x")).toBe("taro/nt-1");
    expect(executionBranch("MILESTONE 2026-01-01T00:00Z — branch other")).toBeNull();
    expect(executionBranch(null)).toBeNull();
  });
});
