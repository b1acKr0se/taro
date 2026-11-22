import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { serializeTicket, type Ticket } from "../shared/ticket-format";
import { main } from "./taro-cli.ts";
import { boardCommand } from "./taro-board.ts";
import { createTicketStore } from "./ticket-store.ts";

const BIN = resolve(import.meta.dirname, "..", "bin", "taro");
const ROOT = resolve(import.meta.dirname, "..");
const CLI_TIMEOUT_MS = 30_000;

// Real time: the board reads the clock itself.
const NOW = Date.now();
const HOUR = 3_600_000;
const at = (hoursAgo: number): string => new Date(NOW - hoursAgo * HOUR).toISOString();

let scratch: string;
let paseoHome: string;
let tracker: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "taro-board-"));
  paseoHome = join(scratch, "paseo");
  tracker = join(paseoHome, "plugin-data", "taro", "home", "projects", "notes-app", "tracker");
  mkdirSync(join(tracker, "tickets"), { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeTicket(overrides: Partial<Ticket> & { id: string }): void {
  const ticket: Ticket = {
    title: `Ticket ${overrides.id}`,
    status: "Queued",
    priority: null,
    labels: [],
    parent: null,
    dependsOn: [],
    created: "2026-11-01T10:00:00Z",
    updated: "2026-11-01T10:00:00Z",
    description: "",
    plan: "",
    criteria: [],
    notes: "",
    finalSummary: "",
    extra: {},
    ...overrides,
  };
  writeFileSync(join(tracker, "tickets", `${ticket.id}.md`), serializeTicket(ticket));
}

function card(id: string, askedHoursAgo: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    host: "claude-code",
    question: `Question ${id}?`,
    why: "",
    options: [{ label: "Yes", prompt: "Yes", consequence: "" }],
    recommended: "Yes",
    reason: "",
    askedAt: at(askedHoursAgo),
    status: "open",
    answer: null,
    ...extra,
  });
}

function agent(name: string, startedHoursAgo: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name, host: "claude-code", job: "implementer", task: `doing ${name}`, state: "running", startedAt: at(startedHoursAgo), finishedAt: null, ...extra });
}

function statePath(name: string): string {
  return join(paseoHome, "plugin-data", "taro", "state", name);
}

function writeState(name: string, value: unknown, mtime = new Date(NOW - 60_000)): void {
  mkdirSync(dirname(statePath(name)), { recursive: true });
  writeFileSync(statePath(name), typeof value === "string" ? value : JSON.stringify(value));
  utimesSync(statePath(name), mtime, mtime);
}

interface LiveAgent {
  id: string;
  role: string;
  ticket: string | null;
  title?: string | null;
  state?: string | null;
  text?: string | null;
  at?: string | null;
}

/** The plugin's live list (`live.json`): the project's live agents and the keys of their open cards. */
function writeLive(agents: LiveAgent[], cardKeys: string[], writtenAt = new Date(NOW - 120_000).toISOString(), mtime = new Date(NOW - 60_000)): void {
  writeState(
    "live.json",
    {
      version: 1,
      projects: {
        "notes-app": { project: "notes-app", writtenAt, agents: agents.map((entry) => ({ title: null, state: null, text: null, at: null, ...entry })), cardKeys },
        "other-app": { project: "other-app", writtenAt, agents: [{ id: "other-1", role: "owner", ticket: "OA-001", title: null, state: null, text: null, at: null }], cardKeys: ["agent-9:elsewhere"] },
      },
    },
    mtime,
  );
}

const LIVE_AS_OF = new Date(NOW - 120_000).toISOString();

