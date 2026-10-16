// TR-141: Accept's merge run by the plugin, against real git repositories; gh is answered by the test,
// and its merge is played by pushing a merge commit to the local origin.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acceptLocalBranch, acceptPullRequest, type Run } from "./accept-merge";
import { runChecked, runCommand, type CommandResult } from "./process";

let root: string;
let repo: string;
let origin: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await runChecked("git", ["-C", cwd, ...args])).trim();
}

async function commit(cwd: string, file: string, text: string): Promise<string> {
  await writeFile(join(cwd, file), text);
  await git(cwd, "add", file);
  await git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", `change ${file}`);
  return git(cwd, "rev-parse", "HEAD");
}

const at = () => "2026-01-02T00:00:00.000Z";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "taro-accept-"));
  repo = join(root, "notes-app");
  origin = join(root, "origin.git");
  await runChecked("git", ["init", "-q", "-b", "main", repo]);
  await commit(repo, "readme.md", "notes\n");
  await runChecked("git", ["init", "-q", "--bare", "-b", "main", origin]);
  await git(repo, "remote", "add", "origin", origin);
  await git(repo, "push", "-q", "origin", "main");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("local branch", () => {
  async function branchWithWork(): Promise<string> {
    await git(repo, "branch", "taro/nt-1");
    const worktree = join(root, "worktree");
    await git(repo, "worktree", "add", "-q", worktree, "taro/nt-1");
    return commit(worktree, "feature.md", "feature\n");
  }

  function input(head: string) {
    return { run: runCommand, ticket: "NT-1", at, baseBranch: "main", repoPath: repo, branches: ["taro/nt-1"], head };
  }

  it("fast-forwards main to the reviewed head", async () => {
    const before = await git(repo, "rev-parse", "HEAD");
    const head = await branchWithWork();
    const outcome = await acceptLocalBranch(input(head));
    expect(await git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(outcome).toEqual({
      kind: "done",
      acceptance: `ACCEPTANCE ${at()} — user: "I accept NT-1." Accepted ${head}; fast-forwarded main; accepted and closed by the plugin; merge: merged ${before.slice(0, 12)} → ${head.slice(0, 12)}`,
    });
  });

  it("is done when main already holds the head (a reload cut off the record)", async () => {
    const head = await branchWithWork();
    await acceptLocalBranch(input(head));
    const again = await acceptLocalBranch(input(head));
    expect(again.kind).toBe("done");
    expect(again.kind === "done" && again.acceptance).toContain("main already contains it");
  });

  it("records NOT-MERGED for a dirty main checkout, untracked files included, and touches nothing", async () => {
    const before = await git(repo, "rev-parse", "HEAD");
    const head = await branchWithWork();
    await writeFile(join(repo, "scratch.txt"), "x");
    const outcome = await acceptLocalBranch(input(head));
    expect(outcome).toEqual({ kind: "not-merged", reason: `the main checkout (${repo}) has uncommitted or untracked changes (scratch.txt); commit or discard them, then Accept again` });
    expect(await git(repo, "rev-parse", "HEAD")).toBe(before);
  });

  it("records NOT-MERGED when the main checkout is on another branch", async () => {
    const head = await branchWithWork();
    await git(repo, "checkout", "-q", "-b", "experiment");
    const outcome = await acceptLocalBranch(input(head));
    expect(outcome.kind).toBe("not-merged");
    expect(outcome.kind === "not-merged" && outcome.reason).toContain("is on experiment, not main; switch it to main");
  });

  it("hands over a branch that moved past the review head", async () => {
    const reviewed = await branchWithWork();
    const moved = await commit(join(root, "worktree"), "more.md", "more\n");
    const outcome = await acceptLocalBranch(input(reviewed));
    expect(outcome).toEqual({ kind: "surprise", found: `taro/nt-1 moved to ${moved} since the review head ${reviewed}; present it again` });
  });

  it("hands over a main that moved since the branch: rebasing needs the checks", async () => {
    const head = await branchWithWork();
    const moved = await commit(repo, "other.md", "other\n");
    const outcome = await acceptLocalBranch(input(head));
    expect(outcome.kind).toBe("surprise");
    expect(outcome.kind === "surprise" && outcome.found).toBe(`main moved to ${moved} since taro/nt-1; rebase onto it, and fast-forward only if it applied with no conflicts and the checks pass`);
    expect(await git(repo, "rev-parse", "HEAD")).toBe(moved);
  });

  it("hands over a missing branch, naming every name it tried", async () => {
    const outcome = await acceptLocalBranch({ ...input("a".repeat(40)), branches: ["feature/notes", "taro/nt-1"] });
    expect(outcome).toEqual({ kind: "surprise", found: `${repo} has no branch feature/notes or taro/nt-1` });
  });

  it("falls back to the next name when the recorded branch does not exist", async () => {
    const head = await branchWithWork();
    const outcome = await acceptLocalBranch({ ...input(head), branches: ["feature/misread", "taro/nt-1"] });
    expect(outcome.kind).toBe("done");
    expect(await git(repo, "rev-parse", "HEAD")).toBe(head);
  });
});

describe("pull request", () => {
  const url = "https://example.test/o/notes-app/pull/7";
  let state: string;
  let prHead: string;
  let mergeCommit: string | null;
  let allowed: Record<string, boolean> | null;
  let mergeFails: string | null;
  let calls: string[][];

  /** Plays GitHub: the PR's view, the repository's allowed methods, and a merge that lands on origin. */
  const run: Run = async (command, args, options) => {
    if (command !== "gh") return runCommand(command, args, options);
    calls.push([...args]);
    const reply = (stdout: string, code = 0, stderr = ""): CommandResult => ({ code, stdout, stderr });
    if (args[0] === "pr" && args[1] === "view") return reply(JSON.stringify({ state, headRefOid: prHead, mergeCommit: mergeCommit === null ? null : { oid: mergeCommit } }));
    if (args[0] === "repo") return allowed === null ? reply("", 1, "not logged in") : reply(JSON.stringify(allowed));
    if (args[0] === "pr" && args[1] === "merge") {
      if (mergeFails !== null) return reply("", 1, mergeFails);
      const clone = join(root, "github");
      await runChecked("git", ["clone", "-q", origin, clone]);
      mergeCommit = await commit(clone, "merged.md", "merged\n");
      await git(clone, "push", "-q", "origin", "main");
      state = "MERGED";
      return reply("");
    }
    return reply("", 1, "unexpected");
  };

  function input(head: string, method: "merge" | "squash" | "rebase" = "squash") {
    return { run, ticket: "NT-1", at, baseBranch: "main", repoPath: repo, url, head, method };
  }

  beforeEach(() => {
    state = "OPEN";
    prHead = "c".repeat(40);
    mergeCommit = null;
    allowed = { mergeCommitAllowed: true, rebaseMergeAllowed: true, squashMergeAllowed: true };
    mergeFails = null;
    calls = [];
  });

  it("merges with the method and the head, then fast-forwards main from origin", async () => {
    const before = await git(repo, "rev-parse", "HEAD");
    const outcome = await acceptPullRequest(input(prHead));
    expect(calls).toContainEqual(["pr", "merge", url, "--squash", "--match-head-commit", prHead]);
    const after = await git(repo, "rev-parse", "HEAD");
    expect(after).toBe(mergeCommit);
    expect(outcome).toEqual({
      kind: "done",
      acceptance: `ACCEPTANCE ${at()} — user: "I accept NT-1." Accepted ${prHead}, PR ${url}; merged ${url} with Squash; local main ${before.slice(0, 12)} → ${after.slice(0, 12)}; accepted and closed by the plugin; merge: merged ${mergeCommit}`,
    });
  });

  it("only syncs main for a pull request already merged", async () => {
    state = "MERGED";
    mergeCommit = "d".repeat(40);
    const outcome = await acceptPullRequest(input(prHead));
    expect(calls.some((call) => call[1] === "merge")).toBe(false);
    expect(outcome.kind === "done" && outcome.acceptance).toContain(`${url} was already merged; local main already at`);
  });

  it("hands over a head that moved, without merging", async () => {
    const outcome = await acceptPullRequest(input("e".repeat(40)));
    expect(outcome).toEqual({ kind: "surprise", found: `the pull request's head moved to ${prHead} since the review head ${"e".repeat(40)}; present it again` });
    expect(calls.some((call) => call[1] === "merge")).toBe(false);
  });

  it("hands over a closed pull request", async () => {
    state = "CLOSED";
    expect(await acceptPullRequest(input(prHead))).toEqual({ kind: "surprise", found: `the pull request ${url} is closed, not open` });
  });

  it("records NOT-MERGED for a method GitHub does not allow, and tries no other", async () => {
    allowed = { mergeCommitAllowed: true, rebaseMergeAllowed: true, squashMergeAllowed: false };
    const outcome = await acceptPullRequest(input(prHead));
    expect(outcome).toEqual({ kind: "not-merged", reason: "GitHub does not allow the Squash method in this repository; pick another Merge method in the project's settings, or allow it on GitHub, then Accept again" });
    expect(calls.some((call) => call[1] === "merge")).toBe(false);
  });

  it("still merges when gh cannot say which methods are allowed", async () => {
    allowed = null;
    expect((await acceptPullRequest(input(prHead, "merge"))).kind).toBe("done");
    expect(calls).toContainEqual(["pr", "merge", url, "--merge", "--match-head-commit", prHead]);
  });

  it("hands over a merge GitHub refuses (a conflict) with gh's reason", async () => {
    mergeFails = "Pull request is not mergeable: the merge commit cannot be cleanly created.";
    expect(await acceptPullRequest(input(prHead))).toEqual({ kind: "surprise", found: `gh pr merge ${url} --squash failed: ${mergeFails}` });
  });

  it("hands over when gh cannot read the pull request", async () => {
    const failing: Run = async (command, args, options) => (command === "gh" ? { code: 1, stdout: "", stderr: "gh: not logged in" } : runCommand(command, args, options));
    expect(await acceptPullRequest({ ...input(prHead), run: failing })).toEqual({ kind: "surprise", found: `gh pr view ${url} failed: gh: not logged in` });
  });

  it("records NOT-SYNCED after merging when main has commits origin lacks, then only syncs on the next Accept", async () => {
    await commit(repo, "local.md", "local\n");
    const outcome = await acceptPullRequest(input(prHead));
    expect(outcome).toEqual({ kind: "not-synced", reason: `main in ${repo} has commits origin lacks; push or drop them, then Accept again` });
    expect(state).toBe("MERGED");
    await git(repo, "reset", "-q", "--hard", "HEAD~1");
    calls = [];
    const again = await acceptPullRequest(input(prHead));
    expect(again.kind).toBe("done");
    expect(calls.some((call) => call[1] === "merge")).toBe(false);
  });

  it("records NOT-SYNCED for a dirty main checkout after merging, and leaves it alone", async () => {
    await writeFile(join(repo, "readme.md"), "edited\n");
    const outcome = await acceptPullRequest(input(prHead));
    expect(outcome.kind).toBe("not-synced");
    expect(outcome.kind === "not-synced" && outcome.reason).toContain("has uncommitted or untracked changes (readme.md)");
    expect(await git(repo, "status", "--porcelain")).toBe("M readme.md");
  });

  it("records NOT-SYNCED when the fetch fails", async () => {
    await git(repo, "remote", "set-url", "origin", join(root, "missing.git"));
    const outcome = await acceptPullRequest(input(prHead));
    expect(outcome.kind).toBe("not-synced");
    expect(outcome.kind === "not-synced" && outcome.reason).toMatch(/^fetching origin main into .* failed \(.+\); fix the connection or the remote, then Accept again$/);
  });
});
