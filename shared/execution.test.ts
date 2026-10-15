import { describe, expect, it } from "vitest";

import { boardColumn } from "./board";
import { acceptedRecord, acceptedRecordText, executionMachine, executionWorkspace, finalSummaryBody, localMergeInstruction, noteRecords, notMergedRecord, pullRequestMergeInstruction, pullRequestMerged, pullRequestUrl, reviewHead } from "./execution";

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
  const full = "0123456789abcdef0123456789abcdef01234567";
  const other = "fedcba9876543210fedcba9876543210fedcba98";

  it("reads a full sha however the record spells it", () => {
    expect(reviewHead(`EXECUTION x — review-head: ${full}`)).toBe(full);
    expect(reviewHead(`EXECUTION x — review head \`${full.toUpperCase()}\`.`)).toBe(full);
    expect(reviewHead(`EXECUTION x — **review-head:** ${full}`)).toBe(full);
    expect(reviewHead(`MILESTONE m — pushed; review_head=${full}`)).toBe(full);
    expect(reviewHead(`EXECUTION x — pr: https://github.com/o/r/pull/1\nreview-head: ${full}`)).toBe(full);
  });

  it("takes the newest recorded head, after a request for changes", () => {
    const notes = [`EXECUTION a — review-head: ${other}`, "CHANGES-REQUESTED b — the user: \"rename it\"", `EXECUTION c — review-head: ${full}`].join("\n\n");
    expect(reviewHead(notes)).toBe(full);
    expect(reviewHead(`EXECUTION a — review-head: ${other}, then review-head: ${full}`)).toBe(full);
  });

  it("keeps the full head when a later note mentions it abbreviated (review of TR-013)", () => {
    const notes = [`EXECUTION a — pr: https://github.com/o/r/pull/1, review-head: ${full}`, "MILESTONE b — ready; review-head 0123456… recorded with pr:"].join("\n\n");
    expect(reviewHead(notes)).toBe(full);
    expect(reviewHead(`EXECUTION a — review-head: ${full}\n\nMILESTONE b — review-head: 0123456789ab`)).toBe(full);
  });

  it("finds none when only a short, longer or non-hex value is named", () => {
    expect(reviewHead(null)).toBeNull();
    expect(reviewHead("")).toBeNull();
    expect(reviewHead("EXECUTION x — review-head: 1960d60")).toBeNull();
    expect(reviewHead(`EXECUTION x — review-head: ${full}ab`)).toBeNull();
    expect(reviewHead("EXECUTION x — review-head: pending")).toBeNull();
    expect(reviewHead(`EXECUTION x — base main @ ${full}`)).toBeNull();
  });
});

describe("pullRequestUrl", () => {
  it("takes the newest PR named in the notes", () => {
    const notes = ["MILESTONE a — draft PR https://github.com/o/r/pull/7 opened", "MILESTONE b — moved to https://github.com/o/r/pull/9"].join("\n\n");
    expect(pullRequestUrl(notes, null)).toBe("https://github.com/o/r/pull/9");
  });

  it("prefers the recorded pr: over PRs cited later (review of TR-013)", () => {
    const notes = ["EXECUTION a — pr: https://github.com/o/r/pull/9, review-head: x", "MILESTONE b — blocked on https://github.com/x/y/pull/88; upstream PR https://github.com/x/y/pull/89"].join("\n\n");
    expect(pullRequestUrl(notes, null)).toBe("https://github.com/o/r/pull/9");
    expect(pullRequestUrl("EXECUTION a — **PR:** https://github.com/o/r/pull/3", null)).toBe("https://github.com/o/r/pull/3");
    expect(pullRequestUrl("EXECUTION a — pr: https://github.com/o/r/pull/3\n\nEXECUTION b — pr=https://github.com/o/r/pull/4", null)).toBe("https://github.com/o/r/pull/4");
  });

  it("stops at punctuation and markdown around the URL", () => {
    expect(pullRequestUrl("EXECUTION x — PR (https://ghe.example.com/o/r/pull/12).", null)).toBe("https://ghe.example.com/o/r/pull/12");
    expect(pullRequestUrl("EXECUTION x — [PR](https://github.com/o/r/pull/3)", null)).toBe("https://github.com/o/r/pull/3");
    expect(pullRequestUrl("EXECUTION x — pr: `https://github.com/o/r/pull/4`", null)).toBe("https://github.com/o/r/pull/4");
  });

  it("falls back to the final summary, and finds none otherwise", () => {
    expect(pullRequestUrl("MILESTONE a — built", "Delivered in https://github.com/o/r/pull/5")).toBe("https://github.com/o/r/pull/5");
    expect(pullRequestUrl(null, null)).toBeNull();
    expect(pullRequestUrl("MILESTONE a — see https://github.com/o/r/issues/5", "")).toBeNull();
  });
});

