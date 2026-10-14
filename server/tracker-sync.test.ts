/**
 * Ticket sync against a real remote: a scratch bare repository and two clones
 * of `taro/tickets` standing in for two machines (never the live tracker).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrackerSyncProblem } from "../shared/contracts";
import { conflictProblem, gitComplaint, syncTracker, TRACKER_BRANCH, type SyncStrategy } from "./tracker";
import { TrackerWatch } from "./tracker-watch";

const TICKET = "tickets/X-001.md";
const OTHER_TICKET = "tickets/X-002.md";
const LINES = ["title", "status: Planning", "a", "b", "c", "d", "notes end"];

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, "-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Writes a file and commits it the way the plugin would. */
function commit(clone: string, file: string, text: string): void {
  writeFileSync(join(clone, file), text);
  git(clone, "add", "-A", "tickets");
  git(clone, "commit", "-q", "-m", `edit ${file}`);
}

function withLine(index: number, value: string, lines: readonly string[] = LINES): string[] {
  return lines.map((line, at) => (at === index ? value : line));
}

let root = "";
let remote = "";
let here = "";
let there = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "taro-sync-"));
  remote = join(root, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  there = join(root, "there");
  execFileSync("git", ["clone", "-q", remote, there], { stdio: "ignore" });
  git(there, "checkout", "-q", "-b", TRACKER_BRANCH);
  mkdirSync(join(there, "tickets"), { recursive: true });
  writeFileSync(join(there, OTHER_TICKET), "second\n");
  commit(there, TICKET, `${LINES.join("\n")}\n`);
  git(there, "push", "-q", "-u", "origin", TRACKER_BRANCH);
  here = join(root, "here");
  execFileSync("git", ["clone", "-q", "-b", TRACKER_BRANCH, remote, here], { stdio: "ignore" });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function remoteFile(file: string): string {
  return git(remote, "show", `${TRACKER_BRANCH}:${file}`);
}

/** Both machines change line 1; the remote also changes line 5, this machine also changes the other ticket. */
function diverge(): void {
  commit(there, TICKET, `${withLine(5, "d there", withLine(1, "status: Done")).join("\n")}\n`);
  git(there, "push", "-q", "origin", TRACKER_BRANCH);
  commit(here, TICKET, `${withLine(1, "status: In Progress").join("\n")}\n`);
  commit(here, OTHER_TICKET, "second, edited here\n");
}

// Each sync runs a series of git fetches, merges and pushes: about 1 s in a full run, past vitest's 5 s default under heavy load.
const SYNC_TIMEOUT_MS = 30_000;

describe("syncTracker", { timeout: SYNC_TIMEOUT_MS }, () => {
  it("merges edits to different tickets and pushes", async () => {
    commit(there, TICKET, `${withLine(1, "status: Done").join("\n")}\n`);
    git(there, "push", "-q", "origin", TRACKER_BRANCH);
    commit(here, OTHER_TICKET, "second, edited here\n");

    expect(await syncTracker(here)).toBeNull();
    expect(remoteFile(TICKET)).toContain("status: Done");
    expect(remoteFile(OTHER_TICKET)).toBe("second, edited here\n");
  });

  it("reports a same-ticket conflict by ticket id and leaves the tracker on its branch with nothing lost", async () => {
    diverge();
    const before = git(here, "rev-parse", "HEAD");

    expect(await syncTracker(here)).toEqual({ kind: "conflict", message: "X-001 changed both here and on the remote.", tickets: ["X-001"] });
    expect(git(here, "symbolic-ref", "--short", "HEAD").trim()).toBe(TRACKER_BRANCH);
    expect(existsSync(join(here, git(here, "rev-parse", "--git-path", "rebase-merge").trim()))).toBe(false);
    expect(git(here, "rev-parse", "HEAD")).toBe(before);
    expect(git(here, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(here, TICKET), "utf8")).toContain("status: In Progress");
    expect(remoteFile(TICKET)).toContain("status: Done");
  });

  it("treats a ticket written after the last commit like a committed one, never leaving conflict markers", async () => {
    commit(there, TICKET, `${withLine(1, "status: Done").join("\n")}\n`);
    git(there, "push", "-q", "origin", TRACKER_BRANCH);
    writeFileSync(join(here, TICKET), `${withLine(1, "status: Blocked").join("\n")}\n`);

    expect(await syncTracker(here)).toEqual({ kind: "conflict", message: "X-001 changed both here and on the remote.", tickets: ["X-001"] });
    expect(readFileSync(join(here, TICKET), "utf8")).toContain("status: Blocked");
    expect(readFileSync(join(here, TICKET), "utf8")).not.toContain("<<<<<<<");
    expect(git(here, "status", "--porcelain")).toBe("");
    expect(git(here, "stash", "list")).toBe("");

    expect(await syncTracker(here, "keep-local")).toBeNull();
    expect(remoteFile(TICKET)).toContain("status: Blocked");
  });

  it.each<[SyncStrategy, string]>([
    ["keep-local", "status: In Progress"],
    ["keep-remote", "status: Done"],
  ])("%s settles the conflicting lines and keeps every other edit from both sides", async (strategy, status) => {
    diverge();
    expect(await syncTracker(here)).not.toBeNull();

    expect(await syncTracker(here, strategy)).toBeNull();
    const merged = remoteFile(TICKET);
    expect(merged).toContain(status);
    expect(merged).toContain("d there");
    expect(merged).not.toContain("<<<<<<<");
    expect(remoteFile(OTHER_TICKET)).toBe("second, edited here\n");
    expect(git(here, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", TRACKER_BRANCH));
  });

  it("names git's fatal line when the remote cannot be reached", async () => {
    commit(here, OTHER_TICKET, "second, edited here\n");
    git(here, "remote", "set-url", "origin", join(root, "missing.git"));

    const problem = await syncTracker(here);
    expect(problem?.kind).toBe("failed");
    expect(problem?.tickets).toEqual([]);
    expect(problem?.message).toMatch(/^Pulling from origin failed: fatal: /);
  });

  it("reports a rejected push", async () => {
    commit(here, OTHER_TICKET, "second, edited here\n");
    execFileSync("sh", ["-c", `printf '#!/bin/sh\\nexit 1\\n' > hooks/pre-receive && chmod +x hooks/pre-receive`], { cwd: remote });

    const problem = await syncTracker(here);
    expect(problem?.kind).toBe("failed");
    expect(problem?.message).toMatch(/^Pushing to origin failed: error: /);
  });
});

describe("conflictProblem", () => {
  it("names tickets by id, other files by path, and shortens a long list", () => {
    expect(conflictProblem(["tracker.json"])).toEqual({ kind: "conflict", message: "tracker.json changed both here and on the remote.", tickets: [] });
    const many = conflictProblem(["tickets/X-004.md", "tickets/X-001.md", "tickets/X-003.md", "tickets/X-002.md"]);
    expect(many.tickets).toEqual(["X-001", "X-002", "X-003", "X-004"]);
    expect(many.message).toBe("X-001, X-002, X-003 and 1 more changed both here and on the remote.");
  });
});

describe("gitComplaint", () => {
  it("prefers git's fatal or error line over progress output", () => {
    expect(gitComplaint({ code: 1, stdout: "", stderr: "From /x/remote\n * branch taro/tickets -> FETCH_HEAD\nerror: could not apply 1a2b3c\n" })).toBe("error: could not apply 1a2b3c");
    expect(gitComplaint({ code: 128, stdout: "", stderr: "From somewhere\n" })).toBe("From somewhere");
    expect(gitComplaint({ code: 2, stdout: "", stderr: "" })).toBe("exit 2");
  });
});

describe("TrackerWatch sync triggers", () => {
  const conflict: TrackerSyncProblem = { kind: "conflict", message: "X-001 changed both here and on the remote.", tickets: ["X-001"] };
  const previousHome = process.env.PASEO_HOME;
  let calls: (SyncStrategy | undefined)[] = [];
  let answer: TrackerSyncProblem | null = conflict;
  let watch = new TrackerWatch();

  function writeConfig(trackerSync: "local" | "remote"): void {
    const home = join(process.env.PASEO_HOME ?? "", "plugin-data", "taro", "home", "projects", "demo");
    mkdirSync(home, { recursive: true });
    const config = {
      schemaVersion: 1,
      project: "demo",
      paseoProjectId: "p",
      repoPath: here,
      baseBranch: "main",
      ticketPrefix: "X",
      manager: { model: "m" },
      owner: { model: "m" },
      trackerSync,
    };
    writeFileSync(join(home, "taro.json"), JSON.stringify(config));
    if (!existsSync(join(home, "tracker"))) execFileSync("ln", ["-s", here, join(home, "tracker")]);
  }

  beforeEach(() => {
    process.env.PASEO_HOME = join(root, "paseo");
    calls = [];
    answer = conflict;
    watch = new TrackerWatch(async (_trackerPath, strategy) => {
      calls.push(strategy);
      return answer;
    });
    writeConfig("remote");
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
  });

  it("syncs after a new commit and not again until the next one", async () => {
    writeFileSync(join(here, OTHER_TICKET), "edited once\n");
    await watch.commit("demo");
    expect(calls).toEqual(["rebase"]);
    expect(watch.syncProblem("demo")).toEqual(conflict);

    // A file event with nothing to commit (the plugin's own rebase and abort) must not pull again.
    await watch.commit("demo");
    await watch.commit("demo");
    expect(calls).toEqual(["rebase"]);
    expect(watch.syncProblem("demo")).toEqual(conflict);

    writeFileSync(join(here, OTHER_TICKET), "edited twice\n");
    await watch.commit("demo");
    expect(calls).toEqual(["rebase", "rebase"]);
  });

  it.each([
    ["keep-local", "keep-local"],
    ["keep-remote", "keep-remote"],
    ["retry", "rebase"],
  ] as const)("resolve(%s) syncs with %s and clears the problem once in sync", async (resolution, strategy) => {
    writeFileSync(join(here, OTHER_TICKET), "edited once\n");
    await watch.commit("demo");
    answer = null;

    expect(await watch.resolve("demo", resolution)).toBeNull();
    expect(calls).toEqual(["rebase", strategy]);
    expect(watch.syncProblem("demo")).toBeNull();
  });

  it("keeps the problem when resolving fails again", async () => {
    writeFileSync(join(here, OTHER_TICKET), "edited once\n");
    await watch.commit("demo");
    expect(await watch.resolve("demo", "retry")).toEqual(conflict);
    expect(watch.syncProblem("demo")).toEqual(conflict);
  });

  it("resolving a project switched to local only drops the problem without syncing", async () => {
    writeFileSync(join(here, OTHER_TICKET), "edited once\n");
    await watch.commit("demo");
    writeConfig("local");
    expect(await watch.resolve("demo", "keep-local")).toBeNull();
    expect(watch.syncProblem("demo")).toBeNull();
    expect(calls).toEqual(["rebase"]);
  });

  describe("board-read pulls", () => {
    let clock = 0;
    const failed: TrackerSyncProblem = { kind: "failed", message: "Pulling from origin failed: fatal: unreachable", tickets: [] };

    beforeEach(() => {
      clock = 1_000_000;
      watch = new TrackerWatch(
        async (_trackerPath, strategy) => {
          calls.push(strategy);
          return answer;
        },
        () => clock,
      );
      answer = null;
    });

    it("pulls on the first read, then at most once a minute", async () => {
      await watch.pullIfDue("demo");
      expect(calls).toEqual(["rebase"]);
      clock += 59_999;
      await watch.pullIfDue("demo");
      expect(calls).toEqual(["rebase"]);
      clock += 1;
      await watch.pullIfDue("demo");
      expect(calls).toEqual(["rebase", "rebase"]);
    });

    it("queues one pull for reads landing together", async () => {
      await Promise.all([watch.pullIfDue("demo"), watch.pullIfDue("demo"), watch.pullIfDue("demo")]);
      expect(calls).toEqual(["rebase"]);
    });

    it("counts a commit's sync and a Retry as the last sync", async () => {
      writeFileSync(join(here, OTHER_TICKET), "edited once\n");
      await watch.commit("demo");
      clock += 30_000;
      await watch.pullIfDue("demo");
      expect(calls).toEqual(["rebase"]);

      clock += 40_000;
      await watch.resolve("demo", "retry");
      clock += 30_000;
      await watch.pullIfDue("demo");
      expect(calls).toEqual(["rebase", "rebase"]);
    });

    it("does not pull while a conflict is open, at any age", async () => {
      answer = conflict;
      await watch.pullIfDue("demo");
      expect(watch.syncProblem("demo")).toEqual(conflict);
      clock += 10 * 60_000;
      await watch.pullIfDue("demo");
      expect(calls).toEqual(["rebase"]);
    });

    it("retries a failed sync on the next due read and clears it once it works", async () => {
      answer = failed;
      await watch.pullIfDue("demo");
      expect(watch.syncProblem("demo")).toEqual(failed);
      answer = null;
      clock += 30_000;
      await watch.pullIfDue("demo");
      expect(watch.syncProblem("demo")).toEqual(failed);
      clock += 30_000;
      await watch.pullIfDue("demo");
      expect(calls).toEqual(["rebase", "rebase"]);
      expect(watch.syncProblem("demo")).toBeNull();
    });

    it("does not queue a second pull behind a slow one, and waits a minute after it ends", async () => {
      let release = (): void => undefined;
      const slow = new TrackerWatch(
        async (_trackerPath, strategy) => {
          calls.push(strategy);
          await new Promise<void>((resolve) => (release = resolve));
          return null;
        },
        () => clock,
      );
      const first = slow.pullIfDue("demo");
      await vi.waitFor(() => expect(calls).toEqual(["rebase"]));
      clock += 90_000;
      await slow.pullIfDue("demo");
      release();
      await first;
      expect(calls).toEqual(["rebase"]);

      clock += 59_999;
      await slow.pullIfDue("demo");
      expect(calls).toEqual(["rebase"]);
    });

    it("never pulls a local-only project", async () => {
      writeConfig("local");
      await watch.pullIfDue("demo");
      clock += 2 * 60_000;
      await watch.pullIfDue("demo");
      expect(calls).toEqual([]);
    });

    it("brings in a ticket edited in another clone and tells the listeners", async () => {
      const real = new TrackerWatch(syncTracker, () => clock);
      const changed: string[] = [];
      real.onChange((project) => changed.push(project));
      commit(there, TICKET, `${withLine(1, "status: Done").join("\n")}\n`);
      git(there, "push", "-q", "origin", TRACKER_BRANCH);

      await real.pullIfDue("demo");
      expect(readFileSync(join(here, TICKET), "utf8")).toContain("status: Done");
      expect(changed).toEqual(["demo"]);

      // Nothing new on the remote: a due pull changes nothing and wakes no listener.
      clock += 60_000;
      await real.pullIfDue("demo");
      expect(changed).toEqual(["demo"]);
      expect(real.syncProblem("demo")).toBeNull();
    });
  });

  it("drops a stale problem once the project syncs locally only", async () => {
    writeFileSync(join(here, OTHER_TICKET), "edited once\n");
    await watch.commit("demo");
    writeConfig("local");
    await watch.commit("demo");
    expect(watch.syncProblem("demo")).toBeNull();
    expect(calls).toEqual(["rebase"]);
  });
});
