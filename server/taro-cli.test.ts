import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseTicket, serializeTicket, type Ticket } from "../shared/ticket-format";

const BIN = resolve(import.meta.dirname, "..", "bin", "taro");

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

describe("bin/taro", () => {
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

describe("taro ticket list", () => {
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

describe("taro ticket view", () => {
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

describe("taro ticket search", () => {
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

describe("taro ticket create", () => {
  it("prints Created <ID>, then a child via -p gets <parent>.01", () => {
    expect(ok(["create", "First"]).stdout).toBe("Created TR-001\n");
    expect(ok(["create", "Second", "-p", "TR-001"]).stdout).toBe("Created TR-001.01\n");
    expect(ok(["create", "Third", "-p", "TR-001"]).stdout).toBe("Created TR-001.02\n");
    expect(readTicket("TR-001.01")).toMatchObject({ parent: "TR-001", title: "Second", status: "Queued" });
  });

  it("takes -l a,b, repeated -l, --dep lists, --priority and -s", () => {
    ok(["create", "Dep"]);
    ok(["create", "One", "-l", "a,b", "-l", "c", "--dep", "TR-001,TR-009", "--dep", "TR-010", "--priority", "low", "-s", "Planning", "-d", "text"]);
    expect(readTicket("TR-002")).toMatchObject({
      labels: ["a", "b", "c"],
      dependsOn: ["TR-001", "TR-009", "TR-010"],
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

describe("taro ticket edit", () => {
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
    ok(["edit", "TR-002", "--dep", "TR-001,TR-003", "--dep", "TR-004"]);
    expect(readTicket("TR-002").dependsOn).toEqual(["TR-001", "TR-003", "TR-004"]);
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
      "--add-label", "n", "--remove-label", "bug", "--dep", "TR-003", "--priority", "low", "--append-notes", "note",
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
      dependsOn: ["TR-002", "TR-003"],
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
    expect(JSON.parse(ok(["edit", "TR-002", "-s", "Done", "--json"]).stdout).ticket.status).toBe("Done");
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

describe("usage errors", () => {
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

describe("taro ticket check", () => {
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

describe("the command lines in skill/reference/tickets.md", () => {
  it("run successfully, as written, against a temp tracker", () => {
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
    expect(readTicket("TR-012")).toMatchObject({ status: "Awaiting acceptance", plan: "<plan>", finalSummary: "<FINAL>" });
    expect(readTicket("TR-012").criteria[0]?.checked).toBe(true);
  });
});