describe("pullRequestMergeInstruction", () => {
  const head = "0123456789abcdef0123456789abcdef01234567";
  const notes = `EXECUTION x — pr: https://github.com/o/r/pull/9, review-head: ${head}`;
  const target = { method: "merge", baseBranch: "main", repoPath: "/home/user/notes-app" } as const;

  it("names the PR, the project's merge method and the recorded head to merge with (TR-110)", () => {
    expect(pullRequestMergeInstruction(notes, null, target)).toContain(`gh pr merge https://github.com/o/r/pull/9 --merge --match-head-commit ${head}`);
    expect(pullRequestMergeInstruction(notes, null, { ...target, method: "rebase" })).toContain(`gh pr merge https://github.com/o/r/pull/9 --rebase --match-head-commit ${head}`);
    expect(pullRequestMergeInstruction(notes, null, { ...target, method: "squash" })).toContain(`gh pr merge https://github.com/o/r/pull/9 --squash --match-head-commit ${head}`);
    expect(pullRequestMergeInstruction(notes, null, { ...target, method: "squash" })).toContain("with the project's merge method, Squash,");
    expect(pullRequestMergeInstruction(notes, null, target)).toContain("If the head moved, do not merge");
  });

  it("never lets the owner fall back to another method GitHub allows, and says why it did not merge", () => {
    const text = pullRequestMergeInstruction(notes, null, { ...target, method: "rebase" });
    expect(text).toContain("If GitHub refuses the Rebase method, do not use another: record NOT-MERGED with GitHub's reason.");
    expect(text).not.toMatch(/squash unless/i);
  });

  it("brings the local base branch up to origin by fast-forward only, after the merge (TR-110)", () => {
    const text = pullRequestMergeInstruction(notes, null, { ...target, baseBranch: "develop" });
    expect(text).toContain(
      "Then bring develop in the main checkout (/home/user/notes-app) up to origin, only while it is on develop and git -C /home/user/notes-app status --porcelain prints nothing (an untracked file counts)",
    );
    expect(text).toContain("git -C /home/user/notes-app fetch origin develop, then git -C /home/user/notes-app merge --ff-only origin/develop");
    expect(text.indexOf("merge --ff-only")).toBeGreaterThan(text.indexOf("Confirm its state is MERGED"));
    expect(text.indexOf("record ACCEPTANCE")).toBeGreaterThan(text.indexOf("merge --ff-only"));
    expect(text).toContain("If develop cannot fast-forward (uncommitted changes, another branch checked out, commits origin lacks, the fetch failed), do not touch it: record NOT-SYNCED with the reason and what I do first (not that it merged: the card says so).");
  });

  it("lets a second Accept after NOT-SYNCED skip the merge GitHub already made", () => {
    expect(pullRequestMergeInstruction(notes, null, target)).toContain("an earlier Accept may have merged it already: then go on");
  });

  it("says not to merge when the head or the PR is unrecorded", () => {
    expect(pullRequestMergeInstruction("EXECUTION x — pr: https://github.com/o/r/pull/9", null, target)).toMatch(/^Do not merge: .*no review-head and PR https:\/\/github.com\/o\/r\/pull\/9/);
    expect(pullRequestMergeInstruction(`EXECUTION x — review-head: ${head}`, null, target)).toMatch(new RegExp(`^Do not merge: .*review-head ${head} and no PR URL`));
    expect(pullRequestMergeInstruction(null, null, target)).toMatch(/^Do not merge/);
  });
});

