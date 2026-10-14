// The stub gh against a real bare origin: what the TR-013 end-to-end run relies on.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const stub = fileURLToPath(new URL("./gh.mjs", import.meta.url));
let root = "";
let clone = "";
let origin = "";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gh(...args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [stub, ...args], { cwd: clone, encoding: "utf8", env: { ...process.env, GH_STUB_STATE: join(root, "state") } });
  return { code: result.status ?? -1, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function commit(file: string, text: string): string {
  writeFileSync(join(clone, file), text);
  git(clone, "add", file);
  git(clone, "commit", "-qm", `edit ${file}`);
  return git(clone, "rev-parse", "HEAD");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gh-stub-test-"));
  origin = join(root, "origin.git");
  clone = join(root, "clone");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, clone]);
  git(clone, "config", "user.name", "t");
  git(clone, "config", "user.email", "t@example.invalid");
  git(clone, "checkout", "-qb", "main");
  commit("a.txt", "one\n");
  git(clone, "push", "-q", "origin", "main");
  git(clone, "checkout", "-qb", "taro/sc-001");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

// Each test runs several git commands and the stub: about 1 s in a full run, past vitest's 5 s default under heavy load.
const GIT_TIMEOUT_MS = 30_000;

describe("stub gh", { timeout: GIT_TIMEOUT_MS }, () => {
  it("runs a PR from draft to a merge that matches the head", () => {
    expect(gh("pr", "create", "--draft", "--title", "Add b").code).toBe(1); // not pushed yet
    const head = commit("b.txt", "two\n");
    git(clone, "push", "-q", "origin", "taro/sc-001");
    const created = gh("pr", "create", "--draft", "--title", "Add b", "--body", "why", "--base", "main");
    expect(created).toMatchObject({ code: 0, stdout: "https://github.com/stub-owner/origin/pull/1" });
    const url = created.stdout;

    expect(JSON.parse(gh("pr", "view", url, "--json", "headRefOid,state,isDraft,mergeStateStatus").stdout)).toEqual({ headRefOid: head, state: "OPEN", isDraft: true, mergeStateStatus: "DRAFT" });
    expect(gh("pr", "merge", url, "--squash", "--match-head-commit", head).stderr).toContain("still a draft");
    expect(gh("pr", "comment", url, "--body", "No findings").code).toBe(0);
    expect(gh("pr", "ready", url).code).toBe(0);
    expect(gh("pr", "view", url, "--json", "mergeStateStatus", "--jq", ".mergeStateStatus").stdout).toBe("CLEAN");

    expect(gh("pr", "merge", url, "--squash", "--match-head-commit", head).code).toBe(0);
    expect(gh("pr", "view", "1", "--json", "state", "--jq", ".state").stdout).toBe("MERGED");
    expect(git(origin, "show", "main:b.txt")).toBe("two");
    expect(gh("pr", "merge", url, "--squash").stderr).toContain("merged and cannot be merged");

    const calls = readFileSync(join(root, "state", "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; exitCode: number });
    expect(calls.map((call) => `${call.args.slice(0, 2).join(" ")} ${call.exitCode}`)).toEqual([
      "pr create 1", "pr create 0", "pr view 0", "pr merge 1", "pr comment 0", "pr ready 0", "pr view 0", "pr merge 0", "pr view 0", "pr merge 1",
    ]);
  });

  it("refuses to merge when the head moved, or with a short sha", () => {
    const reviewed = commit("b.txt", "two\n");
    git(clone, "push", "-q", "origin", "taro/sc-001");
    gh("pr", "create", "--title", "Add b");
    const moved = commit("b.txt", "three\n");
    git(clone, "push", "-q", "origin", "taro/sc-001");

    expect(gh("pr", "view", "--json", "headRefOid", "--jq", ".headRefOid").stdout).toBe(moved);
    const refused = gh("pr", "merge", "1", "--squash", "--match-head-commit", reviewed);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("Head branch was modified");
    expect(gh("pr", "merge", "1", "--squash", "--match-head-commit", moved.slice(0, 12)).code).toBe(1);
    expect(gh("pr", "view", "1", "--json", "state", "--jq", ".state").stdout).toBe("OPEN");
    expect(() => git(origin, "show", "main:b.txt")).toThrow();
  });

  it("reports a conflicting PR as DIRTY and refuses to merge it", () => {
    commit("a.txt", "branch\n");
    git(clone, "push", "-q", "origin", "taro/sc-001");
    gh("pr", "create", "--title", "Change a");
    git(clone, "checkout", "-q", "main");
    commit("a.txt", "main\n");
    git(clone, "push", "-q", "origin", "main");
    expect(gh("pr", "view", "1", "--json", "mergeStateStatus", "--jq", ".mergeStateStatus").stdout).toBe("DIRTY");
    expect(gh("pr", "merge", "1", "--squash").stderr).toContain("not mergeable");
  });

  it("fails loudly on what it does not fake", () => {
    expect(gh("auth", "status").code).toBe(0);
    expect(gh("repo", "create", "x").code).toBe(1);
    expect(gh("api", "repos/o/r").stderr).toContain("does not support");
  });
});
