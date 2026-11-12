import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanup, installWithRetry, makePluginCopy, makeThrowaway, waitForDaemonReady } from "./daemon.ts";
import type { RunResult } from "./process.ts";
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

const outcome = (overrides: Partial<RunResult>): RunResult => ({ code: 0, stdout: "", stderr: "", timedOut: false, ...overrides });
const status = (localDaemon: string): RunResult => outcome({ stdout: JSON.stringify({ localDaemon }) });
const noWait = async (): Promise<void> => {};

describe("waitForDaemonReady", () => {
  it("returns once the status says running, after two not-ready polls", async () => {
    const answers = [status("not_ready"), status("not_ready"), status("running")];
    let polls = 0;
    await waitForDaemonReady(async () => answers[polls++]!, noWait);
    expect(polls).toBe(3);
  });

  it("fails with the last status text when it is never ready", async () => {
    await expect(waitForDaemonReady(async () => status("not_ready"), noWait, 5)).rejects.toThrow(/not_ready/);
  });
});

describe("installWithRetry", () => {
  const notReady = outcome({ code: 1, stderr: "Daemon PID 7 remains running but is not ready for /x" });

  it("retries a not-ready failure and succeeds", async () => {
    const answers = [notReady, outcome({})];
    let calls = 0;
    await installWithRetry(async () => answers[calls++]!, noWait);
    expect(calls).toBe(2);
  });

  it("fails at once on another error, without a retry", async () => {
    let calls = 0;
    await expect(installWithRetry(async () => (calls++, outcome({ code: 1, stderr: "bad manifest" })), noWait)).rejects.toThrow(/bad manifest/);
    expect(calls).toBe(1);
  });

  it("fails at once on a timeout", async () => {
    let calls = 0;
    await expect(installWithRetry(async () => (calls++, outcome({ code: null, timedOut: true })), noWait)).rejects.toThrow(/did not return/);
    expect(calls).toBe(1);
  });

  it("gives up after three tries that are all not ready", async () => {
    let calls = 0;
    await expect(installWithRetry(async () => (calls++, notReady), noWait)).rejects.toThrow(/not ready/);
    expect(calls).toBe(3);
  });
});
