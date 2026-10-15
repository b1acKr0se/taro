import { describe, expect, it } from "vitest";

import { mergeFlag, mergeMethodDescription, mergeMethodHint, mergeMethodNote, parseAllowedMergeMethods } from "./merge-method";
import { ProjectSettingsSchema } from "./project";

describe("merge method (TR-110)", () => {
  it("defaults to Merge commit for a project saved before the setting", () => {
    const settings = ProjectSettingsSchema.parse({ repoPath: "/home/user/notes-app", baseBranch: "main", ticketPrefix: "NA", manager: { model: "m" }, owner: { model: "m" } });
    expect(settings.mergeMethod).toBe("merge");
    expect(() => ProjectSettingsSchema.parse({ ...settings, mergeMethod: "fast-forward" })).toThrow();
  });

  it("maps each method to its gh pr merge flag", () => {
    expect([mergeFlag("merge"), mergeFlag("rebase"), mergeFlag("squash")]).toEqual(["--merge", "--rebase", "--squash"]);
  });

  it("reads which methods gh repo view says the repository allows", () => {
    expect(parseAllowedMergeMethods('{"mergeCommitAllowed":true,"rebaseMergeAllowed":false,"squashMergeAllowed":true}')).toEqual({ merge: true, rebase: false, squash: true });
    expect(parseAllowedMergeMethods('{"mergeCommitAllowed":false,"rebaseMergeAllowed":false,"squashMergeAllowed":false}')).toEqual({ merge: false, rebase: false, squash: false });
  });

  it("knows nothing from output that does not say", () => {
    expect(parseAllowedMergeMethods("")).toBeNull();
    expect(parseAllowedMergeMethods("GraphQL: Could not resolve to a Repository")).toBeNull();
    expect(parseAllowedMergeMethods("null")).toBeNull();
    expect(parseAllowedMergeMethods('{"mergeCommitAllowed":true,"rebaseMergeAllowed":true}')).toBeNull();
    expect(parseAllowedMergeMethods('{"mergeCommitAllowed":"yes","rebaseMergeAllowed":true,"squashMergeAllowed":true}')).toBeNull();
  });

  it("notes only a method GitHub disallows, warning more when it is the one chosen", () => {
    const allowed = { merge: true, rebase: false, squash: true };
    expect(mergeMethodNote("merge", allowed, true)).toBeNull();
    expect(mergeMethodNote("rebase", null, true)).toBeNull();
    expect(mergeMethodNote("rebase", allowed, false)).toBe("GitHub does not allow this method for the repository.");
    expect(mergeMethodNote("rebase", allowed, true)).toMatch(/^GitHub does not allow this method for the repository: Accept will not merge/);
  });

  it("says plainly whose email a new commit carries, and how the local base branch follows", () => {
    const hint = mergeMethodHint("develop");
    expect(hint).toContain("Merge commit and Squash make a new commit with your GitHub account's commit email");
    expect(hint).toContain('"Keep my email addresses private"');
    expect(hint).toContain("Rebase keeps each commit's author");
    expect(hint).toContain("fast-forwards your local develop to GitHub's");
    expect(mergeMethodDescription("squash", "develop")).toContain("one new commit on develop");
  });
});
