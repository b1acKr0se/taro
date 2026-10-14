import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseTicket, type Ticket } from "../shared/ticket-format";

const BIN = resolve(import.meta.dirname, "..", "bin", "taro");

let repository: string;

beforeEach(() => {
  repository = mkdtempSync(join(tmpdir(), "notes-app-"));
  git(["init", "-q", "-b", "main"]);
});

afterEach(() => {
  rmSync(repository, { recursive: true, force: true });
});

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.TARO_TRACKER;
  delete env.BACKLOG_CWD;
  return env;
}

function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8", env: cleanEnv() });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** The real `bin/taro` under plain node, run from the repository, TARO_TRACKER and BACKLOG_CWD unset. */
function taro(args: string[]): Result {
  const result = spawnSync(BIN, args, { cwd: repository, encoding: "utf8", env: cleanEnv(), timeout: 60_000 });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(repository, path)), { recursive: true });
  writeFileSync(join(repository, path), text);
}

function commitAll(): void {
  git(["add", "-A"]);
  git(["-c", "user.name=Alex", "-c", "user.email=alex@example.com", "commit", "-q", "--no-verify", "-m", "tracker"]);
}

/** Every file outside .git with its bytes, and HEAD: equal snapshots mean nothing was written. */
function snapshot(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (relative: string): void => {
    for (const name of readdirSync(join(repository, relative)).sort()) {
      if (relative === "" && name === ".git") continue;
      const path = relative === "" ? name : `${relative}/${name}`;
      if (statSync(join(repository, path)).isDirectory()) walk(path);
      else files[path] = readFileSync(join(repository, path)).toString("base64");
    }
  };
  walk("");
  files.HEAD = git(["rev-parse", "HEAD"]).trim();
  return files;
}

const CONFIG = 'project_name: "notes-app"\ndefault_status: "To Do"\nzero_padded_ids: 3\ntask_prefix: "NA"\n';

/** A Backlog task file; a key given in `extra` replaces its default. */
function task(id: string, extra: string[] = [], body = ""): string {
  const given = new Set(extra.map((line) => /^([a-z_]+):/.exec(line)?.[1]));
  const defaults = [
    `id: ${id}`,
    `title: Ticket ${id}`,
    "status: Done",
    "assignee: []",
    "created_date: '2026-10-13 11:21'",
    "updated_date: '2026-10-13 11:33'",
    "labels: []",
    "dependencies: []",
  ].filter((line) => !given.has(/^([a-z_]+):/.exec(line)?.[1]));
  return ["---", ...defaults, ...extra, "ordinal: 1000", "---", body].join("\n");
}

/** A small tracker: tasks/ only, committed. */
function smallTracker(): void {
  write("backlog/config.yml", CONFIG);
  write("backlog/tasks/na-001 - One.md", task("NA-001"));
  write("backlog/tasks/na-002 - Two.md", task("NA-002", ["status: To Do"]));
  commitAll();
}

