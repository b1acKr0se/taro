/**
 * TR-050: the backstop for a missed file-watch event, against a real git tracker in a scratch
 * directory (never the live one). A change nothing committed, or a HEAD the listeners have not
 * seen, gets a commit and a status pass once five minutes passed since the last look.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetTicketFile } from "./tickets";
import { BACKSTOP_INTERVAL_MS, isTicketFileEvent, TrackerWatch } from "./tracker-watch";

vi.mock("./tickets", () => ({ forgetTicketFile: vi.fn() }));

const TICKET = "tickets/X-001.md";

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
  mkdirSync(join(tracker, "tickets"), { recursive: true });
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

  it("takes neither the store's temp files nor .taro/ for changes, and commits neither", async () => {
    await watch.commit("demo");
    passes = [];
    writeFileSync(join(tracker, "tickets", ".X-001.123.abc.tmp"), "half\n");
    mkdirSync(join(tracker, ".taro", "lock.broken.1"), { recursive: true });
    writeFileSync(join(tracker, ".taro", "lock.broken.1", "owner.json"), "{}");
    clock += BACKSTOP_INTERVAL_MS;
    expect(await watch.backstop()).toEqual([]);
    expect(passes).toEqual([]);
    editUnseen("Done");
    clock += BACKSTOP_INTERVAL_MS;
    expect(await watch.backstop()).toEqual(["demo"]);
    expect(git(tracker, "ls-files").trim().split("\n")).toEqual([TICKET]);
  });

  it("leaves a change alone while a write holds the tracker lock, and commits it after", async () => {
    editUnseen("Done");
    mkdirSync(join(tracker, ".taro", "lock"), { recursive: true });
    await watch.commit("demo");
    expect(commits()).toBe(1);
    rmSync(join(tracker, ".taro", "lock"), { recursive: true });
    clock += BACKSTOP_INTERVAL_MS;
    expect(await watch.backstop()).toEqual(["demo"]);
    expect(commits()).toBe(2);
  });

  it("logs a project whose tracker cannot be read and goes on", async () => {
    rmSync(join(tracker, ".git"), { recursive: true, force: true });
    expect(await watch.backstop()).toEqual([]);
    expect(passes).toEqual([]);
  });
});

describe("the tracker watch", () => {
  it("counts ticket files only, never the store's temp files or other dot files", () => {
    expect(isTicketFileEvent("X-001.md")).toBe(true);
    expect(isTicketFileEvent("X-001.02.md")).toBe(true);
    expect(isTicketFileEvent(".X-001.123.abc.tmp")).toBe(false);
    expect(isTicketFileEvent(".X-001.md")).toBe(false);
    expect(isTicketFileEvent("notes.txt")).toBe(false);
  });

  it("forgets a changed ticket's cached summary and ignores temp files and .taro/", async () => {
    vi.mocked(forgetTicketFile).mockClear();
    const live = new TrackerWatch(async () => null, () => clock);
    await live.refresh();
    try {
      writeFileSync(join(tracker, "tickets", ".X-001.123.abc.tmp"), "half\n");
      mkdirSync(join(tracker, ".taro", "lock"), { recursive: true });
      writeFileSync(join(tracker, ".taro", "lock", "owner.json"), "{}");
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(forgetTicketFile).not.toHaveBeenCalled();
      writeFileSync(join(tracker, TICKET), "status: Done\n");
      await vi.waitFor(() => expect(forgetTicketFile).toHaveBeenCalledWith(join(root, "paseo", "plugin-data", "taro", "home", "projects", "demo", "tracker"), "X-001.md"));
      expect(vi.mocked(forgetTicketFile).mock.calls.every(([, file]) => file === "X-001.md")).toBe(true);
    } finally {
      live.stop();
    }
  });
});
