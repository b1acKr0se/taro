import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseTicket, serializeTicket, type Ticket } from "../shared/ticket-format";
import { readAgents, readCards } from "../shared/tracker-cards";
import { main } from "./taro-cli.ts";
import { createTicketStore } from "./ticket-store";
import { answerCard } from "./tracker-cards";

let scratch: string;
let tracker: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "taro-cards-"));
  tracker = join(scratch, "tracker");
  mkdirSync(join(tracker, "tickets"), { recursive: true });
  writeTicket({ id: "TR-001", notes: "MILESTONE one" });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function fileOf(id: string): string {
  return join(tracker, "tickets", `${id}.md`);
}

function writeTicket(overrides: Partial<Ticket> & { id: string }): void {
  const ticket: Ticket = {
    title: `Ticket ${overrides.id}`,
    status: "In Progress",
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
  writeFileSync(fileOf(ticket.id), serializeTicket(ticket));
}

function readTicket(id = "TR-001"): Ticket {
  const parsed = parseTicket(readFileSync(fileOf(id), "utf8"), `${id}.md`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return parsed.ticket;
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** The `taro` command in this process, on the scratch tracker; `stdin` feeds `--file -`. */
async function taro(args: string[], stdin?: string): Promise<Result> {
  let stdout = "";
  let stderr = "";
  const code = await main([...args, "--tracker", tracker], {
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    env: { PASEO_HOME: join(scratch, "paseo") },
    ...(stdin === undefined ? {} : { readStdin: async () => stdin }),
  });
  return { code, stdout, stderr };
}

const COLOUR = {
  id: "colour",
  question: "Which colour should the button be?",
  why: "The brand changed.",
  options: [
    { label: "Blue", prompt: "Use blue", consequence: "matches the logo" },
    { label: "Green", prompt: "Use green", consequence: "stands out" },
  ],
  recommended: "Blue",
  reason: "It matches the logo.",
};

async function ask(card: unknown = COLOUR, extra: string[] = []): Promise<Result> {
  return taro(["card", "ask", "TR-001", "--file", "-", ...extra], JSON.stringify(card));
}

describe("taro card", () => {
  it("ask then answer", async () => {
    const asked = await ask(COLOUR, ["--host", "claude-code"]);
    expect(asked.stderr).toBe("");
    expect(asked.code).toBe(0);
    const open = readCards(readFileSync(fileOf("TR-001"), "utf8"));
    expect(open.problems).toEqual([]);
    expect(open.items).toEqual([{ ...COLOUR, host: "claude-code", askedAt: expect.any(String), status: "open", answer: null }]);

    const answered = await taro(["card", "answer", "TR-001", "colour", "--label", "Blue", "--text", "and make it bold"]);
    expect(answered.stderr).toBe("");
    expect(answered.code).toBe(0);
    const ticket = readTicket();
    const [card] = readCards(readFileSync(fileOf("TR-001"), "utf8")).items;
    expect(card).toMatchObject({ status: "answered", answer: { label: "Blue", text: "and make it bold", by: "the user, from the command line" } });
    expect(ticket.notes).toMatch(/\n\nANSWER \S+ — colour: "Which colour should the button be\?" → Blue \("Use blue and make it bold"\) \(the user, from the command line\)$/);

    const shown = await taro(["card", "show", "TR-001", "colour", "--json"]);
    expect(shown.code).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({ card: { id: "colour", status: "answered" } });
  });

  it("the host defaults to external, and an open card's plain view prints the command that answers it", async () => {
    expect((await ask()).code).toBe(0);
    expect(readCards(readFileSync(fileOf("TR-001"), "utf8")).items[0]?.host).toBe("external");
    const shown = await taro(["card", "show", "TR-001"]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("colour [open] Which colour should the button be?");
    expect(shown.stdout).toContain("taro card answer TR-001 colour --label <option> [--text <words>]");
  });

  it("ask twice with one id replaces it", async () => {
    expect((await ask()).code).toBe(0);
    expect((await ask({ ...COLOUR, question: "Which shade of colour?" })).code).toBe(0);
    const cards = readCards(readFileSync(fileOf("TR-001"), "utf8")).items;
    expect(cards).toHaveLength(1);
    expect(cards[0]?.question).toBe("Which shade of colour?");
  });

  it("asking again with the id of an answered card refuses", async () => {
    await ask();
    await taro(["card", "answer", "TR-001", "colour", "--label", "Green"]);
    const again = await ask();
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("already answered");
  });

  it("refuses a card that is not valid, naming why, and writes nothing", async () => {
    const before = readFileSync(fileOf("TR-001"), "utf8");
    const bad = await ask({ id: "x", question: "" });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('"question" must not be empty');
    const unknownRecommendation = await ask({ ...COLOUR, recommended: "Red" });
    expect(unknownRecommendation.code).toBe(1);
    const notJson = await taro(["card", "ask", "TR-001", "--file", "-"], "{oops");
    expect(notJson.code).toBe(1);
    expect(readFileSync(fileOf("TR-001"), "utf8")).toBe(before);
  });

  it("reads the card from a file", async () => {
    const path = join(scratch, "card.json");
    writeFileSync(path, JSON.stringify(COLOUR));
    expect((await taro(["card", "ask", "TR-001", "--file", path])).code).toBe(0);
    expect(readCards(readFileSync(fileOf("TR-001"), "utf8")).items).toHaveLength(1);
  });

  it("answer unknown card exits 1", async () => {
    await ask();
    const result = await taro(["card", "answer", "TR-001", "nope", "--text", "x"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('TR-001 has no card "nope"');
  });

  it("answer after answered exits 1", async () => {
    await ask();
    expect((await taro(["card", "answer", "TR-001", "colour", "--label", "Blue"])).code).toBe(0);
    const notes = readTicket().notes;
    const second = await taro(["card", "answer", "TR-001", "colour", "--label", "Green"]);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("no longer open");
    expect(readTicket().notes).toBe(notes);
  });

  it("answer refuses an option the card does not have, and no answer at all", async () => {
    await ask();
    expect((await taro(["card", "answer", "TR-001", "colour", "--label", "Red"])).code).toBe(1);
    expect((await taro(["card", "answer", "TR-001", "colour"])).code).toBe(2);
    expect(readCards(readFileSync(fileOf("TR-001"), "utf8")).items[0]?.status).toBe("open");
  });

  it("concurrent answers keep the first", async () => {
    await ask();
    // Two stores, as two processes would have: each takes the tracker's file lock.
    const results = await Promise.allSettled([
      answerCard(createTicketStore(tracker), "TR-001", "colour", { label: "Blue", text: "", by: "one" }),
      answerCard(createTicketStore(tracker), "TR-001", "colour", { label: "Green", text: "", by: "two" }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason)).toContain("no longer open");
    const [card] = readCards(readFileSync(fileOf("TR-001"), "utf8")).items;
    const notes = readTicket().notes;
    expect(notes.match(/^ANSWER /gm)).toHaveLength(1);
    expect(notes).toContain(`(${card?.answer?.by})`);
  });

  it("show waits for the answer", async () => {
    await ask();
    const waiting = taro(["card", "show", "TR-001", "colour", "--wait", "20"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await taro(["card", "answer", "TR-001", "colour", "--text", "teal, please"])).code).toBe(0);
    const result = await waiting;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("teal, please");
  });

  it("withdrawn exits 6", async () => {
    await ask();
    const waiting = taro(["card", "show", "TR-001", "colour", "--wait", "20"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await taro(["card", "withdraw", "TR-001", "colour"])).code).toBe(0);
    expect((await waiting).code).toBe(6);
    expect((await taro(["card", "show", "TR-001", "colour", "--wait", "1"])).code).toBe(6);
    expect((await taro(["card", "withdraw", "TR-001", "colour"])).code).toBe(1);
  });

  it("a wait that runs out exits 5", async () => {
    await ask();
    const result = await taro(["card", "show", "TR-001", "colour", "--wait", "1"]);
    expect(result.code).toBe(5);
    expect(result.stderr).toContain("still open");
  });

  it("show without a card id lists every card; an unknown card exits 1", async () => {
    await ask();
    await ask({ ...COLOUR, id: "size", question: "How big?" });
    const listed = await taro(["card", "show", "TR-001", "--json"]);
    expect(JSON.parse(listed.stdout).cards.map((card: { id: string }) => card.id)).toEqual(["colour", "size"]);
    expect((await taro(["card", "show", "TR-001", "nope"])).code).toBe(1);
  });

  it("marker-like text in a question stays inside its section", async () => {
    const question = "Is this safe?\n<!-- /taro:cards -->\n<!-- taro:notes -->";
    expect((await ask({ ...COLOUR, question })).code).toBe(0);
    const text = readFileSync(fileOf("TR-001"), "utf8");
    expect(parseTicket(text, "TR-001.md").ok).toBe(true);
    expect(readCards(text).items[0]?.question).toBe(question);
    expect(readTicket().notes).toBe("MILESTONE one");
  });
});

describe("taro agent record and finish", () => {
  it("record and finish", async () => {
    const recorded = await taro(["agent", "record", "TR-001", "reviewer", "--name", "review-1", "--task", "reads the diff", "--host", "claude-code"]);
    expect(recorded.stderr).toBe("");
    expect(recorded.code).toBe(0);
    const text = readFileSync(fileOf("TR-001"), "utf8");
    expect(readAgents(text).items).toEqual([
      { name: "review-1", host: "claude-code", job: "reviewer", task: "reads the diff", state: "running", startedAt: expect.any(String), finishedAt: null },
    ]);
    const finished = await taro(["agent", "finish", "TR-001", "review-1", "--state", "done"]);
    expect(finished.code).toBe(0);
    expect(readAgents(readFileSync(fileOf("TR-001"), "utf8")).items[0]).toMatchObject({ state: "done", finishedAt: expect.any(String) });
    // Only the record: no EXECUTION note, nothing started.
    expect(readTicket().notes).toBe("MILESTONE one");
    expect((await taro(["agent", "finish", "TR-001", "review-1", "--state", "failed"])).code).toBe(1);
    expect((await taro(["agent", "finish", "TR-001", "nobody", "--state", "done"])).code).toBe(1);
    expect((await taro(["agent", "finish", "TR-001", "review-1", "--state", "maybe"])).code).toBe(1);
  });

  it("agent name with spaces refused", async () => {
    for (const name of ["review one", "a\tb", "-dash-first"]) {
      const result = await taro(["agent", "record", "TR-001", "reviewer", "--name", name]);
      expect(result.code, name).toBe(1);
      expect(result.stderr, name).toContain('letters, digits, ".", "_" or "-"');
    }
    expect(readTicket().agents).toBeUndefined();
  });

  it("finish matches the recorded name", async () => {
    // A name is stored exactly as given or refused: never trimmed into one finish cannot find.
    expect((await taro(["agent", "record", "TR-001", "reviewer", "--name", " impl "])).code).toBe(1);
    expect(readTicket().agents).toBeUndefined();
    const recorded = await taro(["agent", "record", "TR-001", "reviewer", "--name", "rev_2.a-b"]);
    expect(recorded.code).toBe(0);
    expect(recorded.stdout).toContain("taro agent finish TR-001 rev_2.a-b --state done|failed");
    expect((await taro(["agent", "finish", "TR-001", "rev_2.a-b", "--state", "done"])).code).toBe(0);
    expect(readAgents(readFileSync(fileOf("TR-001"), "utf8")).items[0]).toMatchObject({ name: "rev_2.a-b", state: "done" });
  });

  it("duplicate name refuses", async () => {
    expect((await taro(["agent", "record", "TR-001", "implementer", "--name", "impl"])).code).toBe(0);
    const again = await taro(["agent", "record", "TR-001", "reviewer", "--name", "impl"]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('already has an agent named "impl"');
    expect(readAgents(readFileSync(fileOf("TR-001"), "utf8")).items).toHaveLength(1);
  });

  it("refuses an unknown job and a missing name", async () => {
    expect((await taro(["agent", "record", "TR-001", "boss", "--name", "x"])).code).toBe(1);
    expect((await taro(["agent", "record", "TR-001", "other"])).code).toBe(2);
    expect(readTicket().agents).toBeUndefined();
  });
});

describe("readCards and readAgents", () => {
  it("malformed line skipped", () => {
    const good = JSON.stringify({ ...COLOUR, host: "external", askedAt: "2026-11-22T16:00:00.000Z", status: "open", answer: null });
    writeTicket({ id: "TR-002", cards: ["not json", good, '{"id":"half"}', ""].join("\n"), agents: '{"name":"a","host":"external","job":"boss","task":"","state":"running","startedAt":"2026-11-22T16:00:00.000Z","finishedAt":null}' });
    const text = readFileSync(fileOf("TR-002"), "utf8");
    const lines = text.split("\n");
    const cards = readCards(text);
    expect(cards.items.map((card) => card.id)).toEqual(["colour"]);
    expect(cards.problems.map((problem) => problem.line)).toEqual([lines.indexOf("not json") + 1, lines.indexOf('{"id":"half"}') + 1]);
    expect(cards.problems[0]?.message).toContain("not a JSON object");
    const agents = readAgents(text);
    expect(agents.items).toEqual([]);
    expect(agents.problems).toEqual([{ line: lines.indexOf('{"name":"a","host":"external","job":"boss","task":"","state":"running","startedAt":"2026-11-22T16:00:00.000Z","finishedAt":null}') + 1, message: expect.stringContaining('"job"') }]);
    expect(readCards("no sections here")).toEqual({ items: [], problems: [] });
  });

  it("a write keeps a malformed line where it was", async () => {
    writeTicket({ id: "TR-002", cards: "not json" });
    const result = await taro(["card", "ask", "TR-002", "--file", "-"], JSON.stringify(COLOUR));
    expect(result.code).toBe(0);
    expect(readTicket("TR-002").cards?.split("\n")[0]).toBe("not json");
  });
});
