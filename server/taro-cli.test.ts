import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseTicket, serializeTicket, type Ticket } from "../shared/ticket-format";
import { currentStep, nextStepAnswer } from "./next-step";
import { main } from "./taro-cli.ts";

// `taro next` asks the daemon, whose handler reads the project's tracker and settings: here, the scratch tracker.
const project = vi.hoisted(() => ({ tracker: "" }));
vi.mock("./projects", () => ({
  projectPaths: async () => ({ tracker: project.tracker }),
  readProjectConfig: async () => ({ baseBranch: "main", delivery: "pull-request", acceptAlsoMerges: true }),
}));

const BIN = resolve(import.meta.dirname, "..", "bin", "taro");

// Each test starts node once per command: up to 2 s in a full run, past vitest's 5 s default under load.
const CLI_TIMEOUT_MS = 30_000;
// The tickets.md walk-through runs every documented line, about 4 s in a full run.
const DOCUMENTED_LINES_TIMEOUT_MS = 60_000;

let tracker: string;
let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "taro-cli-"));
  tracker = join(scratch, "tracker");
  mkdirSync(join(tracker, "tickets"), { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the real `bin/taro` (plain node, no vitest transform) with TARO_TRACKER unset unless given. */
function taro(args: string[], env: Record<string, string> = {}, command = BIN): Result {
  const clean = { ...process.env };
  delete clean.TARO_TRACKER;
  const result = spawnSync(command, args, { encoding: "utf8", env: { ...clean, ...env }, timeout: 60_000 });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function ticketCommand(args: string[], env: Record<string, string> = {}): Result {
  return taro(["ticket", ...args, "--tracker", tracker], env);
}

function ok(args: string[]): Result {
  const result = ticketCommand(args);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  return result;
}

function fileOf(id: string): string {
  return join(tracker, "tickets", `${id}.md`);
}

function readTicket(id: string): Ticket {
  const parsed = parseTicket(readFileSync(fileOf(id), "utf8"), `${id}.md`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return parsed.ticket;
}

function writeTicket(overrides: Partial<Ticket> & { id: string }): void {
  const ticket: Ticket = {
    title: `Ticket ${overrides.id}`,
    status: "Queued",
    priority: null,
    labels: [],
    parent: null,
    dependsOn: [],
    created: "2026-10-01T10:00:00Z",
    updated: "2026-10-01T10:00:00Z",
    description: "",
    plan: "",
    criteria: [],
    notes: "",
    finalSummary: "",
    extra: {},
    ...overrides,
  };
  writeFileSync(fileOf(ticket.id), serializeTicket(ticket));
}

function fullTicket(): void {
  writeTicket({
    id: "TR-001",
    title: "Fix login redirect",
    status: "In Progress",
    priority: "high",
    labels: ["bug", "web"],
    dependsOn: ["TR-002"],
    description: "Users land on the wrong page.",
    plan: "Change the redirect.",
    criteria: [
      { index: 1, text: "Redirect works", checked: true },
      { index: 2, text: "Test added", checked: false },
    ],
    notes: "MILESTONE one",
    finalSummary: "All done.",
  });
  writeTicket({ id: "TR-002", title: "Other thing", status: "Done" });
  writeTicket({ id: "TR-001.01", title: "Child of one", parent: "TR-001", labels: ["web"], status: "Planning" });
}

describe("bin/taro", { timeout: CLI_TIMEOUT_MS }, () => {
  it("runs under plain node through the shell, also through a symlink", () => {
    fullTicket();
    const direct = taro(["ticket", "list", "--tracker", tracker]);
    expect(direct.stderr).toBe("");
    expect(direct.code).toBe(0);
    expect(direct.stdout).toContain("TR-001 [In Progress] Fix login redirect");
    const link = join(scratch, "linked-taro");
    symlinkSync(BIN, link);
    const linked = taro(["ticket", "list", "--plain", "--tracker", tracker], {}, link);
    expect(linked.code).toBe(0);
    expect(linked.stdout).toBe(direct.stdout);
    const shell = spawnSync("sh", ["-c", `"${BIN}" ticket list --tracker "${tracker}"`], { encoding: "utf8" });
    expect(shell.stdout).toBe(direct.stdout);
  });

  it("uses TARO_NODE and $TARO_TRACKER", () => {
    fullTicket();
    const result = taro(["ticket", "list"], { TARO_TRACKER: tracker, TARO_NODE: process.execPath });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("TR-002");
  });

  // TR-081 review: Paseo's desktop app runs the daemon in Electron, whose binary is plain Node only with ELECTRON_RUN_AS_NODE.
  it("runs TARO_NODE as plain Node with type stripping on", () => {
    const runtime = join(tracker, "fake-runtime");
    writeFileSync(runtime, '#!/bin/sh\necho "$ELECTRON_RUN_AS_NODE $1"\n', { mode: 0o755 });
    const result = taro(["ticket", "list"], { TARO_NODE: runtime });
    expect(result.stdout).toBe("1 --experimental-strip-types\n");
  });
});

describe("taro ticket list", { timeout: CLI_TIMEOUT_MS }, () => {
  it("says so for an empty tracker, and gives empty JSON", () => {
    expect(ok(["list"]).stdout).toBe("No tickets.\n");
    expect(JSON.parse(ok(["list", "--json"]).stdout)).toEqual({ tickets: [] });
  });

  it("lists plain and as JSON {tickets:[…]}", () => {
    fullTicket();
    const plain = ok(["list", "--plain"]).stdout.trim().split("\n");
    expect(plain).toEqual([
      "TR-001 [In Progress] Fix login redirect (priority high; labels bug, web)",
      "TR-001.01 [Planning] Child of one (labels web; parent TR-001)",
      "TR-002 [Done] Other thing",
    ]);
    const parsed = JSON.parse(ok(["list", "--json"]).stdout);
    expect(parsed.tickets.map((entry: { id: string }) => entry.id)).toEqual(["TR-001", "TR-001.01", "TR-002"]);
    expect(parsed.tickets[0]).toMatchObject({ status: "In Progress", criteriaCount: 2, criteriaChecked: 1, parent: null });
  });

  it("filters by -s, -l, -p alone and combined", () => {
    fullTicket();
    const ids = (args: string[]) => (JSON.parse(ok(["list", "--json", ...args]).stdout).tickets as { id: string }[]).map((entry) => entry.id);
    expect(ids(["-s", "In Progress"])).toEqual(["TR-001"]);
    expect(ids(["-l", "web"])).toEqual(["TR-001", "TR-001.01"]);
    expect(ids(["-p", "TR-001"])).toEqual(["TR-001.01"]);
    expect(ids(["-l", "web", "-s", "Planning"])).toEqual(["TR-001.01"]);
    expect(ids(["-l", "web", "-p", "TR-001", "-s", "Planning"])).toEqual(["TR-001.01"]);
    expect(ids(["-l", "bug", "-p", "TR-001"])).toEqual([]);
    expect(ids(["-s", "Blocked"])).toEqual([]);
  });
});

describe("taro ticket view", { timeout: CLI_TIMEOUT_MS }, () => {
  it("prints every section and the revision in plain text", () => {
    fullTicket();
    const text = ok(["view", "TR-001", "--plain"]).stdout;
    const revision = JSON.parse(ok(["view", "TR-001", "--json"]).stdout).ticket.revision;
    expect(text).toBe(
      [
        "TR-001 - Fix login redirect",
        "Status: In Progress",
        "Priority: high",
        "Labels: bug, web",
        "Parent: none",
        "Dependencies: TR-002",
        "Created: 2026-10-01T10:00:00Z",
        "Updated: 2026-10-01T10:00:00Z",
        `Revision: ${revision}`,
        "",
        "Description:",
        "Users land on the wrong page.",
        "",
        "Plan:",
        "Change the redirect.",
        "",
        "Acceptance criteria:",
        "- [x] #1 Redirect works",
        "- [ ] #2 Test added",
        "",
        "Notes:",
        "MILESTONE one",
        "",
        "Final summary:",
        "All done.",
        "",
        "Subtasks:",
        "TR-001.01 [Planning] Child of one (labels web; parent TR-001)",
        "",
      ].join("\n"),
    );
  });

  it("gives {ticket:{…}} as JSON", () => {
    fullTicket();
    const { ticket } = JSON.parse(ok(["view", "TR-001", "--json"]).stdout);
    expect(ticket).toMatchObject({
      id: "TR-001",
      title: "Fix login redirect",
      priority: "high",
      labels: ["bug", "web"],
      dependsOn: ["TR-002"],
      description: "Users land on the wrong page.",
      notes: "MILESTONE one",
      finalSummary: "All done.",
      file: "tickets/TR-001.md",
    });
    expect(ticket.criteria).toEqual([
      { index: 1, text: "Redirect works", checked: true },
      { index: 2, text: "Test added", checked: false },
    ]);
    expect(ticket.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(ticket.subtasks.map((entry: { id: string }) => entry.id)).toEqual(["TR-001.01"]);
  });

  it("names a missing ticket in one line, exit 1", () => {
    const result = ticketCommand(["view", "TR-404"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("Ticket TR-404 does not exist.\n");
    expect(result.stdout).toBe("");
  });
});

describe("taro ticket search", { timeout: CLI_TIMEOUT_MS }, () => {
  it("matches case-insensitively over title, description and notes, with -s", () => {
    fullTicket();
    const ids = (args: string[]) => (JSON.parse(ok(["search", ...args, "--json"]).stdout).tickets as { id: string }[]).map((entry) => entry.id);
    expect(ids(["LOGIN"])).toEqual(["TR-001"]);
    expect(ids(["wrong PAGE"])).toEqual(["TR-001"]);
    expect(ids(["milestone"])).toEqual(["TR-001"]);
    expect(ids(["thing"])).toEqual(["TR-002"]);
    expect(ids(["child", "-s", "Planning"])).toEqual(["TR-001.01"]);
    expect(ids(["child", "-s", "Done"])).toEqual([]);
    expect(ids(["no such text anywhere"])).toEqual([]);
  });

  it("prints plain results and 'No tickets.' for no match", () => {
    fullTicket();
    expect(ok(["search", "login", "--plain"]).stdout).toContain("TR-001 [In Progress] Fix login redirect");
    expect(ok(["search", "zzz", "--plain"]).stdout).toBe("No tickets.\n");
  });
});

describe("taro ticket create", { timeout: CLI_TIMEOUT_MS }, () => {
  it("prints Created <ID>, then a child via -p gets <parent>.01", () => {
    expect(ok(["create", "First"]).stdout).toBe("Created TR-001\n");
    expect(ok(["create", "Second", "-p", "TR-001"]).stdout).toBe("Created TR-001.01\n");
    expect(ok(["create", "Third", "-p", "TR-001"]).stdout).toBe("Created TR-001.02\n");
    expect(readTicket("TR-001.01")).toMatchObject({ parent: "TR-001", title: "Second", status: "Queued" });
  });

  it("takes -l a,b, repeated -l, --dep lists, --priority and -s", () => {
    ok(["create", "Dep"]);
    ok(["create", "Dep two"]);
    ok(["create", "Dep three"]);
    ok(["create", "One", "-l", "a,b", "-l", "c", "--dep", "TR-001,TR-002", "--dep", "TR-003", "--priority", "low", "-s", "Planning", "-d", "text"]);
    expect(readTicket("TR-004")).toMatchObject({
      labels: ["a", "b", "c"],
      dependsOn: ["TR-001", "TR-002", "TR-003"],
      priority: "low",
      status: "Planning",
      description: "text",
    });
  });

  it("stores $1, quotes, newlines and emoji verbatim", () => {
    const title = `Price $1 "quoted" 'single' $& $$ 🚀`;
    const description = `line one $1\nline "two" 'x' \`tick\` 🎉\n\n  indented \\ backslash $HOME`;
    ok(["create", title, "-d", description]);
    ok(["edit", "TR-001", "--plan", description, "--append-notes", description]);
    const ticket = readTicket("TR-001");
    expect(ticket.title).toBe(title);
    expect(ticket.description).toBe(description);
    expect(ticket.plan).toBe(description);
    expect(ticket.notes).toBe(description);
  });

  it("accepts options before the title and a title after --", () => {
    const result = taro(["ticket", "create", "--tracker", tracker, "-d", "x", "--", "-dash title"]);
    expect(result).toMatchObject({ code: 0, stdout: "Created TR-001\n" });
    expect(readTicket("TR-001").title).toBe("-dash title");
  });

  it("reports --json {ticket}", () => {
    expect(JSON.parse(ok(["create", "J", "--json"]).stdout).ticket).toMatchObject({ id: "TR-001", title: "J" });
  });
});

describe("taro ticket edit", { timeout: CLI_TIMEOUT_MS }, () => {
  beforeEach(() => {
    fullTicket();
  });

  it("-s sets the status", () => {
    expect(ok(["edit", "TR-002", "-s", "Planning"]).stdout).toBe("Updated TR-002\n");
    expect(readTicket("TR-002").status).toBe("Planning");
  });

  it("-t and --title set the title", () => {
    ok(["edit", "TR-002", "-t", "New one"]);
    expect(readTicket("TR-002").title).toBe("New one");
    ok(["edit", "TR-002", "--title", "Newer"]);
    expect(readTicket("TR-002").title).toBe("Newer");
  });

  it("-d sets the description", () => {
    ok(["edit", "TR-002", "-d", "described"]);
    expect(readTicket("TR-002").description).toBe("described");
  });

  it("--plan and --final-summary set their sections", () => {
    ok(["edit", "TR-002", "--plan", "the plan"]);
    ok(["edit", "TR-002", "--final-summary", "the final"]);
    expect(readTicket("TR-002")).toMatchObject({ plan: "the plan", finalSummary: "the final" });
  });

  it("--add-label and --remove-label, comma lists too", () => {
    ok(["edit", "TR-001", "--add-label", "x,y", "--add-label", "z"]);
    expect(readTicket("TR-001").labels).toEqual(["bug", "web", "x", "y", "z"]);
    ok(["edit", "TR-001", "--remove-label", "bug", "--remove-label", "x,y"]);
    expect(readTicket("TR-001").labels).toEqual(["web", "z"]);
  });

  it("--dep adds dependencies", () => {
    ok(["edit", "TR-002", "--dep", "TR-001,TR-001.01"]);
    expect(readTicket("TR-002").dependsOn).toEqual(["TR-001", "TR-001.01"]);
  });

  it("--remove-dep removes listed dependencies, comma lists too, and ignores one not listed", () => {
    writeTicket({ id: "TR-003", dependsOn: ["TR-001", "TR-002", "TR-001.01"] });
    ok(["edit", "TR-003", "--remove-dep", "TR-001", "--remove-dep", "TR-001.01,TR-009"]);
    expect(readTicket("TR-003").dependsOn).toEqual(["TR-002"]);
  });

  it("--remove-dep clears a stored entry that is not a ticket id, which --dep would refuse", () => {
    writeTicket({ id: "TR-003", dependsOn: ["TR-001 TR-002", "TR-001"] });
    ok(["edit", "TR-003", "--remove-dep", "TR-001 TR-002"]);
    expect(readTicket("TR-003").dependsOn).toEqual(["TR-001"]);
  });

  it("--dep refuses a value joined with spaces and an unknown ticket, and changes nothing", () => {
    const joined = ticketCommand(["edit", "TR-002", "--dep", "TR-001 TR-001.01"]);
    expect(joined.code).toBe(1);
    expect(joined.stderr).toContain('Dependency "TR-001 TR-001.01" is not a ticket id');
    const unknown = ticketCommand(["edit", "TR-002", "--dep", "TR-001,TR-099"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('Dependency "TR-099" names no existing ticket');
    expect(readTicket("TR-002").dependsOn).toEqual([]);
  });

  it("--dep forgives case and stores the ticket's spelling; --remove-dep forgives it when no exact entry matches", () => {
    ok(["edit", "TR-002", "--dep", "tr-001"]);
    expect(readTicket("TR-002").dependsOn).toEqual(["TR-001"]);
    writeTicket({ id: "TR-003", dependsOn: ["tr-001"] });
    ok(["edit", "TR-003", "--remove-dep", "TR-001"]);
    expect(readTicket("TR-003").dependsOn).toEqual([]);
    writeTicket({ id: "TR-004", dependsOn: ["TR-001", "tr-001"] });
    ok(["edit", "TR-004", "--remove-dep", "tr-001"]);
    expect(readTicket("TR-004").dependsOn).toEqual(["TR-001"]);
  });

  it("create refuses a bad --dep and creates nothing", () => {
    const joined = ticketCommand(["create", "New", "--dep", "TR-001 TR-002"]);
    expect(joined.code).toBe(1);
    expect(joined.stderr).toContain("is not a ticket id");
    const unknown = ticketCommand(["create", "New", "--dep", "TR-099"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("names no existing ticket");
    expect(readdirSync(join(tracker, "tickets")).sort()).toEqual(["TR-001.01.md", "TR-001.md", "TR-002.md"]);
  });

  it("--priority sets it", () => {
    ok(["edit", "TR-002", "--priority", "medium"]);
    expect(readTicket("TR-002").priority).toBe("medium");
    expect(ticketCommand(["edit", "TR-002", "--priority", "urgent"]).code).toBe(2);
  });

  it("refuses a record stamped later than the host clock: exit 1, the ticket unchanged (TR-086)", () => {
    const before = readFileSync(fileOf("TR-001"), "utf8");
    const result = ticketCommand(["edit", "TR-001", "--append-notes", "EVIDENCE 2999-01-01T00:00Z — from the future"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^EVIDENCE 2999-01-01T00:00Z is later than the host clock \(now \d{4}-\d\d-\d\dT\d\d:\d\dZ\)\. .*date -u/);
    expect(readFileSync(fileOf("TR-001"), "utf8")).toBe(before);
    ok(["edit", "TR-001", "--append-notes", `MILESTONE ${new Date().toISOString().slice(0, 16)}Z — on time`]);
  });

  it("--append-notes appends each record after a blank line", () => {
    ok(["edit", "TR-001", "--append-notes", "second", "--append-notes", "third"]);
    expect(readTicket("TR-001").notes).toBe("MILESTONE one\n\nsecond\n\nthird");
  });

  it("--check-ac and --uncheck-ac flip criteria; an unknown number fails with exit 1", () => {
    ok(["edit", "TR-001", "--check-ac", "2", "--uncheck-ac", "1"]);
    expect(readTicket("TR-001").criteria.map((criterion) => criterion.checked)).toEqual([false, true]);
    ok(["edit", "TR-001", "--check-ac", "1,2"]);
    expect(readTicket("TR-001").criteria.every((criterion) => criterion.checked)).toBe(true);
    const missing = ticketCommand(["edit", "TR-001", "--check-ac", "9"]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toBe("TR-001 has no acceptance criterion #9.\n");
    expect(ticketCommand(["edit", "TR-001", "--check-ac", "x"]).code).toBe(2);
  });

  it("applies every flag in one call, as one write", () => {
    const before = readTicket("TR-001").updated;
    ok([
      "edit", "TR-001", "-s", "Reviewing", "-t", "All at once", "-d", "d", "--plan", "p", "--final-summary", "f",
      "--add-label", "n", "--remove-label", "bug", "--dep", "TR-001.01", "--priority", "low", "--append-notes", "note",
      "--check-ac", "2", "--uncheck-ac", "1",
    ]);
    const ticket = readTicket("TR-001");
    expect(ticket).toMatchObject({
      status: "Reviewing",
      title: "All at once",
      description: "d",
      plan: "p",
      finalSummary: "f",
      labels: ["web", "n"],
      dependsOn: ["TR-002", "TR-001.01"],
      priority: "low",
      notes: "MILESTONE one\n\nnote",
    });
    expect(ticket.criteria.map((criterion) => criterion.checked)).toEqual([false, true]);
    expect(ticket.updated >= before).toBe(true);
  });

  it("--plain prints the ticket after the edit; --json gives {ticket}", () => {
    const plain = ok(["edit", "TR-002", "-s", "Blocked", "--plain"]).stdout;
    expect(plain).toContain("Status: Blocked");
    expect(plain).toMatch(/Revision: [0-9a-f]{16}/);
    expect(JSON.parse(ok(["edit", "TR-002", "-s", "Cancelled", "--json"]).stdout).ticket.status).toBe("Cancelled");
  });

  it("rejects an unknown status with a usage error and a bad edit with nothing to change", () => {
    expect(ticketCommand(["edit", "TR-002", "-s", "Nope"]).code).toBe(2);
    expect(ticketCommand(["edit", "TR-002"]).code).toBe(2);
  });

  it("a revision conflict exits 3 naming the current revision and leaves the file unchanged", () => {
    const before = readFileSync(fileOf("TR-001"), "utf8");
    const current = JSON.parse(ok(["view", "TR-001", "--json"]).stdout).ticket.revision;
    const result = ticketCommand(["edit", "TR-001", "--revision", "0000000000000000", "-t", "Changed"]);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain(current);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(readFileSync(fileOf("TR-001"), "utf8")).toBe(before);
    expect(ticketCommand(["edit", "TR-001", "--revision", current, "-t", "Changed"]).code).toBe(0);
    expect(readTicket("TR-001").title).toBe("Changed");
  });

  it("a missing ticket exits 1 with one line naming it", () => {
    const result = ticketCommand(["edit", "TR-404", "-s", "Done"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("Ticket TR-404 does not exist.\n");
  });
});

describe("usage errors", { timeout: CLI_TIMEOUT_MS }, () => {
  it("exit 2 with usage on stderr for an unknown flag, verb, command, or missing argument", () => {
    for (const args of [
      ["ticket", "list", "--bogus", "--tracker", tracker],
      ["ticket", "frobnicate", "--tracker", tracker],
      ["ticket", "--tracker", tracker],
      ["ticket", "view", "--tracker", tracker],
      ["ticket", "create", "--tracker", tracker],
      ["ticket", "list", "-s", "--tracker", tracker],
      ["bogus"],
      [],
    ]) {
      const result = taro(args);
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.stderr, args.join(" ")).toContain("Usage:");
      expect(result.stdout).toBe("");
    }
  });

  it("exits 2 with no tracker given (no --tracker, TARO_TRACKER unset)", () => {
    const result = taro(["ticket", "list"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("No tracker");
    expect(result.stderr).toContain("Usage:");
  });
});

describe("taro ticket check", { timeout: CLI_TIMEOUT_MS }, () => {
  it("prints 0 problems and exits 0 for a clean tracker", () => {
    fullTicket();
    writeFileSync(join(tracker, "tracker.json"), '{"schema":1,"prefix":"TR","padding":3,"lastId":2,"lastChild":{}}\n');
    const result = ticketCommand(["check"]);
    expect(result).toEqual({ code: 0, stdout: "0 problems\n", stderr: "" });
    expect(ok(["check", "--json"]).stdout).toBe(JSON.stringify({ problems: [] }, null, 2) + "\n");
  });

  it("prints tickets/X.md:<line>: <message> for each bad file and exits 1", () => {
    fullTicket();
    const good = readFileSync(fileOf("TR-002"), "utf8");
    writeFileSync(fileOf("TR-003"), good.replace('id: "TR-002"', 'id: "TR-999"'));
    writeFileSync(fileOf("TR-004"), "no frontmatter at all\n");
    const result = ticketCommand(["check"]);
    expect(result.code).toBe(1);
    const lines = result.stdout.trim().split("\n");
    expect(lines.at(-1)).toBe(`${lines.length - 1} problems`);
    expect(lines.filter((line) => /^tickets\/TR-003\.md:\d+: .+/.test(line))).toHaveLength(1);
    expect(lines.some((line) => /^tickets\/TR-004\.md:\d+: .+/.test(line))).toBe(true);
    expect(lines.some((line) => line.startsWith("tickets/TR-002.md"))).toBe(false);
    const parsed = JSON.parse(ticketCommand(["check", "--json"]).stdout);
    expect(parsed.problems[0]).toMatchObject({ file: "tickets/TR-003.md" });
  });

  it("reports a dependency that is not a ticket id or names no ticket, on its depends_on line", () => {
    fullTicket();
    writeTicket({ id: "TR-003", dependsOn: ["TR-001", "TR-001 TR-002", "TR-099"] });
    const result = ticketCommand(["check"]);
    expect(result.code).toBe(1);
    const line = readFileSync(fileOf("TR-003"), "utf8").split("\n").findIndex((text) => text.startsWith("depends_on:")) + 1;
    expect(result.stdout).toBe(
      `tickets/TR-003.md:${line}: depends on "TR-001 TR-002", which is not a ticket id\n` +
        `tickets/TR-003.md:${line}: depends on "TR-099", which names no existing ticket\n2 problems\n`,
    );
    expect(JSON.parse(ticketCommand(["check", "--json"]).stdout).problems).toHaveLength(2);
  });

  it("does not call a dependency on an unparseable ticket, or one differing in case, missing", () => {
    fullTicket();
    writeFileSync(fileOf("TR-003"), "no frontmatter at all\n");
    writeTicket({ id: "TR-004", dependsOn: ["TR-003", "tr-001"] });
    const result = ticketCommand(["check"]);
    expect(result.stdout).toContain("tickets/TR-003.md");
    expect(result.stdout).not.toContain("TR-004.md");
    expect(result.stdout).toMatch(/\n1 problem\n$/);
  });

  it("reports a bad tracker.json", () => {
    fullTicket();
    writeFileSync(join(tracker, "tracker.json"), '{"schema":1,\n"prefix":\n');
    const result = ticketCommand(["check"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^tracker\.json:\d+: not valid JSON\n1 problem\n$/);
    writeFileSync(join(tracker, "tracker.json"), '{"schema":1}\n');
    expect(ticketCommand(["check"]).stdout).toContain("tracker.json:1: needs");
  });
});

/** The command lines of the fenced block in skill/reference/tickets.md, read from the file itself. */
function documentedLines(): string[] {
  const text = readFileSync(resolve(import.meta.dirname, "..", "skill", "reference", "tickets.md"), "utf8");
  const block = /```bash\n([\s\S]*?)```/.exec(text)?.[1] ?? "";
  return block.split("\n").filter((line) => line.startsWith("taro "));
}

describe("the command lines in skill/reference/tickets.md", { timeout: CLI_TIMEOUT_MS }, () => {
  it("run successfully, as written, against a temp tracker", { timeout: DOCUMENTED_LINES_TIMEOUT_MS }, () => {
    writeTicket({
      id: "TR-010",
      title: "Parent",
      criteria: [{ index: 1, text: "An older criterion", checked: false }],
    });
    writeTicket({ id: "TR-011", title: "Dependency" });
    writeTicket({
      id: "TR-012",
      title: "Fix login",
      description: "login",
      criteria: [{ index: 1, text: "An older criterion", checked: false }],
    });
    const lines = documentedLines();
    expect(lines.length).toBeGreaterThanOrEqual(10);
    for (const verb of ["list", "view", "search", "create", "edit", "check"]) {
      expect(lines.some((line) => line.startsWith(`taro ticket ${verb}`)), verb).toBe(true);
    }
    for (const documented of lines) {
      // Documented ids are examples (SH-…); the tracker's are TR-…. [optional] parts are used as written.
      const id = /\b(?:SH|TR)-\d+/.exec(documented)?.[0].replace("SH", "TR");
      const revision = id === undefined ? "" : JSON.parse(ok(["view", id, "--json"]).stdout).ticket.revision;
      const line = documented
        .replace(/\s+#.*$/, "")
        .replace(/\[([^\]]*)\]/g, "$1")
        .replace(/\bSH-/g, "TR-")
        .replace("<rev>", revision);
      // The lines are shell; run each through sh with `taro` pointing at bin/taro.
      const result = spawnSync("sh", ["-c", `taro() { "${BIN}" "$@" --tracker "${tracker}"; }; ${line}`], { encoding: "utf8" });
      expect(result.stderr, line).toBe("");
      expect(result.status, line).toBe(0);
    }
    expect(readdirSync(join(tracker, "tickets")).filter((name) => name.startsWith("TR-010.")).sort()).toEqual(["TR-010.01.md", "TR-010.md"]);
    expect(readTicket("TR-012")).toMatchObject({ status: "Planning", plan: "<plan>", finalSummary: "<FINAL>" });
    expect(readTicket("TR-012").criteria[0]?.checked).toBe(true);
  });
});

describe("Accept guard (TR-237)", () => {
  it("refuses an agent's ACCEPTANCE and Done on a delivered ticket with no Accept", () => {
    ok(["create", "T", "-s", "Awaiting acceptance"]);
    const id = readdirSync(join(tracker, "tickets"))[0]!.replace(".md", "");
    const done = ticketCommand(["edit", id, "-s", "Done"]);
    expect(done.code).toBe(2);
    expect(done.stderr).toMatch(/press of Accept/);
    expect(ticketCommand(["edit", id, "--append-notes", "ACCEPTANCE x"]).code).toBe(2);
    expect(readTicket(id).status).toBe("Awaiting acceptance");
  });
}, CLI_TIMEOUT_MS);

describe("taro next", { timeout: CLI_TIMEOUT_MS }, () => {
  const TOKEN = "A".repeat(43);
  let home = "";
  const previousHome = process.env.PASEO_HOME;
  let requests: { method: string; input: { project: string; ticket: string } }[] = [];

  /** Plays the daemon, answering `taro.ticket.next-step` with the plugin's own handler over the scratch tracker. */
  function stubDaemon(): void {
    requests = [];
    class FakeWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
      send(data: string) {
        const sent = JSON.parse(data) as Record<string, any>;
        if (sent.type === "hello") {
          queueMicrotask(() => this.say({ type: "status", payload: { status: "server_info", protocolVersion: 1 } }));
          return;
        }
        const { requestId, method, input } = sent.message;
        requests.push({ method, input });
        void nextStepAnswer(input.project, input.ticket).then((output) => this.say({ type: "plugin.rpc.invoke.response", payload: { requestId, output } }));
      }
      say(message: unknown) {
        this.onmessage?.({ data: JSON.stringify({ type: "session", message }) });
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
  }

  async function next(args: string[], env: Record<string, string> = { TARO_PROJECT: "notes-app" }) {
    let stdout = "";
    let stderr = "";
    const code = await main(["next", ...args], { stdout: (text) => void (stdout += text), stderr: (text) => void (stderr += text), env: { PASEO_HOME: home, ...env } });
    return { code, stdout, stderr };
  }

  beforeEach(() => {
    project.tracker = tracker;
    home = join(scratch, "paseo");
    mkdirSync(home);
    writeFileSync(join(home, "paseo.pid"), JSON.stringify({ pid: 1, listen: "127.0.0.1:9" }));
    writeFileSync(join(home, "local-credential"), `${TOKEN}\n`);
    process.env.PASEO_HOME = home;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
  });

  it("prints the build page for a plan approved while no turn end saw it, as the plugin would send it", async () => {
    stubDaemon();
    writeTicket({ id: "TR-020", status: "In Progress", labels: ["complexity-medium"], plan: "## Goal\nExport notes", notes: 'APPROVAL 2026-10-01T10:30Z — user: "Approve the plan for TR-020"' });
    const result = await next(["TR-020"]);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(requests).toEqual([{ method: "taro.ticket.next-step", input: { project: "notes-app", ticket: "TR-020" } }]);
    expect(result.stdout).toContain("TR-020's plan is approved: build it.");
    expect(result.stdout).toContain("# Build");
    expect(result.stdout).toBe(`${(await currentStep("notes-app", "TR-020"))?.text}\n`);
  });

  it("prints a high ticket's children in build order, and the delivery gaps once the review is clean", async () => {
    stubDaemon();
    writeTicket({ id: "TR-030", status: "In Progress", labels: ["complexity-high"], plan: "## Goal\nx", notes: 'APPROVAL 2026-10-01T10:30Z — user: "Approve"' });
    writeTicket({ id: "TR-030.01", title: "CSV writer", parent: "TR-030", dependsOn: ["TR-030.02"] });
    writeTicket({ id: "TR-030.02", title: "Export button", parent: "TR-030" });
    expect((await next(["TR-030"])).stdout).toContain("1. TR-030.02 — Export button (Queued)\n2. TR-030.01 — CSV writer (Queued)");

    writeTicket({ id: "TR-031", status: "Reviewing", labels: ["complexity-medium"], plan: "## Goal\nx", notes: 'APPROVAL 2026-10-01T10:30Z — user: "Approve"\n\nREVIEW 2026-10-01T12:00Z — reviewer r1: no findings — verdict: clean' });
    const delivery = (await next(["TR-031"])).stdout;
    expect(delivery).toContain("TR-031's review is clean: deliver it.");
    expect(delivery).toContain("- the ticket records no review-head\n- the ticket records no PR URL");
    expect(delivery).toContain("# Delivery");
  });

  it("says when there is no step, as for a ticket not rated yet", async () => {
    stubDaemon();
    writeTicket({ id: "TR-040", status: "Planning" });
    expect((await next(["TR-040"])).stdout).toBe("TR-040 has no step to send now: it is not rated yet (add its complexity- label), closed, or waiting for the user's Accept.\n");
  });

  it("needs a ticket id and a project, and says when the daemon is not reachable", async () => {
    stubDaemon();
    expect((await next([])).code).toBe(2);
    expect((await next(["TR-020"], {})).stderr).toContain("No project");
    rmSync(join(home, "paseo.pid"));
    const down = await next(["TR-020"]);
    expect(down.code).toBe(4);
    expect(down.stderr).toContain("Cannot reach the Paseo daemon");
  });
});

// ---------------------------------------------------------------- the owner's mechanical steps (TR-263)

const OWNER = "0f1e2d3c-4b5a-4968-8776-655443322110";
const STUB_AGENT = "11111111-2222-4333-8444-555555555555";

/**
 * A scratch world for the owner's commands: a git repository on `taro/tr-050` with one commit, the
 * project's `taro.json` beside the tracker, the plugin data folder, and stub `paseo` and `gh` first on
 * PATH that log their arguments and answer as `STUB_GH` says.
 */
function ownerWorld() {
  const repo = join(scratch, "notes-app");
  const bin = join(scratch, "bin");
  const data = join(scratch, "data");
  const cgroup = join(scratch, "cgroup");
  const calls = join(scratch, "calls.log");
  for (const directory of [repo, bin, cgroup, join(data, "evidence", "notes-app")]) mkdirSync(directory, { recursive: true });
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", repo, "-c", "user.name=Alex", "-c", "user.email=alex@example.com", ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "notes.txt"), "one\n");
  git("add", "notes.txt");
  git("commit", "-q", "-m", "first");
  git("checkout", "-q", "-b", "taro/tr-050");
  writeFileSync(join(repo, "notes.txt"), "two\n");
  git("commit", "-q", "-am", "second");
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n{ echo "=== ${name}"; for a in "$@"; do echo "$a"; done; } >> "${calls}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub("paseo", `case "$1" in run) echo '{"agentId":"${STUB_AGENT}","status":"running","cwd":"/tmp/wt"}';; archive) echo archived;; esac`);
  stub(
    "gh",
    [
      'case "$STUB_GH" in',
      `  ok) echo "{\\"url\\":\\"https://github.com/example/notes-app/pull/9\\",\\"headRefOid\\":\\"$STUB_GH_HEAD\\",\\"state\\":\\"OPEN\\"}";;`,
      '  none) echo \'no pull requests found for branch "taro/tr-050"\' >&2; exit 1;;',
      "  *) echo 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' >&2; exit 1;;",
      "esac",
    ].join("\n"),
  );
  writeFileSync(join(cgroup, "pids.max"), "2048\n");
  writeFileSync(join(cgroup, "pids.current"), "1000\n");
  writeFileSync(join(scratch, "taro.json"), JSON.stringify({ project: "notes-app", delivery: "pull-request", acceptAlsoMerges: true, subagentModels: ["claude/claude-haiku-5-5", "claude/claude-opus-5-5"] }));
  const env = (extra: Record<string, string> = {}) => ({
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    TARO_PROJECT: "notes-app",
    TARO_TRACKER: tracker,
    TARO_SKILL: "/home/user/skill",
    TARO_EVIDENCE: join(data, "evidence", "notes-app"),
    TARO_CGROUP_DIRECTORY: cgroup,
    PASEO_AGENT_ID: OWNER,
    ...extra,
  });
  const run = (args: string[], extra: Record<string, string> = {}): Result => {
    const clean = { ...process.env };
    for (const key of ["TARO_TRACKER", "TARO_PROJECT", "TARO_EVIDENCE", "PASEO_AGENT_ID", "PASEO_HOME", "PASEO_CLI"]) delete clean[key];
    const result = spawnSync(BIN, args, { cwd: repo, encoding: "utf8", env: { ...clean, ...env(extra) }, timeout: 60_000 });
    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  };
  const callLog = () => (existsSync(calls) ? readFileSync(calls, "utf8") : "");
  const invocations = (name: string) =>
    callLog()
      .split("=== ")
      .filter((block) => block.startsWith(`${name}\n`))
      .map((block) => block.split("\n").slice(1, -1));
  return { repo, data, cgroup, git, run, callLog, invocations, head: () => git("rev-parse", "HEAD") };
}

const EXECUTION_LINE = `EXECUTION 2026-11-01T10:00Z — owner ${OWNER} (claude/claude-sonnet-5-5), workspace wks_abc, branch taro/tr-050, host devbox`;
const COMPLETE_EVIDENCE = "EVIDENCE 2026-11-01T11:00Z — verified\ncheck: npm test — 12 passed\nreview: clean (independent reviewer)\nscreenshots: none — no visible change";
const FINAL_TEXT = "## What changed\n- Notes keep their order.\n\nRevision: <full SHA> on <branch> · PR: <URL>";

function deliverableTicket(overrides: Partial<Ticket> = {}): void {
  writeTicket({ id: "TR-050", title: "Keep note order", status: "In Progress", notes: `${EXECUTION_LINE}\n\n${COMPLETE_EVIDENCE}`, finalSummary: FINAL_TEXT, ...overrides });
}

describe("taro agent", { timeout: CLI_TIMEOUT_MS }, () => {
  it("starts a subagent with the Taro labels, env and title, and records it in EXECUTION", () => {
    const world = ownerWorld();
    deliverableTicket();
    writeFileSync(join(scratch, "brief.md"), "--- You are the implementer.\nBuild it.\n");
    const result = world.run(["agent", "start", "implementer", "tr-050", "--model", "claude/claude-haiku-5-5", "--thinking", "low", "--brief-file", join(scratch, "brief.md"), "--task", "building the order fix"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const [args] = world.invocations("paseo");
    expect(args).toEqual([
      "run",
      "--no-wait",
      "--provider",
      "claude/claude-haiku-5-5",
      "--thinking",
      "low",
      "--mode",
      "bypassPermissions",
      "--title",
      "TR-050 · implementer: building the order fix",
      "--label",
      "taro.project=notes-app",
      "--label",
      "taro.role=implementer",
      "--label",
      "taro.ticket=TR-050",
      "--env",
      `TARO_TRACKER=${tracker}`,
      "--env",
      "TARO_PROJECT=notes-app",
      "--env",
      "TARO_SKILL=/home/user/skill",
      "--json",
      "--",
      "--- You are the implementer.",
      "Build it.",
    ]);
    expect(readTicket("TR-050").notes).toMatch(new RegExp(`\\nEXECUTION \\S+Z — implementer ${STUB_AGENT} started with taro agent start: claude/claude-haiku-5-5, thinking low; building the order fix$`));
  });

  it("branches its own worktree from the current branch with --worktree", () => {
    const world = ownerWorld();
    deliverableTicket();
    writeTicket({ id: "TR-050.01", title: "Child", parent: "TR-050", status: "In Progress" });
    writeFileSync(join(scratch, "brief.md"), "Build the child.");
    expect(world.run(["agent", "start", "implementer", "TR-050.01", "--model", "claude/claude-opus-5-5", "--brief-file", join(scratch, "brief.md"), "--worktree"]).code).toBe(0);
    const [args] = world.invocations("paseo");
    expect(args?.join(" ")).toContain("--new-workspace worktree --worktree-mode branch-off --new-branch taro/tr-050.01 --base taro/tr-050 --worktree-slug tr-050.01");
    expect(readTicket("TR-050.01").notes).toContain("; own worktree /tmp/wt");
  });

  it("refuses at 86% of the threads once the wait is over, starting nothing", () => {
    const world = ownerWorld();
    deliverableTicket();
    writeFileSync(join(scratch, "brief.md"), "Build it.");
    writeFileSync(join(world.cgroup, "pids.current"), "1762\n");
    const result = world.run(["agent", "start", "reviewer", "TR-050", "--model", "claude/claude-opus-5-5", "--brief-file", join(scratch, "brief.md"), "--wait", "0"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("threads are at 86% (1762 of 2048), above 85%");
    expect(world.invocations("paseo")).toEqual([]);
    expect(readTicket("TR-050").notes).not.toContain("taro agent start");
  });

  it("refuses a model outside the project's list and a job that is not a subagent's", () => {
    const world = ownerWorld();
    deliverableTicket();
    writeFileSync(join(scratch, "brief.md"), "Build it.");
    const model = world.run(["agent", "start", "implementer", "TR-050", "--model", "claude/claude-sonnet-5-5", "--brief-file", join(scratch, "brief.md")]);
    expect(model.code).toBe(1);
    expect(model.stderr).toContain("not one of the project's subagent models: claude/claude-haiku-5-5, claude/claude-opus-5-5");
    expect(world.run(["agent", "start", "helper", "TR-050", "--model", "claude/claude-opus-5-5", "--brief-file", join(scratch, "brief.md")]).code).toBe(2);
    expect(world.invocations("paseo")).toEqual([]);
  });

  it("archives an agent with stop", () => {
    const world = ownerWorld();
    const result = world.run(["agent", "stop", STUB_AGENT]);
    expect(result.code).toBe(0);
    expect(world.invocations("paseo")).toEqual([["archive", STUB_AGENT]]);
  });
});

describe("taro check and taro deliver", { timeout: CLI_TIMEOUT_MS }, () => {
  it("delivers a local branch: review-head, revision line, Awaiting acceptance; again on the same head writes nothing", () => {
    const world = ownerWorld();
    writeFileSync(join(scratch, "taro.json"), JSON.stringify({ delivery: "local" }));
    deliverableTicket();
    const head = world.head();
    const first = world.run(["deliver", "TR-050"]);
    expect(first.stderr).toBe("");
    expect(first.code).toBe(0);
    const delivered = readTicket("TR-050");
    expect(delivered.status).toBe("Awaiting acceptance");
    expect(delivered.notes).toMatch(new RegExp(`EXECUTION \\S+Z — delivered with taro deliver: review-head: ${head}$`));
    expect(delivered.finalSummary).toBe(`## What changed\n- Notes keep their order.\n\nRevision: ${head} on taro/tr-050 · PR: none (local-only)`);
    expect(world.invocations("gh")).toEqual([]);
    const again = world.run(["deliver", "TR-050"]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("already delivered");
    expect(readTicket("TR-050")).toEqual(delivered);
  });

  it("delivers a pull request with the PR and head gh reads", () => {
    const world = ownerWorld();
    deliverableTicket();
    const head = world.head();
    const result = world.run(["deliver", "TR-050"], { STUB_GH: "ok", STUB_GH_HEAD: head });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(world.invocations("gh")).toEqual([["pr", "view", "taro/tr-050", "--json", "url,headRefOid,state"]]);
    const ticket = readTicket("TR-050");
    expect(ticket.notes).toContain(`delivered with taro deliver: pr: https://github.com/example/notes-app/pull/9; review-head: ${head}`);
    expect(ticket.finalSummary).toContain(`Revision: ${head} on taro/tr-050 · PR: https://github.com/example/notes-app/pull/9`);
    expect(ticket.status).toBe("Awaiting acceptance");
  });

  it("refuses with the missing list when there is no PR, or the pushed head is older, writing nothing", () => {
    const world = ownerWorld();
    deliverableTicket();
    const before = readFileSync(fileOf("TR-050"), "utf8");
    const none = world.run(["deliver", "TR-050"], { STUB_GH: "none" });
    expect(none.code).toBe(1);
    expect(none.stderr).toContain("TR-050 is not delivered; nothing was written. Accept would refuse it without:\n- a pull request for taro/tr-050: push it and open one");
    expect(none.stderr).toContain("- the ticket records no PR URL");
    const behind = world.run(["deliver", "TR-050"], { STUB_GH: "ok", STUB_GH_HEAD: "d".repeat(40) });
    expect(behind.code).toBe(1);
    expect(behind.stderr).toContain("- the pushed head: https://github.com/example/notes-app/pull/9 is at dddddddddd");
    expect(readFileSync(fileOf("TR-050"), "utf8")).toBe(before);
  });

  it("refuses on a gh failure, writing nothing", () => {
    const world = ownerWorld();
    deliverableTicket();
    const before = readFileSync(fileOf("TR-050"), "utf8");
    const result = world.run(["deliver", "TR-050"], { STUB_GH: "fail" });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("Cannot read taro/tr-050's pull request with gh (nothing was written): HTTP 502: Bad Gateway (https://api.github.com/graphql)\n");
    expect(readFileSync(fileOf("TR-050"), "utf8")).toBe(before);
  });

  it("refuses missing evidence and uncommitted changes with the list", () => {
    const world = ownerWorld();
    deliverableTicket({ notes: EXECUTION_LINE });
    writeFileSync(join(world.repo, "notes.txt"), "three\n");
    const result = world.run(["deliver", "TR-050"], { STUB_GH: "ok", STUB_GH_HEAD: world.head() });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("- a clean taro/tr-050: ");
    expect(result.stderr).toContain("- an EVIDENCE record\n");
    expect(readTicket("TR-050").status).toBe("In Progress");
  });

  it("delivers an investigation without git or gh", () => {
    const world = ownerWorld();
    deliverableTicket({ labels: ["investigation"], notes: `${EXECUTION_LINE}\n\nEVIDENCE 2026-11-01T11:00Z — read\ncheck: reading the code — three gaps`, finalSummary: "## Findings\n- Three gaps." });
    const result = world.run(["deliver", "TR-050"], { STUB_GH: "fail" });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(world.invocations("gh")).toEqual([]);
    expect(readTicket("TR-050")).toMatchObject({ status: "Awaiting acceptance", finalSummary: "## Findings\n- Three gaps." });
  });

  it("is the owner's: refused outside an agent session and to another agent", () => {
    const world = ownerWorld();
    deliverableTicket();
    expect(world.run(["deliver", "TR-050"], { PASEO_AGENT_ID: "" }).stderr).toContain("taro deliver is the ticket owner's");
    expect(world.run(["deliver", "TR-050"], { PASEO_AGENT_ID: STUB_AGENT }).stderr).toContain(`no EXECUTION record of TR-050 or its parent names ${STUB_AGENT} as owner`);
    expect(readTicket("TR-050").status).toBe("In Progress");
  });

  it("logs checks and offers them; --evidence-from-checks records them as EVIDENCE check lines", () => {
    const world = ownerWorld();
    writeFileSync(join(scratch, "taro.json"), JSON.stringify({ delivery: "local" }));
    deliverableTicket();
    const passing = world.run(["check", "--", "sh", "-c", "echo building; echo ' Tests  14 passed (14)'; echo done-ish"]);
    expect(passing.code).toBe(0);
    expect(passing.stdout).toContain("Tests  14 passed");
    expect(passing.stderr).toContain("[taro] logged for TR-050 at ");
    const failing = world.run(["check", "--", "sh -c 'echo \"1 failed\" >&2; exit 3'"]);
    expect(failing.code).toBe(3);
    const log = readFileSync(join(world.data, "state", "check-logs", "notes-app", "TR-050.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(log.map((entry) => [entry.command, entry.exitCode, entry.summary, entry.head])).toEqual([
      ["sh -c echo building; echo ' Tests  14 passed (14)'; echo done-ish", 0, "Tests 14 passed (14)", world.head()],
      [`sh -c 'echo "1 failed" >&2; exit 3'`, 3, "1 failed", world.head()],
    ]);
    const offered = world.run(["deliver", "TR-050"]);
    expect(offered.code).toBe(0);
    expect(offered.stdout).toContain("pass --evidence-from-checks to record them as EVIDENCE check: lines:\n  check: sh -c echo building; echo ' Tests  14 passed (14)'; echo done-ish — exit 0; Tests 14 passed (14)");
    expect(readTicket("TR-050").notes).not.toContain("check lines from the check log");
    const confirmed = world.run(["deliver", "TR-050", "--evidence-from-checks"]);
    expect(confirmed.code).toBe(0);
    const notes = readTicket("TR-050").notes;
    expect(notes).toContain("check lines from the check log (taro check)");
    expect(notes).toContain(`check: sh -c 'echo "1 failed" >&2; exit 3' — exit 3; 1 failed`);
    expect(notes).toContain("check: npm test — 12 passed\nreview: clean (independent reviewer)\nscreenshots: none — no visible change");
  });

  it("checks the ticket the branch names, or --ticket, and needs one", () => {
    const world = ownerWorld();
    world.git("checkout", "-q", "main");
    expect(world.run(["check", "--", "true"]).code).toBe(2);
    expect(world.run(["check", "--ticket", "TR-051", "--", "true"]).code).toBe(0);
    expect(existsSync(join(world.data, "state", "check-logs", "notes-app", "TR-051.jsonl"))).toBe(true);
  });
});

describe("taro daemon", { timeout: CLI_TIMEOUT_MS }, () => {
  it("never touches the real daemon's port or home", () => {
    const world = ownerWorld();
    const port = world.run(["daemon", "start", "TR-050", "--port", "6767"]);
    expect(port.code).toBe(1);
    expect(port.stderr).toContain("Port 6767 is the real Paseo daemon's");
    const home = world.run(["daemon", "start", "TR-050", "--home", join(homedir(), ".paseo")]);
    expect(home.code).toBe(1);
    expect(home.stderr).toContain("real Paseo daemon's home");
    const configured = world.run(["daemon", "start", "TR-050", "--home", "/tmp/paseo-real"], { PASEO_HOME: "/tmp/paseo-real" });
    expect(configured.stderr).toContain("real Paseo daemon's home (/tmp/paseo-real)");
    expect(world.invocations("paseo")).toEqual([]);
  });

  it("lists none, and stops none, for a ticket that recorded none", () => {
    const world = ownerWorld();
    expect(world.run(["daemon", "list", "TR-050"]).stdout).toBe("TR-050 has no recorded test daemon.\n");
    expect(world.run(["daemon", "stop", "TR-050"]).stdout).toBe("TR-050 has no recorded test daemon.\n");
  });
});
