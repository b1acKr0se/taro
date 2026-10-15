import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commitTracker, ensureTracker, ticketIdInPath, withIgnoredEntries } from "./tracker";
import { latestRecord } from "./tickets";
import { fill, withoutNotes } from "./package-files";
import { pluginPathIn } from "./cli";

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, "-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("trackers on disk (scratch repositories, never the live tracker)", () => {
  let root = "";
  let repo = "";
  let tracker = "";
  const setup = () => ({ repoPath: repo, trackerPath: tracker, project: "notes", ticketPrefix: "NA", baseBranch: "main" });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "taro-tracker-"));
    repo = join(root, "repo");
    tracker = join(root, "tracker");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "first");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates tickets/, tracker.json and .gitignore for a new project, committed", async () => {
    expect(await ensureTracker(setup())).toEqual({ adopted: false });
    expect(JSON.parse(readFileSync(join(tracker, "tracker.json"), "utf8"))).toEqual({ schema: 1, prefix: "NA", padding: 3, lastId: 0, lastChild: {} });
    expect(statSync(join(tracker, "tickets")).isDirectory()).toBe(true);
    expect(readFileSync(join(tracker, ".gitignore"), "utf8")).toBe("node_modules/\n.taro/\ntickets/.*.tmp\n");
    expect(git(tracker, "status", "--porcelain")).toBe("");
    expect(git(tracker, "show", "--name-only", "--format=%s", "HEAD").trim().split("\n")).toEqual(["taro: update tracker", "", ".gitignore", "tracker.json"]);
  });

  it("adopts a tracker that has tracker.json as it is", async () => {
    await ensureTracker(setup());
    writeFileSync(join(tracker, "tracker.json"), '{"schema":1,"prefix":"NA","padding":3,"lastId":7,"lastChild":{}}\n');
    git(tracker, "commit", "-q", "-am", "seven");
    expect(await ensureTracker(setup())).toEqual({ adopted: true });
    expect(JSON.parse(readFileSync(join(tracker, "tracker.json"), "utf8")).lastId).toBe(7);
  });

  it("commits with Taro's .gitignore in place and .taro/ and a temp file present", async () => {
    await ensureTracker(setup());
    writeFileSync(join(tracker, "tickets", "NA-001.md"), "one\n");
    writeFileSync(join(tracker, "tickets", ".NA-001.123.abc.tmp"), "half\n");
    mkdirSync(join(tracker, ".taro", "lock.broken.1"), { recursive: true });
    expect(await commitTracker(tracker)).toEqual({ subject: "taro: update NA-001", locked: false });
    expect(git(tracker, "status", "--porcelain")).toBe("");
  });

  it("commits tickets, never .taro/ or a temp file, and skips while the lock is held", async () => {
    await ensureTracker(setup());
    // Without .gitignore's entries, so the exclusion does not rest on them.
    writeFileSync(join(tracker, ".gitignore"), "");
    git(tracker, "commit", "-q", "-am", "plain gitignore");
    writeFileSync(join(tracker, "tickets", "NA-001.md"), "one\n");
    writeFileSync(join(tracker, "tickets", ".NA-001.123.abc.tmp"), "half\n");
    mkdirSync(join(tracker, ".taro", "lock"), { recursive: true });
    writeFileSync(join(tracker, ".taro", "lock", "owner.json"), "{}");
    writeFileSync(join(tracker, "stray.txt"), "not the tracker's\n");

    expect(await commitTracker(tracker)).toEqual({ subject: null, locked: true });
    rmSync(join(tracker, ".taro", "lock"), { recursive: true });
    expect(await commitTracker(tracker)).toEqual({ subject: "taro: update NA-001", locked: false });
    expect(git(tracker, "ls-files").trim().split("\n").sort()).toEqual([".gitignore", "tickets/NA-001.md", "tracker.json"]);
    expect(git(tracker, "status", "--porcelain", "--untracked-files=all").trim().split("\n").sort()).toEqual(["?? stray.txt", "?? tickets/.NA-001.123.abc.tmp"]);
  });

  // Regression (TR-081 review): a lock left by a killed writer stopped every commit until the next write.
  it("breaks a lock whose holder is gone and commits, but leaves a live holder's lock alone", async () => {
    await ensureTracker(setup());
    writeFileSync(join(tracker, "tickets", "NA-001.md"), "one\n");
    mkdirSync(join(tracker, ".taro", "lock"), { recursive: true });
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(join(tracker, ".taro", "lock", "owner.json"), JSON.stringify({ pid: dead, host: hostname(), token: "gone" }));
    expect(await commitTracker(tracker)).toEqual({ subject: "taro: update NA-001", locked: false });
    expect(existsSync(join(tracker, ".taro", "lock"))).toBe(false);

    writeFileSync(join(tracker, "tickets", "NA-001.md"), "two\n");
    mkdirSync(join(tracker, ".taro", "lock"));
    writeFileSync(join(tracker, ".taro", "lock", "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), token: "live" }));
    expect(await commitTracker(tracker)).toEqual({ subject: null, locked: true });
    expect(JSON.parse(readFileSync(join(tracker, ".taro", "lock", "owner.json"), "utf8")).token).toBe("live");
  });
});