describe("finalSummaryBody", () => {
  it("drops the record header", () => {
    expect(finalSummaryBody("FINAL 2026-10-13T17:50Z \u2014 Notes sync on save.\n\n## Limitations\n- none")).toBe("Notes sync on save.\n\n## Limitations\n- none");
    expect(finalSummaryBody("FINAL 2026-10-13 - Notes sync on save.")).toBe("Notes sync on save.");
    expect(finalSummaryBody("**FINAL** \u2014 Notes sync on save.")).toBe("Notes sync on save.");
    expect(finalSummaryBody("FINAL\nNotes sync on save.")).toBe("Notes sync on save.");
  });

  it("keeps a summary without a header, and the word elsewhere", () => {
    expect(finalSummaryBody("Notes sync on save. FINAL 2026-10-13 is when.")).toBe("Notes sync on save. FINAL 2026-10-13 is when.");
    expect(finalSummaryBody("Finally, notes sync.")).toBe("Finally, notes sync.");
    expect(finalSummaryBody("")).toBe("");
  });
});

describe("acceptedRecord", () => {
  const evidence = "EVIDENCE 2026-01-05T10:00Z — before FINAL\ncheck: npm test — 37 passed";

  it("is null without an ACCEPTED record", () => {
    expect(acceptedRecord(null)).toBeNull();
    expect(acceptedRecord(evidence)).toBeNull();
  });

  it("reads back what the plugin writes, with and without a merge", () => {
    expect(acceptedRecord(`${evidence}\n${acceptedRecordText("2026-01-05T11:00:00.000Z", "into main")}`)).toEqual({ at: "2026-01-05T11:00:00.000Z", merging: "into main" });
    expect(acceptedRecord(`${evidence}\n${acceptedRecordText("2026-01-05T11:00:00.000Z", null)}`)).toEqual({ at: "2026-01-05T11:00:00.000Z", merging: null });
  });

  it("keeps the newest acceptance through the owner's later milestones", () => {
    const notes = `${acceptedRecordText("2026-01-05T11:00Z", "the pull request")}\nMILESTONE 2026-01-05T11:05Z — merging`;
    expect(acceptedRecord(notes)?.merging).toBe("the pull request");
  });

  it("is void once changes were requested or the owner delivered again", () => {
    const accepted = acceptedRecordText("2026-01-05T11:00Z", "into main");
    expect(acceptedRecord(`${accepted}\nCHANGES-REQUESTED 2026-01-05T11:10Z — the user: "no"`)).toBeNull();
    expect(acceptedRecord(`${accepted}\n${evidence}`)).toBeNull();
  });

  it("is void once the owner records a new review head to present again (the head moved)", () => {
    const accepted = acceptedRecordText("2026-01-05T11:00Z", "the pull request");
    const head = "a".repeat(40);
    expect(acceptedRecord(`${accepted}\nEXECUTION 2026-01-05T11:20Z — pr: https://example.test/o/r/pull/4, review-head: ${head}`)).toBeNull();
    // An abbreviated head in a milestone while merging is not a new presentation.
    expect(acceptedRecord(`${accepted}\nMILESTONE 2026-01-05T11:05Z — merging review-head aaaaaaa`)).not.toBeNull();
    expect(acceptedRecord(`${accepted}\nEXECUTION 2026-01-05T11:05Z — subagent reviewer started`)).not.toBeNull();
  });
});

