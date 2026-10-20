import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { branchName, commitsPast } from "./branch-commits";

const scratch = mkdtempSync(join(tmpdir(), "taro-branch-commits-"));
// An empty file of our own, not /dev/null: a host whose /dev/null went bad fails every git call.
const emptyConfig = join(scratch, "gitconfig");
writeFileSync(emptyConfig, "");
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.email=alex@example.com", "-c", "user.name=Alex", ...args], { encoding: "utf8" });
const commit = (cwd: string, message: string) => git(cwd, "commit", "-q", "--allow-empty", "-m", message);

/** A repository with an origin: the owner's worktree branched from origin's main, as the manager makes it. */
function cloneWithOrigin(): { origin: string; clone: string } {
  const origin = mkdtempSync(join(scratch, "origin-"));
  git(origin, "init", "-q", "-b", "main");
  commit(origin, "init");
  const clone = mkdtempSync(join(scratch, "notes-app-"));
  execFileSync("git", ["clone", "-q", origin, clone]);
  return { origin, clone };
}

describe("commitsPast", () => {
  it("counts only the owner's commits when the local base fell behind origin's", async () => {
    const { origin, clone } = cloneWithOrigin();
    // Merged on GitHub without Accept: origin moves on, the local main stays where it was.
    commit(origin, "merged elsewhere 1");
    commit(origin, "merged elsewhere 2");
    git(clone, "fetch", "-q", "origin");
    git(clone, "checkout", "-q", "-b", "taro/tr-1", "origin/main");
    expect(await commitsPast(clone, "main")).toBe(0);
    commit(clone, "owner's work");
    expect(await commitsPast(clone, "main")).toBe(1);
    expect(await branchName(clone)).toBe("taro/tr-1");
  });

  it("counts against the local base in a repository with no remote", async () => {
    const repo = mkdtempSync(join(scratch, "local-"));
    git(repo, "init", "-q", "-b", "main");
    commit(repo, "init");
    git(repo, "checkout", "-q", "-b", "taro/tr-2");
    commit(repo, "one");
    commit(repo, "two");
    expect(await commitsPast(repo, "main")).toBe(2);
  });

  it("is 0 when the base branch is nowhere, or the folder is not a repository", async () => {
    const { clone } = cloneWithOrigin();
    commit(clone, "work");
    expect(await commitsPast(clone, "trunk")).toBe(0);
    const plain = mkdtempSync(join(scratch, "plain-"));
    expect(await commitsPast(plain, "main")).toBe(0);
    expect(await branchName(plain)).toBe("its branch");
  });
});