describe("withIgnoredEntries", () => {
  it("appends what is missing, once, keeping the repository's lines", () => {
    expect(withIgnoredEntries("")).toBe(".taro/\ntickets/.*.tmp\n");
    expect(withIgnoredEntries("dist")).toBe("dist\n.taro/\ntickets/.*.tmp\n");
    expect(withIgnoredEntries(".taro/\ntickets/.*.tmp\n")).toBe(".taro/\ntickets/.*.tmp\n");
  });
});

describe("ticketIdInPath", () => {
  it("reads the id from a ticket file name", () => {
    expect(ticketIdInPath("tickets/TR-081.md")).toBe("TR-081");
    expect(ticketIdInPath("tickets/TR-081.01.md")).toBe("TR-081.01");
  });

  it("returns null for other files", () => {
    expect(ticketIdInPath("tracker.json")).toBeNull();
    expect(ticketIdInPath("tickets/.TR-081.123.abc.tmp")).toBeNull();
    expect(ticketIdInPath("docs/sh-012 - Fix-login.md")).toBeNull();
  });
});

describe("latestRecord", () => {
  const notes = "DISPATCH-INTENT 2026 token\nEXECUTION 2026 agent a\nMILESTONE 2026 first\n\nmore detail\nMILESTONE 2026 second\nHANDOFF 2026 now";

  it("finds the most recent record of the given kinds", () => {
    expect(latestRecord(notes, ["MILESTONE"])).toBe("MILESTONE 2026 second");
    expect(latestRecord(notes, ["HANDOFF", "MILESTONE"])).toBe("HANDOFF 2026 now");
  });

  it("returns null when there is none", () => {
    expect(latestRecord(notes, ["FINAL"])).toBeNull();
    expect(latestRecord(null, ["FINAL"])).toBeNull();
  });
});

describe("templates", () => {
  it("drops notes and fills placeholders in one pass", () => {
    expect(withoutNotes("<!-- note -->\nHello {{name}}\n")).toBe("Hello {{name}}");
    expect(fill("Hi {{name}}, {{other}}", { name: "{{other}}" })).toBe("Hi {{other}}, {{other}}");
  });
});

describe("pluginPathIn", () => {
  it("finds the plugin's directory in paseo plugin ls output", () => {
    expect(pluginPathIn([{ id: "taro", path: "/x/taro" }, { id: "other", path: "/y" }], "taro")).toBe("/x/taro");
    expect(pluginPathIn([{ id: "other" }], "taro")).toBeNull();
    expect(pluginPathIn("nope", "taro")).toBeNull();
  });
});

import { sameQuestion, seenAgain } from "../shared/reports";

describe("sameQuestion", () => {
  const asked = { question: "Approve?", blocking: true, options: [{ label: "Approve", prompt: "Approve it", consequence: "", images: [] }] };
  it("matches an identical block and not a changed one", () => {
    expect(sameQuestion(asked, { ...asked, options: [{ label: "Approve", prompt: "Approve it", consequence: "different note", images: [] }] })).toBe(true);
    expect(sameQuestion(asked, { ...asked, question: "Approve the new scope?" })).toBe(false);
    expect(sameQuestion(asked, { ...asked, blocking: false })).toBe(false);
  });
});

describe("seenAgain (TR-108)", () => {
  const asked = { question: "Approve the plan for TR-9?", blocking: true, options: [{ label: "Approve", prompt: "Approve the plan for TR-9", consequence: "", images: [] }] };
  it("is the same turn when both turns are known, whatever the question", () => {
    expect(seenAgain({ ...asked, turn: "t1" }, asked, "t1")).toBe(true);
    expect(seenAgain({ ...asked, turn: "t1" }, asked, "t2")).toBe(false);
    expect(seenAgain({ ...asked, turn: "t1" }, { ...asked, question: "Approve the new plan?" }, "t1")).toBe(true);
  });
  it("falls back to the question when either turn is unknown", () => {
    expect(seenAgain({ ...asked, turn: null }, asked, "t2")).toBe(true);
    expect(seenAgain({ ...asked, turn: "t1" }, asked, null)).toBe(true);
    expect(seenAgain({ ...asked, turn: null }, { ...asked, question: "Approve the new plan?" }, null)).toBe(false);
  });
});
