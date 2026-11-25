import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = resolve(import.meta.dirname, "..", "bin", "taro");
const CLI_TIMEOUT_MS = 60_000;

let scratch: string;
let tracker: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "taro-escapes-"));
  tracker = join(scratch, "tracker");
  mkdirSync(join(tracker, "tickets"), { recursive: true });
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function taro(args: string[], env: Record<string, string> = {}) {
  const clean: Record<string, string | undefined> = { ...process.env };
  delete clean.TARO_TRACKER;
  delete clean.TARO_PROJECT;
  const result = spawnSync(BIN, args, { encoding: "utf8", env: { ...clean, ...env }, timeout: 60_000 });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Creates a ticket holding the notes given as separate records. */
function seed(notes: string[]): string {
  const created = taro(["ticket", "create", "T", "--tracker", tracker, "--plain"]);
  expect(created.code, created.stderr).toBe(0);
  const id = /[A-Z]+-\d+/.exec(created.stdout)?.[0] as string;
  if (notes.length > 0) {
    const edited = taro(["ticket", "edit", id, "--tracker", tracker, ...notes.flatMap((note) => ["--append-notes", note])]);
    expect(edited.code, edited.stderr).toBe(0);
  }
  return id;
}

function escapes(...args: string[]) {
  return taro(["escapes", "--tracker", tracker, ...args]);
}

function many(count: number): void {
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let index = 1; index <= count; index++) seed([`ESCAPE 2026-02-${pad(index)} — escape ${index}`]);
}

describe("taro escapes", { timeout: CLI_TIMEOUT_MS }, () => {
  it("escapes newest first across tickets", () => {
    const first = seed(["ESCAPE 2026-10-22 — oldest"]);
    const second = seed(["ESCAPE 2026-11-12T10:10Z — newest"]);
    const third = seed(["ESCAPE 2026-10-23T09:57Z — middle"]);
    const result = escapes();
    expect(result.code, result.stderr).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(`3 of 3 escapes recorded in ${tracker}, newest first`);
    expect(lines.slice(1)).toEqual([`${second} · 2026-11-12T10:10Z — newest`, `${third} · 2026-10-23T09:57Z — middle`, `${first} · 2026-10-22 — oldest`]);
  });

  it("escapes default to 20 with the header saying so", () => {
    many(25);
    const lines = escapes().stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(`20 of 25 escapes recorded in ${tracker}, newest first (--all shows every one)`);
    expect(lines).toHaveLength(21);
  });

  it("--all prints every escape", () => {
    many(25);
    const lines = escapes("--all").stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(`25 of 25 escapes recorded in ${tracker}, newest first`);
    expect(lines).toHaveLength(26);
  });

  it("--limit prints n and refuses anything but a positive integer", () => {
    many(5);
    expect(escapes("--limit", "3").stdout.trimEnd().split("\n")).toHaveLength(4);
    for (const bad of ["0", "-1", "abc"]) {
      const result = escapes("--limit", bad);
      expect(result.code, bad).toBe(2);
      expect(result.stderr).toContain("Usage:");
    }
  });

  it("a long escape is cut to 300 characters with …", () => {
    seed([`ESCAPE 2026-01-01 — ${"x".repeat(500)}`]);
    const line = escapes().stdout.trimEnd().split("\n")[1] as string;
    expect([...line]).toHaveLength(300);
    expect(line.endsWith("…")).toBe(true);
  });

  it("a multi-line escape is joined into one line", () => {
    const id = seed(["ESCAPE 2026-01-01 — first line\nsecond line\n  third"]);
    expect(escapes().stdout.trimEnd().split("\n")[1]).toBe(`${id} · 2026-01-01 — first line second line third`);
  });

  it("an ESCAPE quoted inside another record is not listed", () => {
    seed(["CORRECTION the earlier ESCAPE 2026-01-01 — x was wrong"]);
    expect(escapes().stdout).toBe(`No escapes recorded in ${tracker}.\n`);
  });

  it("a record without a readable time sorts last", () => {
    const untimed = seed(["ESCAPE should have caught it"]);
    const timed = seed(["ESCAPE 2026-01-01 — dated"]);
    const lines = escapes().stdout.trimEnd().split("\n");
    expect(lines[1]).toContain(timed);
    expect(lines[2]).toContain(untimed);
  });

  it("no escapes prints the none line and exits 0", () => {
    seed([]);
    const result = escapes();
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`No escapes recorded in ${tracker}.\n`);
  });

  it("no tracker found exits 2 with the usual message", () => {
    const result = taro(["escapes"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("No tracker: tried --tracker, --project, $TARO_TRACKER and $TARO_PROJECT");
  });

  it("a tracker in the plugin's layout is named by its project", () => {
    const home = join(scratch, "home");
    const projectTracker = join(home, "plugin-data", "taro", "home", "projects", "notes-app", "tracker");
    mkdirSync(join(projectTracker, "tickets"), { recursive: true });
    expect(taro(["escapes", "--tracker", projectTracker]).stdout).toBe("No escapes recorded in notes-app.\n");
  });

  it("a tracker outside the plugin's layout is named by its path", () => {
    seed(["ESCAPE 2026-01-01 — x"]);
    expect(escapes().stdout.split("\n")[0]).toBe(`1 of 1 escapes recorded in ${tracker}, newest first`);
  });

  it("help lists the command", () => {
    expect(taro(["help"]).stdout).toContain("taro escapes [--all | --limit <n>]");
  });
});
