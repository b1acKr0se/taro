import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanup, makePluginCopy, makeThrowaway } from "./daemon.ts";
import { SCRATCH_PREFIX } from "./safety.ts";

const made: string[] = [];
afterEach(() => {
  made.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

function checkout(): { path: string; sha: string } {
  const path = mkdtempSync(join(tmpdir(), `${SCRATCH_PREFIX}source.`));
  made.push(path);
  mkdirSync(join(path, "bench", "tasks"), { recursive: true });
  mkdirSync(join(path, "skill"), { recursive: true });
  writeFileSync(join(path, "bench", "tasks", "hidden.test.js"), "secret\n");
  writeFileSync(join(path, "skill", "SKILL.md"), "skill\n");
  const git = (...args: string[]): string => execFileSync("git", ["-C", path, "-c", "user.name=T", "-c", "user.email=t@example.invalid", ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Seed");
  return { path, sha: git("rev-parse", "HEAD").trim() };
}

describe("makePluginCopy", () => {
  it("copies the commit without bench/ and without .git, so the owner cannot git show the hidden tests", async () => {
    const source = checkout();
    const throwaway = makeThrowaway(source.path);
    try {
      await makePluginCopy(throwaway, source.sha);
      expect(existsSync(join(throwaway.pluginCopy, "skill", "SKILL.md"))).toBe(true);
      expect(existsSync(join(throwaway.pluginCopy, "bench"))).toBe(false);
      expect(existsSync(join(throwaway.pluginCopy, ".git"))).toBe(false);
    } finally {
      await cleanup(throwaway);
    }
  });
});
