import { describe, expect, it } from "vitest";

import { executionMachine, executionWorkspace, noteRecords, pullRequestMergeInstruction, pullRequestUrl, reviewHead } from "./execution";

const managerRecord = "EXECUTION 2026-10-13T11:22Z — owner agent d86f, workspace wks_67ddffd9312aa95a, machine devbox, worktree /w/tr-001";
// As a Haiku owner wrote it on the throwaway daemon: the relaunch could not find its workspace (TR-001).
const ownerRecord = "EXECUTION 2026-10-13T11:24Z — owner agent: e2d7; workspace: wks_aa0a7ad239386299; machine: devbox; worktree: /tmp/sc-001";

describe("executionWorkspace", () => {
  it("reads the workspace however the record spells it", () => {
    expect(executionWorkspace(managerRecord)).toBe("wks_67ddffd9312aa95a");
    expect(executionWorkspace(ownerRecord)).toBe("wks_aa0a7ad239386299");
    expect(executionWorkspace("EXECUTION x — workspace=wks_abc1")).toBe("wks_abc1");
    expect(executionWorkspace("EXECUTION x — workspace id `wks_abc2`")).toBe("wks_abc2");
    expect(executionWorkspace("EXECUTION x — **Workspace:** wks_abc3")).toBe("wks_abc3");
    expect(executionWorkspace("EXECUTION x — workspaceId: wks_abc4")).toBe("wks_abc4");
  });

  it("takes the newest record that names a workspace", () => {
    const notes = [managerRecord, "MILESTONE m — built", "EXECUTION later — owner agent a073 (took over)", "MILESTONE n — more"].join("\n\n");
    expect(executionWorkspace(notes)).toBe("wks_67ddffd9312aa95a");
    expect(executionWorkspace(`${notes}\n\n${ownerRecord}`)).toBe("wks_aa0a7ad239386299");
  });

  it("ignores workspaces named outside EXECUTION records", () => {
    expect(executionWorkspace("MILESTONE m — workspace wks_nothere")).toBeNull();
    expect(executionWorkspace("EXECUTION x — owner agent a, no workspace yet")).toBeNull();
    expect(executionWorkspace("")).toBeNull();
    expect(executionWorkspace(null)).toBeNull();
  });
});

describe("executionMachine", () => {
  it("reads machine or host", () => {
    expect(executionMachine(managerRecord)).toBe("devbox");
    expect(executionMachine(ownerRecord)).toBe("devbox");
    expect(executionMachine("EXECUTION x — host: laptop.local")).toBe("laptop.local");
    expect(executionMachine("EXECUTION x — hostname=build-1")).toBe("build-1");
    expect(executionMachine("EXECUTION x — worktree /w, machine devbox.")).toBe("devbox");
    expect(executionMachine("EXECUTION x — machine `laptop.local`.")).toBe("laptop.local");
  });

  it("takes the newest record that names one, and nothing otherwise", () => {
    expect(executionMachine(`${managerRecord}\n\nEXECUTION y — machine: other-box`)).toBe("other-box");
    expect(executionMachine("EXECUTION y — owner agent a")).toBeNull();
    expect(executionMachine(null)).toBeNull();
  });
});

describe("noteRecords", () => {
  it("splits on record names and drops empty blocks", () => {
    expect(noteRecords("EXECUTION a\nline two\n\nMILESTONE b")).toEqual(["EXECUTION a\nline two", "MILESTONE b"]);
    expect(noteRecords(null)).toEqual([]);
  });
});

describe("reviewHead", () => {
  it("reads the sha however the record spells it", () => {
    expect(reviewHead("EXECUTION x — review-head: 3f9a2c1d")).toBe("3f9a2c1d");
    expect(reviewHead("EXECUTION x — review head `3F9A2C1D4E5F`.")).toBe("3f9a2c1d4e5f");
    expect(reviewHead("EXECUTION x — **review-head:** 0123456789abcdef0123456789abcdef01234567")).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(reviewHead("MILESTONE m — pushed; review_head=abcdef1")).toBe("abcdef1");
  });

  it("takes the newest recorded head, after a request for changes", () => {
    const notes = ["EXECUTION a — review-head: aaaaaaa", "CHANGES-REQUESTED b — the user: \"rename it\"", "EXECUTION c — review-head: bbbbbbb"].join("\n\n");
    expect(reviewHead(notes)).toBe("bbbbbbb");
    expect(reviewHead("EXECUTION a — review-head: aaaaaaa, then review-head: ccccccc")).toBe("ccccccc");
  });

  it("finds none when no head or only a short or non-hex value is named", () => {
    expect(reviewHead(null)).toBeNull();
    expect(reviewHead("")).toBeNull();
    expect(reviewHead("EXECUTION x — review-head: abc")).toBeNull();
    expect(reviewHead("EXECUTION x — review-head: pending")).toBeNull();
    expect(reviewHead("EXECUTION x — base main @ 8c7762741a169f74")).toBeNull();
  });
});

describe("pullRequestUrl", () => {
  it("takes the newest PR named in the notes", () => {
    const notes = ["MILESTONE a — draft PR https://github.com/o/r/pull/7 opened", "EXECUTION b — pr: https://github.com/o/r/pull/9, review-head: abcdef1"].join("\n\n");
    expect(pullRequestUrl(notes, null)).toBe("https://github.com/o/r/pull/9");
  });

  it("stops at punctuation and markdown around the URL", () => {
    expect(pullRequestUrl("EXECUTION x — PR (https://ghe.example.com/o/r/pull/12).", null)).toBe("https://ghe.example.com/o/r/pull/12");
    expect(pullRequestUrl("EXECUTION x — [PR](https://github.com/o/r/pull/3)", null)).toBe("https://github.com/o/r/pull/3");
    expect(pullRequestUrl("EXECUTION x — `https://github.com/o/r/pull/4`", null)).toBe("https://github.com/o/r/pull/4");
  });

  it("falls back to the final summary, and finds none otherwise", () => {
    expect(pullRequestUrl("MILESTONE a — built", "Delivered in https://github.com/o/r/pull/5")).toBe("https://github.com/o/r/pull/5");
    expect(pullRequestUrl(null, null)).toBeNull();
    expect(pullRequestUrl("MILESTONE a — see https://github.com/o/r/issues/5", "")).toBeNull();
  });
});

describe("pullRequestMergeInstruction", () => {
  const head = "0123456789abcdef0123456789abcdef01234567";

  it("names the PR and the recorded head to merge with", () => {
    const text = pullRequestMergeInstruction(`EXECUTION x — pr: https://github.com/o/r/pull/9, review-head: ${head}`, null);
    expect(text).toContain(`gh pr merge https://github.com/o/r/pull/9 --match-head-commit ${head}`);
    expect(text).toContain("If the head moved, do not merge");
  });

  it("says not to merge when the head or the PR is unrecorded", () => {
    expect(pullRequestMergeInstruction("EXECUTION x — pr: https://github.com/o/r/pull/9", null)).toMatch(/^Do not merge: .*no review-head and PR https:\/\/github.com\/o\/r\/pull\/9/);
    expect(pullRequestMergeInstruction(`EXECUTION x — review-head: ${head}`, null)).toMatch(new RegExp(`^Do not merge: .*review-head ${head} and no PR URL`));
    expect(pullRequestMergeInstruction(null, null)).toMatch(/^Do not merge/);
  });
});