describe("localMergeInstruction (TR-109)", () => {
  const head = "0123456789abcdef0123456789abcdef01234567";
  const text = localMergeInstruction(`EXECUTION x — review-head: ${head}`, "main", "/home/user/notes-app");

  it("names the main checkout, the base branch and the review head to fast-forward to", () => {
    expect(text).toContain("Fast-forward main to your branch in the main checkout (/home/user/notes-app)");
    expect(text).toContain(`still the recorded review head ${head}`);
    expect(text).toContain("the main checkout is clean and on main");
  });

  it("rebases a moved base, merging only a rebase with no conflicts and passing checks", () => {
    expect(text).toContain("If main moved, rebase first, and fast-forward only if the rebase applied with no conflicts and the checks pass");
  });

  it("presents again on a moved head, a conflict or failing checks, and records NOT-MERGED only for the main checkout", () => {
    expect(text).toContain("A moved head, a conflict or failing checks: do not merge; fix it on your branch and present it again.");
    expect(text).toContain("A dirty main checkout or one on another branch: do not touch it; record NOT-MERGED with the reason.");
  });

  it("refuses to merge without a recorded review head, or with only an abbreviated one", () => {
    expect(localMergeInstruction(null, "main", "/home/user/notes-app")).toBe("Do not merge: the ticket records no review-head. Record it in EXECUTION and present it again.");
    expect(localMergeInstruction("MILESTONE x — review-head 0123456", "main", "/home/user/notes-app")).toMatch(/^Do not merge/);
  });
});

describe("notMergedRecord (TR-109)", () => {
  const accepted = acceptedRecordText("2026-01-05T11:00:00.000Z", "into main");
  const notMerged = "NOT-MERGED 2026-01-05T11:04Z — the main checkout has uncommitted changes in src/app.ts";

  it("is null without one", () => {
    expect(notMergedRecord(null)).toBeNull();
    expect(notMergedRecord(accepted)).toBeNull();
  });

  it("reads the time and the reason, with an em dash, a hyphen, a colon or nothing between them", () => {
    expect(notMergedRecord(`${accepted}\n${notMerged}`)).toEqual({ at: "2026-01-05T11:04Z", reason: "the main checkout has uncommitted changes in src/app.ts", merged: false });
    expect(notMergedRecord("NOT-MERGED 2026-01-05T11:04Z - on release-2")?.reason).toBe("on release-2");
    expect(notMergedRecord("NOT-MERGED 2026-01-05T11:04Z: on release-2")?.reason).toBe("on release-2");
    expect(notMergedRecord("NOT-MERGED 2026-01-05T11:04Z on release-2")?.reason).toBe("on release-2");
    expect(notMergedRecord("NOT-MERGED 2026-01-05T11:04Z")?.reason).toBe("the owner gave no reason");
  });

  it("clears the merging state, so the card goes back to Needs you", () => {
    const notes = `${accepted}\n${notMerged}\nMILESTONE 2026-01-05T11:05Z — waiting for the user`;
    expect(acceptedRecord(notes)).toBeNull();
    expect(notMergedRecord(notes)?.at).toBe("2026-01-05T11:04Z");
    const column = boardColumn({ status: "Awaiting acceptance", ownerElsewhere: false, agent: { status: "idle", pendingPermissions: 0 }, lastStatus: "waiting", openBlockingDecisions: 0, stalledAfterNudge: false, crashedOut: false, accepted: acceptedRecord(notes) !== null });
    expect(column).toBe("needs-you");
  });

  it("is stale once the user accepts again or asks for changes, or the owner presents again", () => {
    const head = "a".repeat(40);
    expect(notMergedRecord(`${notMerged}\n${acceptedRecordText("2026-01-05T11:30Z", "into main")}`)).toBeNull();
    expect(notMergedRecord(`${notMerged}\nCHANGES-REQUESTED 2026-01-05T11:30Z — the user: "rename it"`)).toBeNull();
    expect(notMergedRecord(`${notMerged}\nEVIDENCE 2026-01-05T11:30Z — again\ncheck: npm test — 40 passed`)).toBeNull();
    expect(notMergedRecord(`${notMerged}\nEXECUTION 2026-01-05T11:30Z — review-head: ${head}`)).toBeNull();
  });

  it("does not read the record's name mentioned inside another record", () => {
    expect(notMergedRecord(`${accepted}\nMILESTONE 2026-01-05T11:05Z — no NOT-MERGED needed, merging`)).toBeNull();
    expect(acceptedRecord(`${accepted}\nMILESTONE 2026-01-05T11:05Z — no NOT-MERGED needed, merging`)).not.toBeNull();
  });
});