function decision(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    key: `agent-1:${String(overrides.id ?? "scope-approval")}`,
    id: "scope-approval",
    question: "Approve the plan?",
    why: "",
    blocking: true,
    options: [{ label: "Approve", prompt: "Approve" }],
    recommended: "Approve",
    project: "notes-app",
    ticket: "NA-001",
    agentId: "agent-1",
    agentRole: "owner",
    agentTitle: "NA-001 · Owner",
    askedAt: at(1),
    status: "open",
    answer: null,
    ...overrides,
  };
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function board(args: string[] = [], env: Record<string, string> = {}): Promise<Result> {
  let stdout = "";
  let stderr = "";
  const code = await main(["board", "--project", "notes-app", ...args], {
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    env: { PASEO_HOME: paseoHome, ...env },
  });
  return { code, stdout, stderr };
}

describe("taro board", () => {
  it("empty tracker prints no tickets", async () => {
    const result = await board();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No tickets.");
    expect(JSON.parse((await board(["--json"])).stdout)).toEqual({ tickets: [], paseo: null });
  });

  it("groups by status", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "In Progress", cards: card("colour", 1), agents: agent("impl", 1) });
    writeTicket({ id: "NA-002", title: "Signup", status: "Queued" });
    writeTicket({ id: "NA-003", title: "Export", status: "In Progress" });
    writeTicket({ id: "NA-004", title: "Old", status: "Done" });
    const { stdout, code } = await board();
    expect(code).toBe(0);
    const lines = stdout.split("\n");
    const heading = (name: string) => lines.findIndex((line) => line.startsWith(name));
    expect(heading("Queued (1)")).toBeGreaterThan(-1);
    expect(heading("In Progress (2)")).toBeGreaterThan(heading("Queued (1)"));
    expect(heading("Done (1)")).toBeGreaterThan(heading("In Progress (2)"));
    expect(stdout).toContain("  NA-001 Login");
    expect(stdout).toContain("    card colour: Question colour?");
    expect(stdout).toContain("      answer: taro card answer NA-001 colour --label <option> [--text <words>]");
    expect(stdout).toContain("    agent impl (implementer, running, claude-code): doing impl");
    // An answered card is no longer on the board.
    writeTicket({ id: "NA-001", title: "Login", status: "In Progress", cards: card("colour", 1, { status: "answered", answer: { label: "Yes", text: "", at: at(0), by: "x" } }) });
    expect((await board()).stdout).not.toContain("card colour");
  });

  it("json output has the documented shape", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "In Progress", cards: card("colour", 1), agents: agent("impl", 30) });
    writeState("decisions.json", { decisions: [decision({})] });
    writeLive([], ["agent-1:scope-approval"]);
    const value = JSON.parse((await board(["--json"])).stdout);
    expect(Object.keys(value).sort()).toEqual(["paseo", "tickets"]);
    expect(value.tickets).toEqual([
      {
        id: "NA-001",
        title: "Login",
        status: "In Progress",
        cards: [expect.objectContaining({ id: "colour", key: "tracker:notes-app/NA-001:colour", stale: false, answerCommand: "taro card answer NA-001 colour --label <option> [--text <words>]" })],
        agents: [expect.objectContaining({ name: "impl", stale: true })],
      },
    ]);
    expect(value.paseo).toEqual({
      asOf: LIVE_AS_OF,
      cards: [expect.objectContaining({ key: "agent-1:scope-approval", ticket: "NA-001", id: "scope-approval", question: "Approve the plan?", answerCommand: "taro decision answer agent-1:scope-approval --label <option> [--text <words>]" })],
      agents: [],
    });
  });

  it("lists paseo owner questions", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "Planning" });
    writeState("decisions.json", {
      decisions: [
        decision({}),
        decision({ id: "answered", key: "agent-1:answered", status: "answered" }),
        decision({ id: "elsewhere", key: "agent-9:elsewhere", project: "other-app" }),
        decision({ id: "held", key: "agent-1:held", held: true }),
        decision({ id: "manager-q", key: "manager:manager-q", ticket: null, agentRole: "manager", question: "Which next?" }),
        "not a decision",
      ],
    });
    writeLive([], ["agent-1:scope-approval", "agent-1:answered", "agent-9:elsewhere", "agent-1:held", "manager:manager-q"]);
    const { stdout, stderr, code } = await board();
    expect(code).toBe(0);
    expect(stdout).toContain(`    card scope-approval (via paseo, as of ${LIVE_AS_OF}): Approve the plan?`);
    expect(stdout).toContain("      answer: taro decision answer agent-1:scope-approval --label <option> [--text <words>]");
    expect(stdout).not.toContain("answered");
    expect(stdout).not.toContain("elsewhere");
    expect(stdout).not.toContain("card held");
    expect(stdout).toContain("Not on a ticket");
    expect(stdout).toContain("card manager-q (via paseo");
    expect(stderr).toBe("");
  });

  it("lists paseo subagents", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "In Progress" });
    writeLive(
      [
        { id: "owner-1", role: "owner", ticket: "NA-001", title: "NA-001 · Owner", state: "working", text: "building", at: at(40) },
        { id: "impl-1", role: "implementer", ticket: "NA-001", title: "NA-001 implementer" },
        7 as unknown as LiveAgent,
      ],
      [],
    );
    const { stdout } = await board();
    const asOf = LIVE_AS_OF;
    expect(stdout).toContain(`    agent owner-1 (owner, via paseo, as of ${asOf}): working — building`);
    expect(stdout).toContain(`    agent impl-1 (implementer, via paseo, as of ${asOf})`);
    // Paseo's agents are as the plugin last knew them: never marked stale, however old.
    expect(stdout).not.toMatch(/owner-1.*stale/);
    expect(stdout).not.toContain("other-1");
  });

  it("missing paseo state still prints", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "Queued" });
    const missing = await board();
    expect(missing.code).toBe(0);
    expect(missing.stdout).toContain("Paseo has not written a live list yet");
    expect(missing.stdout).toContain("NA-001 Login");
    writeLive([], []);
    writeState("decisions.json", "{not json");
    const unreadable = await board();
    expect(unreadable.code).toBe(0);
    expect(unreadable.stdout.match(/Paseo state/g)).toHaveLength(1);
    expect(unreadable.stdout).toContain("decisions.json");
    expect(unreadable.stdout).toContain("NA-001 Login");
    expect(JSON.parse((await board(["--json"])).stdout).tickets).toHaveLength(1);
  });

  it("tracker card wins a clash", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "Planning", cards: card("scope-approval", 1) });
    writeState("decisions.json", { decisions: [decision({}), decision({ id: "other", key: "agent-1:other" })] });
    writeLive([], ["agent-1:scope-approval", "agent-1:other"]);
    const value = JSON.parse((await board(["--json"])).stdout);
    expect(value.tickets[0].cards.map((entry: { key: string }) => entry.key)).toEqual(["tracker:notes-app/NA-001:scope-approval"]);
    expect(value.paseo.cards.map((entry: { key: string }) => entry.key)).toEqual(["agent-1:other"]);
    // Only an open tracker card hides Paseo's.
    writeTicket({ id: "NA-001", title: "Login", status: "Planning", cards: card("scope-approval", 1, { status: "withdrawn" }) });
    expect(JSON.parse((await board(["--json"])).stdout).paseo.cards).toHaveLength(2);
  });

  it("board lists only live agents", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "In Progress" });
    // The supervision record keeps archived agents: an old manager and a reviewer that finished.
    writeState("agents.json", {
      agents: {
        "manager-old": { project: "notes-app", role: "manager", ticket: null, title: "Manager", lastStatus: { state: "done", text: "handed over", at: at(50) } },
        "reviewer-done": { project: "notes-app", role: "reviewer", ticket: "NA-001", title: "NA-001 reviewer", lastStatus: { state: "done", text: "findings", at: at(3) } },
        "owner-1": { project: "notes-app", role: "owner", ticket: "NA-001", title: "NA-001 · Owner", lastStatus: { state: "working", text: "building", at: at(1) } },
      },
    });
    // A reviewer just started has no supervision record yet; the live list has it.
    writeLive(
      [
        { id: "owner-1", role: "owner", ticket: "NA-001", state: "working", text: "building", at: at(1) },
        { id: "reviewer-new", role: "reviewer", ticket: "NA-001" },
      ],
      [],
    );
    const { stdout } = await board();
    expect(stdout).toContain(`    agent owner-1 (owner, via paseo, as of ${LIVE_AS_OF}): working — building`);
    expect(stdout).toContain(`    agent reviewer-new (reviewer, via paseo, as of ${LIVE_AS_OF})`);
    expect(stdout).not.toContain("manager-old");
    expect(stdout).not.toContain("reviewer-done");
    expect(JSON.parse((await board(["--json"])).stdout).paseo.agents.map((entry: { id: string }) => entry.id)).toEqual(["owner-1", "reviewer-new"]);
  });

  it("warns when the live list is old", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "In Progress" });
    writeLive([{ id: "owner-1", role: "owner", ticket: "NA-001" }], [], new Date(NOW - 6 * 60_000).toISOString());
    const { stdout } = await board();
    expect(stdout).toContain("the Paseo daemon may be stopped");
    writeLive([{ id: "owner-1", role: "owner", ticket: "NA-001" }], []);
    expect((await board()).stdout).not.toContain("may be stopped");
  });

  it("watch warns when the live list goes stale with no file changed", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "In Progress" });
    // Confirmed 4 minutes 57 seconds ago: old enough in about three seconds, with nothing written meanwhile.
    writeLive([{ id: "owner-1", role: "owner", ticket: "NA-001" }], [], new Date(Date.now() - 297_000).toISOString(), new Date(Date.now() - 297_000));
    const controller = new AbortController();
    let stdout = "";
    const running = boardCommand(
      { store: createTicketStore(tracker), trackerPath: tracker, project: "notes-app", json: false, watch: true, refreshMs: 1000, signal: controller.signal },
      { stdout: (text) => void (stdout += text), stderr: () => undefined, env: { PATH: process.env.PATH ?? "", HOME: scratch, PASEO_HOME: paseoHome } },
    );
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    controller.abort();
    await running;
    expect(stdout.split("agent owner-1").length - 1).toBe(2);
    expect(stdout.split("may be stopped").length - 1).toBe(1);
  }, 15_000);

  it("board hides cards of archived agents", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "Planning" });
    writeState("decisions.json", {
      decisions: [decision({}), decision({ id: "old-question", key: "owner-old:old-question", agentId: "owner-old", question: "Asked by an archived owner?" })],
    });
    writeLive([{ id: "agent-1", role: "owner", ticket: "NA-001" }], ["agent-1:scope-approval"]);
    const { stdout } = await board();
    expect(stdout).toContain("card scope-approval (via paseo");
    expect(stdout).not.toContain("old-question");
    expect(stdout).not.toContain("archived owner");
  });

  it("missing live list", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "In Progress" });
    writeState("decisions.json", { decisions: [decision({})] });
    writeState("agents.json", { agents: { "owner-1": { project: "notes-app", role: "owner", ticket: "NA-001", lastStatus: null } } });
    const { stdout, code } = await board();
    expect(code).toBe(0);
    expect(stdout.match(/Paseo has not written a live list yet/g)).toHaveLength(1);
    expect(stdout).not.toContain("via paseo");
    expect(stdout).not.toContain("owner-1");
    expect(stdout).toContain("NA-001 Login");
    expect(JSON.parse((await board(["--json"])).stdout).paseo).toBeNull();
  });

  it("marks stale", async () => {
    writeTicket({
      id: "NA-001",
      title: "Login",
      status: "In Progress",
      cards: [card("fresh", 23), card("old", 25)].join("\n"),
      agents: [agent("new", 2), agent("long", 30), agent("finished", 30, { state: "done", finishedAt: at(29) })].join("\n"),
    });
    const { stdout } = await board();
    expect(stdout).toContain("    card fresh: Question fresh?\n");
    expect(stdout).toContain("    card old [stale]: Question old?");
    expect(stdout).toContain("    agent new (implementer, running, claude-code): doing new\n");
    expect(stdout).toContain("    agent long (implementer, running, claude-code) [stale]: doing long");
    expect(stdout).toContain("    agent finished (implementer, done, claude-code): doing finished\n");
  });

  it("reports a malformed card line and still prints the rest", async () => {
    writeTicket({ id: "NA-001", title: "Login", status: "Queued", cards: `oops\n${card("fine", 1)}` });
    const { stdout, stderr, code } = await board();
    expect(code).toBe(0);
    expect(stdout).toContain("card fine");
    expect(stderr).toContain("NA-001");
  });

  it("no zod import", () => {
    const seen = new Set<string>();
    const queue = ["server/taro-board.ts", "shared/board-text.ts"];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const match of source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)) {
        const specifier = match[1] as string;
        const allowed = specifier.startsWith("node:") || (specifier.startsWith(".") && specifier.endsWith(".ts") && !specifier.includes("host-types"));
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
        if (specifier.startsWith(".")) queue.push(relative(ROOT, resolve(ROOT, dirname(file), specifier)));
      }
    }
    expect(seen.has("shared/tracker-cards.ts")).toBe(true);
  });
});

