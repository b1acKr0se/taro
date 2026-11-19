import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkCommand, checkLogPath } from "./owner-commands.ts";

let root = "";
let repository = "";
let data = "";

function git(...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repository, stdio: "ignore" });
}

async function run(command: string, again = false): Promise<{ code: number; stderr: string; ran: boolean }> {
  const marker = join(root, "ran");
  rmSync(marker, { force: true });
  let stderr = "";
  const code = await checkCommand([`${command}; r=$?; touch ${marker}; exit $r`], { ticket: undefined, timeoutMinutes: 1, again }, {
    stdout: () => undefined,
    stderr: (text) => { stderr += text; },
    env: { TARO_PROJECT: "notes-app", TARO_EVIDENCE: join(data, "evidence", "TR-1") },
    cwd: repository,
  });
  return { code, stderr, ran: (() => { try { readFileSync(marker); return true; } catch { return false; } })() };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "check-command."));
  repository = join(root, "repo");
  data = join(root, "data");
  mkdirSync(repository);
  git("init", "-q", "-b", "taro/tr-1");
  writeFileSync(join(repository, "a.txt"), "a\n");
  git("add", ".");
  git("commit", "-q", "-m", "first");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("taro check reuse", () => {
  it("runs a check once at a clean commit and answers the repeat from the log", async () => {
    expect((await run("true")).ran).toBe(true);
    const again = await run("true");
    expect(again.ran).toBe(false);
    expect(again.code).toBe(0);
    expect(again.stderr).toContain("not rerun");
    expect(readFileSync(checkLogPath(data, "notes-app", "TR-1"), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("runs again with --again, after a new commit, and beside uncommitted changes", async () => {
    await run("true");
    expect((await run("true", true)).ran).toBe(true);
    writeFileSync(join(repository, "b.txt"), "b\n");
    const untracked = await run("true");
    expect(untracked.ran).toBe(true);
    expect(untracked.stderr).toContain("b.txt");
    git("add", ".");
    git("commit", "-q", "-m", "second");
    expect((await run("true")).ran).toBe(true);
  });

  it("never answers from a run made beside an untracked file, nor from another directory", async () => {
    writeFileSync(join(repository, "extra.txt"), "x\n");
    expect((await run("true")).ran).toBe(true);
    rmSync(join(repository, "extra.txt"));
    expect((await run("true")).ran).toBe(true);
    expect((await run("true")).ran).toBe(false);
    mkdirSync(join(repository, "web"));
    writeFileSync(join(repository, "web", "w.txt"), "w\n");
    git("add", ".");
    git("commit", "-q", "-m", "web");
    expect((await run("true")).ran).toBe(true);
    const original = repository;
    repository = join(original, "web");
    expect((await run("true")).ran).toBe(true);
    repository = original;
  });

  it("warns about a changed tracked file before running and never reuses a failure", async () => {
    writeFileSync(join(repository, "a.txt"), "changed\n");
    const dirty = await run("true");
    expect(dirty.stderr).toContain("warning");
    expect(dirty.stderr).toContain("a.txt");
    git("checkout", "--", "a.txt");
    expect((await run("false")).code).toBe(1);
    expect((await run("false")).ran).toBe(true);
  });
});