/** The ACCEPTED and ACCEPTANCE records of five tickets merged on GitHub before the merge field existed, verbatim but for the repository's owner. */
const MERGED_BEFORE_THE_FIELD: Record<string, string> = {
  "TR-107": [
    "ACCEPTED 2026-10-15T02:54:45.156Z — the user accepted; merging: the pull request",
    "ACCEPTANCE 2026-10-15T02:55Z — user: \"I accept TR-107. Merge https://github.com/example/taro/pull/1 now as roles/owner.md says, only if its headRefOid is still the recorded review head 2bf19219f87bb3c6546044b7131021870706ad2d\" — accepted revision 2bf19219f87bb3c6546044b7131021870706ad2d; PR https://github.com/example/taro/pull/1 squash-merged into main as f16d5ff5e13f41d36cc2bfe7c444ea1e276e1cfb (state MERGED)",
  ].join("\n\n"),
  "TR-109": [
    "ACCEPTED 2026-10-15T03:08:51.300Z — the user accepted; merging: the pull request",
    "ACCEPTANCE 2026-10-15T03:09Z — user's words: \"I accept TR-109.\" Accepted review head 9fcf158403fbf9649ff68a2554c1fe086236b509, PR https://github.com/example/taro/pull/4. Merge: squash with --match-head-commit, state MERGED, merge commit 63f99fcaf4dc6a106c87b660d95c4dcbfc0391a6 on origin/main (base 64bf24d unchanged since review).",
  ].join("\n\n"),
  "TR-111": [
    "ACCEPTED 2026-10-15T02:59:24.111Z — the user accepted; merging: the pull request",
    "ACCEPTANCE 2026-10-15T02:59Z — user: \"I accept TR-111. Merge https://github.com/example/taro/pull/2 now as roles/owner.md says, only if its headRefOid is still the recorded review head f19b8d3fa6e6f2abb8e3d978c60efdb57f231e20\"; accepted revision f19b8d3fa6e6f2abb8e3d978c60efdb57f231e20, PR https://github.com/example/taro/pull/2; head matched, squash-merged as 64bf24dfaabc95877c42c4e3f1dcfaadfac57f51, state MERGED",
  ].join("\n\n"),
  "TR-112": [
    "ACCEPTED 2026-10-15T03:18:25.908Z — the user accepted; merging: the pull request",
    "ACCEPTANCE 2026-10-15T03:18Z — user: \"I accept TR-112. Merge https://github.com/example/taro/pull/6 now as roles/owner.md says, only if its headRefOid is still the recorded review head 3553e2326850ab5bc69ce7ec7ee16c7aaac6609d\" — accepted revision 3553e2326850ab5bc69ce7ec7ee16c7aaac6609d; PR https://github.com/example/taro/pull/6 squash-merged with --match-head-commit, state MERGED, merge commit ab26974d08f3a4f37c40064390d8abc2639acb61",
  ].join("\n\n"),
  "TR-113": [
    "ACCEPTED 2026-10-15T03:14:07.720Z — the user accepted; merging: the pull request",
    "ACCEPTANCE 2026-10-15T03:14Z — user: \"I accept TR-113. Merge https://github.com/example/taro/pull/5 now as roles/owner.md says, only if its headRefOid is still the recorded review head c3fbfde113e798a992472c29458b043f45a57629 …\" Accepted revision c3fbfde113e798a992472c29458b043f45a57629, PR https://github.com/example/taro/pull/5; head matched; squash-merged with --match-head-commit; state MERGED, merge commit ce60b146af8c8ac073bcf67c181928f5bc752081.",
  ].join("\n\n"),
};

