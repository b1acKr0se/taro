/**
 * TR-050: the backstop for a missed file-watch event, against a real git tracker in a scratch
 * directory (never the live one). A change nothing committed, or a HEAD the listeners have not
 * seen, gets a commit and a status pass once five minutes passed since the last look.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BACKSTOP_INTERVAL_MS, TrackerWatch } from "./tracker-watch";

const TICKET = "backlog/tasks/x-001 - First.md";

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, "-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const previousHome = process.env.PASEO_HOME;
let root = "";
let tracker = "";
let clock = 0;
let passes: string[] = [];
let watch = new TrackerWatch();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "taro-backstop-"));
  tracker = join(root, "tracker");
  mkdirSync(join(tracker, "backlog", "tasks"), { recursive: true });
  execFileSync("git", ["init", "-q", tracker]);
  writeFileSync(join(tracker, TICKET), "status: In Progress\n");
  git(tracker, "add", "-A");
  git(tracker, "commit", "-q", "-m", "first");
  process.env.PASEO_HOME = join(root, "paseo");
  const home = join(root, "paseo", "plugin-data", "taro", "home", "projects", "demo");
  mkdirSync(home, { recursive: true });
  const config = { schemaVersion: 1, project: "demo", paseoProjectId: "p", repoPath: tracker, baseBranch: "main", ticketPrefix: "X", manager: { model: "m" }, owner: { model: "m" }, trackerSync: "local" };
  writeFileSync(join(home, "taro.json"), JSON.stringify(config));
  execFileSync("ln", ["-s", tracker, join(home, "tracker")]);
  clock = 1_000_000;
  passes = [];
  watch = new TrackerWatch(async () => null, () => clock);
  watch.onChange((project) => passes.push(project));
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});

/** A ticket edit whose file-watch event never arrived. */
function editUnseen(status: string): void {
  writeFileSync(join(tracker, TICKET), `status: ${status}\n`);
}

function commits(): number {
  return Number(git(tracker, "rev-list", "--count", "HEAD").trim());
}

describe("the tracker backstop", () => {
  it("commits a change nothing committed and runs the status pass, once", async () => {
    editUnseen("Awaiting acceptance");
    expect(await watch.backstop()).toEqual(["demo"]);
    expect(passes).toEqual(["demo"]);
    expect(commits()).toBe(2);
    expect(git(tracker, "status", "--porcelain")).toBe("");
    clock += BACKSTOP_INTERVAL_MS;
    expect(await watch.backstop()).toEqual([]);
    expect(passes).toEqual(["demo"]);
  });

  it("waits five minutes after a pass, then catches a change made since", async () => {
    await watch.commit("demo");
    passes = [];
    editUnseen("Awaiting acceptance");
    clock += BACKSTOP_INTERVAL_MS - 1;
    expect(await watch.backstop()).toEqual([]);
    expect(commits()).toBe(1);
    clock += 1;
    expect(await watch.backstop()).toEqual(["demo"]);
    expect(passes).toEqual(["demo"]);
    expect(commits()).toBe(2);
  });

  it("runs no pass when the tracker is clean and its HEAD is the one the last pass saw", async () => {
    await watch.commit("demo");
    passes = [];
    for (let round = 0; round < 3; round++) {
      clock += BACKSTOP_INTERVAL_MS;
      expect(await watch.backstop()).toEqual([]);
    }
    expect(passes).toEqual([]);
  });

  it("runs a pass for a HEAD the listeners have not seen, as from a commit made outside the plugin", async () => {
    await watch.commit("demo");
    passes = [];
    editUnseen("Done");
    git(tracker, "commit", "-q", "-am", "by hand");
    clock += BACKSTOP_INTERVAL_MS;
    expect(await watch.backstop()).toEqual(["demo"]);
    expect(passes).toEqual(["demo"]);
    expect(commits()).toBe(2);
  });

  it("takes a clean tracker's HEAD as seen right after a start, then looks again five minutes later", async () => {
    expect(await watch.backstop()).toEqual([]);
    expect(passes).toEqual([]);
    editUnseen("Reviewing");
    clock += 60_000;
    expect(await watch.backstop()).toEqual([]);
    clock += BACKSTOP_INTERVAL_MS;
    expect(await watch.backstop()).toEqual(["demo"]);
    expect(passes).toEqual(["demo"]);
  });

  it("logs a project whose tracker cannot be read and goes on", async () => {
    rmSync(join(tracker, ".git"), { recursive: true, force: true });
    expect(await watch.backstop()).toEqual([]);
    expect(passes).toEqual([]);
  });
});