describe("taro board from the command", { timeout: CLI_TIMEOUT_MS }, () => {
  it("runs with an empty environment", () => {
    const fakeHome = join(scratch, "user");
    const homeTracker = join(fakeHome, ".paseo", "plugin-data", "taro", "home", "projects", "notes-app", "tracker");
    mkdirSync(join(homeTracker, "tickets"), { recursive: true });
    writeFileSync(join(homeTracker, "tickets", "NA-001.md"), readTicketText("NA-001", "Plain board"));
    const result = spawnSync(BIN, ["board", "--project", "notes-app"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: fakeHome }, timeout: 20_000 });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NA-001 Plain board");
    expect(result.stdout).toContain("Paseo has not written a live list yet");
  });

  it("watch reprints on change", async () => {
    writeTicket({ id: "NA-001", title: "First title", status: "Queued" });
    const child = spawn(BIN, ["board", "--project", "notes-app", "--watch"], { env: { PATH: process.env.PATH ?? "", HOME: scratch, PASEO_HOME: paseoHome } });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => void (stdout += chunk.toString("utf8")));
    const until = async (done: () => boolean): Promise<void> => {
      const deadline = Date.now() + 15_000;
      while (!done()) {
        if (Date.now() > deadline) throw new Error(`timed out; output so far:\n${stdout}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    try {
      await until(() => stdout.includes("First title"));
      writeTicket({ id: "NA-001", title: "Second title", status: "Queued" });
      await until(() => stdout.includes("Second title"));
      writeLive([{ id: "owner-1", role: "owner", ticket: "NA-001" }], [], new Date().toISOString(), new Date());
      await until(() => stdout.includes("agent owner-1"));
      // The plugin renews the list's time every minute: nothing changed, so nothing is printed again.
      const printed = stdout.split("agent owner-1").length - 1;
      writeLive([{ id: "owner-1", role: "owner", ticket: "NA-001" }], [], new Date(Date.now() + 60_000).toISOString(), new Date(Date.now() + 1000));
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(stdout.split("agent owner-1").length - 1).toBe(printed);
      const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
      child.kill("SIGINT");
      expect(await exited).toBe(0);
    } finally {
      child.kill("SIGKILL");
    }
  });
});

function readTicketText(id: string, title: string): string {
  return serializeTicket({ id, title, status: "Queued", priority: null, labels: [], parent: null, dependsOn: [], created: "2026-11-01T10:00:00Z", updated: "2026-11-01T10:00:00Z", description: "", plan: "", criteria: [], notes: "", finalSummary: "", extra: {} });
}
