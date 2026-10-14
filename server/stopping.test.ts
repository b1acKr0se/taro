/**
 * TR-067: a reload or stop logs nothing at error level. A tracker pass under way at the stop runs no
 * listener and logs nothing, passes after it do nothing, and an RPC answered into the closed IPC
 * channel is not an unhandled `error` event. Against a real git tracker in a scratch directory.
 */
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isStopping, markStopping, reportFailure, resetStopping } from "./stopping";
import { TrackerWatch } from "./tracker-watch";

const TICKET = "backlog/tasks/x-001 - First.md";

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, "-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function closedChannel(): NodeJS.ErrnoException {
  return Object.assign(new Error("Channel closed"), { code: "ERR_IPC_CHANNEL_CLOSED" });
}

const previousHome = process.env.PASEO_HOME;
let root = "";
let tracker = "";
let passes: string[] = [];
let errors = vi.spyOn(console, "error");

beforeEach(() => {
  resetStopping();
  root = mkdtempSync(join(tmpdir(), "taro-stopping-"));
  tracker = join(root, "tracker");
  mkdirSync(join(tracker, "backlog", "tasks"), { recursive: true });
  execFileSync("git", ["init", "-q", tracker]);
  writeFileSync(join(tracker, TICKET), "status: In Progress\n");
  git(tracker, "add", "-A");
  git(tracker, "commit", "-q", "-m", "first");
  process.env.PASEO_HOME = join(root, "paseo");
  const home = join(root, "paseo", "plugin-data", "taro", "home", "projects", "demo");
  mkdirSync(home, { recursive: true });
  // Remote sync, so the pass calls the syncer after its commit: the test stops the plugin there.
  const config = { schemaVersion: 1, project: "demo", paseoProjectId: "p", repoPath: tracker, baseBranch: "main", ticketPrefix: "X", manager: { model: "m" }, owner: { model: "m" }, trackerSync: "remote" };
  writeFileSync(join(home, "taro.json"), JSON.stringify(config));
  execFileSync("ln", ["-s", tracker, join(home, "tracker")]);
  passes = [];
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errors.mockRestore();
  resetStopping();
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});

function commits(): number {
  return Number(git(tracker, "rev-list", "--count", "HEAD").trim());
}

describe("a stop during a tracker pass", () => {
  it("runs no listener and logs no error", async () => {
    let watch: TrackerWatch | null = null;
    // Paseo disposes the API, then runs the cleanup, while this pass is between its commit and its listeners.
    watch = new TrackerWatch(async () => {
      markStopping(new EventEmitter());
      watch?.stop();
      throw new Error("Transport not connected (status: disposed)");
    });
    watch.onChange((project) => passes.push(project));
    writeFileSync(join(tracker, TICKET), "status: Done\n");

    await watch.commit("demo").catch((error: unknown) => reportFailure("[taro] tracker pass failed:", error));

    expect(commits()).toBe(2);
    expect(passes).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("starts no pass after the stop", async () => {
    const watch = new TrackerWatch(async () => null);
    watch.onChange((project) => passes.push(project));
    watch.stop();
    writeFileSync(join(tracker, TICKET), "status: Done\n");

    await watch.commit("demo");
    expect(await watch.backstop()).toEqual([]);
    await watch.pullIfDue("demo");

    expect(commits()).toBe(1);
    expect(passes).toEqual([]);
  });

  it("still runs the listeners when not stopped", async () => {
    const watch = new TrackerWatch(async () => null);
    watch.onChange((project) => passes.push(project));
    writeFileSync(join(tracker, TICKET), "status: Done\n");

    await watch.commit("demo");

    expect(commits()).toBe(2);
    expect(passes).toEqual(["demo"]);
  });
});

describe("reportFailure", () => {
  it("logs a failure while the plugin runs", () => {
    const failure = new Error("git failed");
    reportFailure("[taro] tracker pass failed:", failure);
    expect(errors).toHaveBeenCalledWith("[taro] tracker pass failed:", failure);
  });

  it("logs nothing once the plugin is stopping", () => {
    markStopping(new EventEmitter());
    expect(isStopping()).toBe(true);
    reportFailure("[taro] notifications for demo:", new Error("Transport not connected (status: disposed)"));
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("the closed IPC channel", () => {
  it("is an unhandled error event before the stop, as Node reports it", () => {
    const target = new EventEmitter();
    expect(() => target.emit("error", closedChannel())).toThrow("Channel closed");
  });

  it("is ignored once stopping, without a log line", () => {
    const target = new EventEmitter();
    markStopping(target);
    expect(() => target.emit("error", closedChannel())).not.toThrow();
    expect(errors).not.toHaveBeenCalled();
  });

  it("leaves any other process error logged", () => {
    const target = new EventEmitter();
    markStopping(target);
    const other = Object.assign(new Error("Something else"), { code: "ERR_OTHER" });
    target.emit("error", other);
    expect(errors).toHaveBeenCalledWith("[taro] plugin process error while stopping:", other);
  });

  it("registers its listener once, however often the stop is marked", () => {
    const target = new EventEmitter();
    markStopping(target);
    markStopping(target);
    expect(target.listenerCount("error")).toBe(1);
  });
});