function readTicket(id: string): Ticket {
  const parsed = parseTicket(readFileSync(join(repository, "tickets", `${id}.md`), "utf8"), `${id}.md`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return parsed.ticket;
}

describe("taro convert --dry-run", () => {
  it("prints one line per ticket with its reports and the totals, writes nothing, and gives the same output twice", () => {
    smallTracker();
    const before = snapshot();
    const first = taro(["convert", "--dry-run", "--tracker", repository]);
    expect(first.stderr).toBe("");
    expect(first.code).toBe(0);
    expect(first.stdout).toBe(
      [
        "NA-001 → tickets/NA-001.md",
        "NA-002 → tickets/NA-002.md",
        '  status "To Do" is not one of Taro\'s; set to Backlog',
        "2 tickets (2 tasks, 0 completed, 0 archive/tasks, 0 drafts), 1 report, 0 problems; tracker.json: prefix NA, padding 3, lastId 2",
        "",
      ].join("\n"),
    );
    expect(snapshot()).toEqual(before);
    expect(git(["status", "--porcelain"])).toBe("");
    const second = taro(["convert", "--dry-run"]);
    expect(second).toEqual(first);
    expect(snapshot()).toEqual(before);
  });

  it("lists problems and exits 1 when a file cannot be converted", () => {
    smallTracker();
    write("backlog/tasks/na-003 - Bad.md", task("NA-003", [], "\nStray text\n"));
    const result = taro(["convert", "--dry-run"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("backlog/tasks/na-003 - Bad.md:13: text outside Backlog's section markers");
  });
});

describe("taro convert refuses, changing nothing", () => {
  function expectRefusal(pattern: RegExp): void {
    const before = snapshot();
    const result = taro(["convert", "--tracker", repository]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toMatch(pattern);
    expect(snapshot()).toEqual(before);
  }

  // Regression (TR-081.03 review): a git step failing after the writes left a half-converted tree.
  it("when the commit fails after the writes, putting the tracker back as it was", () => {
    smallTracker();
    git(["config", "commit.gpgsign", "true"]);
    git(["config", "gpg.program", "false"]);
    expectRefusal(/^Not converted: .*put back as it was/);
    expect(git(["status", "--porcelain"])).toBe("");
    git(["config", "commit.gpgsign", "false"]);
    expect(taro(["convert", "--tracker", repository]).code).toBe(0);
  });

  it("when tickets/ exists", () => {
    smallTracker();
    write("tickets/.keep", "");
    commitAll();
    expectRefusal(/^Not converted: .*tickets already exists/);
  });

  it("when tracker.json exists", () => {
    smallTracker();
    write("tracker.json", "{}\n");
    commitAll();
    expectRefusal(/^Not converted: .*tracker\.json already exists/);
  });

  it("when git status --porcelain is not clean", () => {
    smallTracker();
    write("backlog/tasks/na-001 - One.md", task("NA-001", ["priority: high"]));
    expectRefusal(/^Not converted: .*uncommitted changes/);
    write("notes.txt", "untracked\n");
    expectRefusal(/uncommitted changes/);
  });

  it("when there is no backlog/config.yml", () => {
    write("README.md", "notes\n");
    commitAll();
    expectRefusal(/^Not converted: No backlog\/config\.yml/);
  });

  it("when a draft's id does not fit the prefix, naming the file", () => {
    smallTracker();
    write("backlog/drafts/draft-1 - Idea.md", task("DRAFT-1"));
    commitAll();
    expectRefusal(/^Not converted: backlog\/drafts\/draft-1 - Idea\.md:1: id "DRAFT-1" does not fit the prefix NA/);
  });
});

describe("taro convert", () => {
  it("converts every folder, writes tracker.json and .gitignore, removes backlog/ and commits once as Taro", () => {
    write("backlog/config.yml", CONFIG);
    // Backlog.md leaves empty folders git does not track; they must go with backlog/ too.
    mkdirSync(join(repository, "backlog", "decisions"), { recursive: true });
    mkdirSync(join(repository, "backlog", ".locks"), { recursive: true });
    write(
      "backlog/tasks/na-003 - Parent.md",
      task(
        "NA-003",
        ["priority: high", "labels:", "  - complexity-low"],
        [
          "",
          "## Description",
          "",
          "<!-- SECTION:DESCRIPTION:BEGIN -->",
          "Costs $5 and $& 🚀",
          "```",
          "<!-- SECTION:NOTES:BEGIN -->",
          "```",
          "<!-- SECTION:DESCRIPTION:END -->",
          "",
          "## Acceptance Criteria",
          "<!-- AC:BEGIN -->",
          "- [x] #1 First",
          "- [ ] #2 Second 🚀",
          "<!-- AC:END -->",
          "",
        ].join("\n"),
      ),
    );
    write("backlog/tasks/na-003.01 - Child.md", task("NA-003.01", ["parent_task_id: NA-003", "dependencies: [NA-001]"]));
    write("backlog/tasks/na-003.02 - Child.md", task("NA-003.02", ["parent_task_id: NA-003"]));
    write(
      "backlog/tasks/na-004 - Crlf.md",
      task("NA-004", [], "\n<!-- SECTION:NOTES:BEGIN -->\nA note\n<!-- SECTION:NOTES:END -->\n")
        .replace("title: Ticket NA-004", 'title: "Rocket \\U0001F680"')
        .split("\n")
        .join("\r\n"),
    );
    write("backlog/completed/na-009 - Done.md", task("NA-009"));
    write("backlog/archive/tasks/na-012 - Archived.md", task("NA-012", ["status: Cancelled"]));
    write("backlog/drafts/na-010 - Draft.md", task("NA-010", ["status: Backlog"]));
    write("backlog/docs/readme.md", "Docs\n");
    write(".gitignore", "node_modules/\n.taro/");
    commitAll();
    const head = git(["rev-parse", "HEAD"]).trim();

    const result = taro(["convert", "--tracker", repository]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("NA-012 → tickets/NA-012.md\n  from backlog/archive/tasks\n");
    expect(result.stdout).toContain("backlog/docs/readme.md is removed with backlog/, not converted\n");
    expect(result.stdout).toMatch(/Converted 7 tickets; removed backlog\/; committed [0-9a-f]{12}\.\n$/);

    expect(readdirSync(join(repository, "tickets")).sort()).toEqual([
      "NA-003.01.md",
      "NA-003.02.md",
      "NA-003.md",
      "NA-004.md",
      "NA-009.md",
      "NA-010.md",
      "NA-012.md",
    ]);
    const parent = readTicket("NA-003");
    expect(parent).toMatchObject({
      title: "Ticket NA-003",
      status: "Done",
      priority: "high",
      labels: ["complexity-low"],
      created: "2026-10-13T11:21:00Z",
      updated: "2026-10-13T11:33:00Z",
      description: "Costs $5 and $& 🚀\n```\n<!-- SECTION:NOTES:BEGIN -->\n```",
      criteria: [
        { index: 1, text: "First", checked: true },
        { index: 2, text: "Second 🚀", checked: false },
      ],
    });
    expect(readTicket("NA-003.01")).toMatchObject({ parent: "NA-003", dependsOn: ["NA-001"] });
    expect(readTicket("NA-004")).toMatchObject({ title: "Rocket 🚀", notes: "A note" });
    expect(readTicket("NA-012").status).toBe("Cancelled");

    expect(JSON.parse(readFileSync(join(repository, "tracker.json"), "utf8"))).toEqual({
      schema: 1,
      prefix: "NA",
      padding: 3,
      lastId: 12,
      lastChild: { "NA-003": 2 },
    });
    expect(readFileSync(join(repository, ".gitignore"), "utf8")).toBe("node_modules/\n.taro/\ntickets/.*.tmp\n");
    expect(existsSync(join(repository, "backlog"))).toBe(false);

    expect(git(["rev-list", "--count", `${head}..HEAD`]).trim()).toBe("1");
    expect(git(["log", "-1", "--format=%an <%ae>|%s"]).trim()).toBe("Taro <taro@localhost>|taro: convert tracker to Taro's format");
    expect(git(["show", "--name-status", "--format=", "HEAD"]).split("\n").filter((line) => line.startsWith("D\t")).length).toBe(9);
    expect(git(["status", "--porcelain"])).toBe("");

    const check = taro(["ticket", "check", "--tracker", repository]);
    expect(check.stdout).toBe("0 problems\n");
    expect(check.code).toBe(0);
    const again = taro(["convert", "--tracker", repository]);
    expect(again.code).toBe(1);
  });
});