describe("pullRequestMerged", () => {
  const accepted = "ACCEPTED 2026-10-15T03:00:00.000Z — the user accepted; merging: the pull request";
  const url = "https://github.com/example/notes-app/pull/7";

  it("reads the merge field of the newest ACCEPTANCE record", () => {
    expect(pullRequestMerged(`ACCEPTANCE 2026-10-15T03:01Z — user: "I accept." PR ${url}; merge: merged 0a1b2c3`)).toBe(true);
    expect(pullRequestMerged(`ACCEPTANCE 2026-10-15T03:01Z — user: "I accept."\nmerge: Merged 0a1b2c3 (squash)`)).toBe(true);
    expect(pullRequestMerged(`${accepted}\n\nACCEPTANCE 2026-10-15T03:01Z — PR ${url}, state MERGED; merge: not merged — GitHub refused the squash`)).toBe(false);
    expect(pullRequestMerged(`ACCEPTANCE 2026-10-15T03:01Z — investigation, no code; merge: none`)).toBe(false);
  });

  it("lets a newer ACCEPTANCE record overrule an older one", () => {
    const first = `ACCEPTANCE 2026-10-15T03:01Z — merge: not merged — the head moved`;
    const second = `ACCEPTANCE 2026-10-15T04:01Z — merge: merged 0a1b2c3`;
    expect(pullRequestMerged(`${first}\n\n${second}`)).toBe(true);
    expect(pullRequestMerged(`${second}\n\n${first}`)).toBe(false);
  });

  it.each(Object.entries(MERGED_BEFORE_THE_FIELD))("reads %s, written before the field, as merged", (_id, notes) => {
    expect(pullRequestMerged(notes)).toBe(true);
  });

  it("reads prose as merged only after the plugin's ACCEPTED note for the pull request", () => {
    const prose = `ACCEPTANCE 2026-10-15T03:01Z — PR ${url} squash-merged, state MERGED`;
    expect(pullRequestMerged(prose)).toBe(false);
    expect(pullRequestMerged(`ACCEPTED 2026-10-15T03:00:00.000Z — the user accepted; merging: into main\n\n${prose}`)).toBe(false);
    expect(pullRequestMerged(`${prose}\n\n${accepted}`)).toBe(false);
    expect(pullRequestMerged(`${accepted}\n\nACCEPTANCE 2026-10-15T03:01Z — PR ${url}; merge commit 0a1b2c3`)).toBe(true);
  });

  it("does not read a local fast-forward, a missing PR or a refusal as a merged pull request", () => {
    expect(pullRequestMerged(`${accepted}\n\nACCEPTANCE 2026-10-14T10:23Z — Merge: main fast-forwarded bee2749..aac6288, clean.`)).toBe(false);
    expect(pullRequestMerged(`${accepted}\n\nACCEPTANCE 2026-10-15T03:01Z — state MERGED, merge commit 0a1b2c3`)).toBe(false);
    expect(pullRequestMerged(`${accepted}\n\nACCEPTANCE 2026-10-15T03:01Z — PR ${url} NOT MERGED: GitHub refused`)).toBe(false);
    expect(pullRequestMerged(`${accepted}\n\nACCEPTANCE 2026-10-15T03:01Z — PR ${url} closed without merging`)).toBe(false);
  });

  it("is false with no ACCEPTANCE record at all", () => {
    expect(pullRequestMerged(accepted)).toBe(false);
    expect(pullRequestMerged("")).toBe(false);
    expect(pullRequestMerged(null)).toBe(false);
  });
});

describe("NOT-SYNCED (TR-110)", () => {
  const accepted = acceptedRecordText("2026-01-05T11:00:00.000Z", "the pull request");
  const notSynced = "NOT-SYNCED 2026-01-05T11:04Z — merged https://github.com/o/r/pull/9; main has 2 commits origin lacks: push or drop them, then Accept again";

  it("reads as a merged pull request whose local base branch is behind, with the reason", () => {
    expect(notMergedRecord(`${accepted}\n${notSynced}`)).toEqual({
      at: "2026-01-05T11:04Z",
      reason: "merged https://github.com/o/r/pull/9; main has 2 commits origin lacks: push or drop them, then Accept again",
      merged: true,
    });
    expect(notMergedRecord("NOT-SYNCED 2026-01-05T11:04Z")).toEqual({ at: "2026-01-05T11:04Z", reason: "the owner gave no reason", merged: true });
  });

  it("clears the merging state, and is stale once the user accepts again", () => {
    expect(acceptedRecord(`${accepted}\n${notSynced}`)).toBeNull();
    expect(notMergedRecord(`${notSynced}\n${acceptedRecordText("2026-01-05T11:30Z", "the pull request")}`)).toBeNull();
  });
});
