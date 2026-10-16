import { describe, expect, it } from "vitest";

import { StoredDecisionSchema, type StoredDecision } from "../shared/state";
import type { PermissionAsk } from "../shared/permission-asks";
import { blockCardSubject, deliveryCards, deliveryCardView, deliveryRecords, permissionCards, permissionCardView, planCardView, questionCards, type DeliveryRecord } from "./finished-cards";
import type { PlanLine } from "./plan-lines";

const clock = (iso: string) => iso.slice(11, 16);
const done = (key: string, at: string | undefined) => ({ key, text: "Delivered.\n\ndone: PR ready", at });
const chat = (key: string, at: string) => ({ key, text: "Working on it.", at });
const record = (at: string, kind: DeliveryRecord["kind"] = "changes requested", words: string | null = null): DeliveryRecord => ({ at, kind, words });
const line = (over: Partial<PlanLine>): PlanLine => ({ outcome: null, at: null, words: null, replaced: false, closed: null, ...over });

describe("planCardView", () => {
  it("says each state", () => {
    expect(planCardView(line({ outcome: "approved", at: "2026-01-05T10:20:00Z" }), clock)).toEqual({ outcome: "Approved", tone: "positive", time: "10:20", words: null });
    expect(planCardView(line({ outcome: "split into children" }), clock)).toMatchObject({ outcome: "Split into children", tone: "neutral", time: null });
    expect(planCardView(line({ closed: "withdrawn" }), clock)).toMatchObject({ outcome: "Withdrawn", tone: "neutral" });
    expect(planCardView(line({ closed: "answered in chat" }), clock).outcome).toBe("Answered in chat");
    expect(planCardView(line({ replaced: true }), clock).outcome).toBe("Replaced by the plan below");
    expect(planCardView(line({}), clock).outcome).toBe("Closed");
  });

  it("shows changes requested with the words, together with replaced", () => {
    const view = planCardView(line({ outcome: "changes requested", at: "2026-01-05T10:10:00Z", words: "Keep the old list", replaced: true }), clock);
    expect(view).toEqual({ outcome: "Changes requested · replaced by the plan below", tone: "warning", time: "10:10", words: "Keep the old list" });
  });
});

describe("deliveryRecords", () => {
  it("reads the three records, oldest first, with the words over several lines", () => {
    const notes = [
      'CHANGES-REQUESTED 2026-01-05T10:30:00.000Z — the user: "Rename it\nand add "tests""',
      "ACCEPTED 2026-01-05T11:00:00.000Z — the user accepted; merging: squash; by: the plugin",
      "DELIVERY-ENDED 2026-01-05T09:00:00.000Z — the owner asked `Which?` while awaiting acceptance: back to In Progress",
      "MILESTONE 2026-01-05T10:30Z — nothing",
      'CHANGES-REQUESTED nope — the user: "x"',
    ].join("\n\n");
    expect(deliveryRecords(notes)).toEqual([
      { at: "2026-01-05T09:00:00.000Z", kind: "ended", words: null },
      { at: "2026-01-05T10:30:00.000Z", kind: "changes requested", words: 'Rename it\nand add "tests"' },
      { at: "2026-01-05T11:00:00.000Z", kind: "accepted", words: null },
    ]);
  });

  it("is empty without notes or records", () => {
    expect(deliveryRecords(null)).toEqual([]);
    expect(deliveryRecords("")).toEqual([]);
  });
});

describe("deliveryCards", () => {
  const rows = [done("a", "2026-01-05T10:00:00Z"), chat("b", "2026-01-05T10:05:00Z"), done("c", "2026-01-05T11:00:00Z")];

  it("gives no card without records", () => {
    expect(deliveryCards(rows, [], null).size).toBe(0);
  });

  it("matches a record to the done message before it, one window each", () => {
    const first = record("2026-01-05T10:30:00Z");
    const second = record("2026-01-05T11:30:00Z", "accepted");
    expect(deliveryCards(rows, [first, second], null)).toEqual(new Map([["a", first], ["c", second]]));
  });

  it("ignores a record before the first done message and a done message with none", () => {
    const early = record("2026-01-05T09:00:00Z");
    expect(deliveryCards(rows, [early], null).size).toBe(0);
    const only = record("2026-01-05T10:30:00Z");
    expect([...deliveryCards(rows, [only], null).keys()]).toEqual(["a"]);
  });

  it("counts a record exactly at a message's time for that message, not the one before", () => {
    const exact = record("2026-01-05T11:00:00Z");
    expect([...deliveryCards(rows, [exact], null).keys()]).toEqual(["c"]);
    const atFirst = record("2026-01-05T10:00:00Z");
    expect([...deliveryCards(rows, [atFirst], null).keys()]).toEqual(["a"]);
  });

  it("takes the newest of several in one window, whatever their order", () => {
    const older = record("2026-01-05T10:10:00Z");
    const newer = record("2026-01-05T10:20:00Z", "accepted");
    expect(deliveryCards(rows, [newer, older], null).get("a")).toBe(newer);
  });

  it("gives the live row none, and keeps the windows of the others", () => {
    const first = record("2026-01-05T10:30:00Z");
    const second = record("2026-01-05T11:30:00Z");
    expect(deliveryCards(rows, [first, second], "c")).toEqual(new Map([["a", first]]));
  });

  it("skips rows without a time", () => {
    const withoutTime = [done("a", undefined), done("c", "2026-01-05T11:00:00Z")];
    const early = record("2026-01-05T10:30:00Z");
    expect(deliveryCards(withoutTime, [early], null).size).toBe(0);
  });
});

describe("deliveryCardView", () => {
  it("says each record", () => {
    expect(deliveryCardView(record("2026-01-05T10:30:00Z", "changes requested", "Rename it"), clock)).toEqual({ outcome: "Changes requested", tone: "warning", time: "10:30", words: "Rename it" });
    expect(deliveryCardView(record("2026-01-05T10:30:00Z", "accepted"), clock)).toMatchObject({ outcome: "Accepted", tone: "positive" });
    expect(deliveryCardView(record("2026-01-05T10:30:00Z", "ended"), clock)).toMatchObject({ outcome: "Delivery ended: the owner asked a question", tone: "neutral" });
  });
});

describe("questionCards", () => {
  const now = Date.parse("2026-01-20T12:00:00Z");
  const block = (id: string, question = `Question ${id}?`) => "```decision\n" + `id: ${id}\nquestion: ${question}\n` + "```";
  const message = (key: string, blocks: string[], at: string | undefined = "2026-01-19T10:00:00Z") => ({ key, text: `Text\n\n${blocks.join("\n\n")}`, at });
  const stored = (id: string, over: Partial<StoredDecision> = {}): StoredDecision =>
    StoredDecisionSchema.parse({ id, question: `Question ${id}?`, key: `agent:${id}`, project: "p", ticket: null, agentId: "agent", agentRole: "owner", agentTitle: null, askedAt: "2026-01-19T10:00:00Z", status: "answered", answer: { text: "", label: "Yes", at: "2026-01-19T10:05:00Z" }, ...over });
  const cards = (rows: Parameters<typeof questionCards>[0], decisions: StoredDecision[], live: string[] = []) => questionCards(rows, decisions, new Set(live), clock, now);

  it("says a picked option, with the typed words beside it only when they differ", () => {
    const rows = [message("a", [block("one"), block("two")])];
    const picked = stored("one", { answer: { text: "Yes", label: "Yes", at: "2026-01-19T10:05:00Z" } });
    const noted = stored("two", { answer: { text: "but later", label: "Yes", at: "2026-01-19T10:06:00Z" } });
    expect(cards(rows, [picked, noted]).get("a")).toEqual([
      { id: "one", subject: "Question one?", outcome: "Answered: Yes", tone: "positive", time: "10:05", words: null },
      { id: "two", subject: "Question two?", outcome: "Answered: Yes", tone: "positive", time: "10:06", words: "but later" },
    ]);
  });

  it("never quotes an option's own prompt as the user's words, and drops it from words typed after it", () => {
    const options = [
      { label: "In memory", prompt: "Keep it in memory", consequence: "", images: [] },
      { label: "Name it…", prompt: "Call it…", consequence: "", images: [] },
    ];
    const rows = [message("a", [block("one"), block("two"), block("three")])];
    const pressed = stored("one", { options, answer: { text: "Keep it in memory", label: "In memory", at: "2026-01-19T10:05:00Z" } });
    const withWords = stored("two", { options, answer: { text: "Call it: Notes", label: "Name it…", at: "2026-01-19T10:05:00Z" } });
    const ownWords = stored("three", { options, answer: { text: "Keep it in memory, but cap it at 1 MB", label: "In memory", at: "2026-01-19T10:05:00Z" } });
    expect(cards(rows, [pressed, withWords, ownWords]).get("a")?.map((card) => card.words)).toEqual([null, "Notes", "Keep it in memory, but cap it at 1 MB"]);
  });

  it("quotes a typed answer without a label", () => {
    const typed = stored("one", { answer: { text: "Use SQLite", label: null, at: "2026-01-19T10:05:00Z" } });
    expect(cards([message("a", [block("one")])], [typed]).get("a")).toEqual([{ id: "one", subject: "Question one?", outcome: "Answered", tone: "positive", time: "10:05", words: "Use SQLite" }]);
    const multiline = stored("one", { answer: { text: "Use SQLite.\n\nMove to Postgres later.", label: null, at: "2026-01-19T10:05:00Z" } });
    expect(cards([message("a", [block("one")])], [multiline]).get("a")?.[0]).toMatchObject({ outcome: "Answered", words: "Use SQLite.\n\nMove to Postgres later." });
    const empty = stored("one", { answer: { text: "  ", label: null, at: "2026-01-19T10:05:00Z" } });
    expect(cards([message("a", [block("one")])], [empty]).get("a")?.[0]).toMatchObject({ outcome: "Answered", words: null });
  });

  it("says withdrawn, and that its agent went away", () => {
    const rows = [message("a", [block("one"), block("two")])];
    const out = cards(rows, [stored("one", { status: "withdrawn", answer: null }), stored("two", { status: "withdrawn", answer: null, withdrawnWithAgent: true })]).get("a");
    expect(out?.map((card) => [card.outcome, card.tone, card.time])).toEqual([["Withdrawn", "neutral", null], ["Withdrawn: its agent went away", "neutral", null]]);
  });

  it("dates a withdrawal by the agent's withdrawing message, and one the plugin made not at all", () => {
    const withdrawing = "```decision\nid: one\nstatus: withdrawn\n```";
    const rows = [message("a", [block("one"), block("two")]), message("b", [withdrawing], "2026-01-19T10:20:00Z")];
    const out = cards(rows, [stored("one", { status: "withdrawn", answer: null }), stored("two", { status: "withdrawn", answer: null, withdrawnWithAgent: true })]).get("a");
    expect(out?.map((card) => [card.outcome, card.time])).toEqual([["Withdrawn", "10:20"], ["Withdrawn: its agent went away", null]]);
  });

  it("draws nothing for an open decision that is not live", () => {
    expect(cards([message("a", [block("one")])], [stored("one", { status: "open", answer: null })]).size).toBe(0);
  });

  it("draws nothing for a live key", () => {
    expect(cards([message("a", [block("one")])], [stored("one")], ["agent:one"]).size).toBe(0);
  });

  it("skips the scope approval", () => {
    expect(cards([message("a", [block("scope-approval")])], [stored("scope-approval")]).size).toBe(0);
  });

  it("has no card for a new message without a record, and 'No record kept' for an old one", () => {
    expect(cards([message("a", [block("one")])], []).size).toBe(0);
    expect(cards([{ key: "a", text: block("one") }], []).size).toBe(0);
    const old = cards([message("a", [block("one")], "2025-12-01T10:00:00Z")], []).get("a");
    expect(old).toEqual([{ id: "one", subject: "Question one?", outcome: "No record kept", tone: "neutral", time: null, words: null }]);
  });

  it("marks every asking but the last as asked again, across three messages", () => {
    const rows = [message("a", [block("one")]), message("b", [block("one")]), message("c", [block("one")])];
    const out = cards(rows, [stored("one")]);
    expect(out.get("a")?.[0]?.outcome).toBe("Asked again below");
    expect(out.get("b")?.[0]?.outcome).toBe("Asked again below");
    expect(out.get("c")?.[0]?.outcome).toBe("Answered: Yes");
  });

  it("dates an asked-again card by the message that asked it again, not a withdrawing one", () => {
    const withdrawing = "```decision\nid: one\nstatus: withdrawn\n```";
    const rows = [message("a", [block("one")]), message("w", [withdrawing], "2026-01-19T10:10:00Z"), message("b", [block("one")], "2026-01-19T10:30:00Z"), { key: "c", text: block("one") }];
    const out = cards(rows, [stored("one")]);
    expect(out.get("a")?.[0]).toMatchObject({ outcome: "Asked again below", time: "10:30" });
    expect(out.get("b")?.[0]).toMatchObject({ outcome: "Asked again below", time: null });
  });

  it("leaves the last asking to the live card", () => {
    const rows = [message("a", [block("one")]), message("b", [block("one")])];
    const out = cards(rows, [stored("one", { status: "open", answer: null })], ["agent:one"]);
    expect(out.get("a")?.[0]?.outcome).toBe("Asked again below");
    expect(out.has("b")).toBe(false);
  });

  it("does not count a withdrawing block as an asking, and draws a repeated block once", () => {
    const withdrawing = "```decision\nid: one\nstatus: withdrawn\n```";
    const rows = [message("a", [block("one"), block("one")]), message("b", [withdrawing])];
    const out = cards(rows, [stored("one")]).get("a");
    expect(out?.map((card) => card.outcome)).toEqual(["Answered: Yes"]);
  });

  it("is empty without rows or decisions", () => {
    expect(cards([], [stored("one")]).size).toBe(0);
    expect(cards([{ key: "a", text: "No blocks here", at: "2025-01-01T00:00:00Z" }], []).size).toBe(0);
  });
});

function permissionAsk(requestId: string, askedAt: string, change: Partial<PermissionAsk> = {}): PermissionAsk {
  return { agentId: "a", requestId, kind: "tool", name: "Bash", subject: "rm -rf /tmp/x", askedAt, answeredAt: askedAt, outcome: "allowed", by: "you", rule: null, words: null, ...change };
}

describe("permissionCards", () => {
  const time = (minute: number) => `2026-10-16T10:${String(minute).padStart(2, "0")}:00.000Z`;
  const message = (key: string, minute?: number) => ({ key, row: minute === undefined ? { key } : { key, at: time(minute) } });
  const tools = (key: string, minute: number) => ({ key, tools: [{ key, at: time(minute) }, { key: `${key}-2`, at: time(minute + 5) }] });
  const keys = (asks: readonly PermissionAsk[] | undefined) => (asks ?? []).map((ask) => ask.requestId);

  it("places nothing without asks, and every ask before the first group without groups", () => {
    const empty = permissionCards([message("1", 1)], []);
    expect(empty.before).toEqual([]);
    expect(empty.after.size).toBe(0);
    expect(keys(permissionCards([], [permissionAsk("p", time(1))]).before)).toEqual(["p"]);
  });

  it("puts asks made before every group before the first", () => {
    const places = permissionCards([message("1", 10), tools("2", 20)], [permissionAsk("p", time(1)), permissionAsk("q", time(2))]);
    expect(keys(places.before)).toEqual(["p", "q"]);
    expect(places.after.size).toBe(0);
  });

  it("puts asks made after every group after the last, in order", () => {
    const places = permissionCards([message("1", 1), tools("2", 2)], [permissionAsk("p", time(30)), permissionAsk("q", time(31)), permissionAsk("r", time(32))]);
    expect(places.before).toEqual([]);
    expect(keys(places.after.get("2"))).toEqual(["p", "q", "r"]);
  });

  it("puts an ask between two groups after the earlier, dating a tool run by its first call", () => {
    const places = permissionCards([message("1", 1), tools("2", 10), message("3", 20)], [permissionAsk("p", time(12)), permissionAsk("q", time(5))]);
    expect(keys(places.after.get("2"))).toEqual(["p"]);
    expect(keys(places.after.get("1"))).toEqual(["q"]);
  });

  it("puts an ask made at a group's very time after that group", () => {
    const places = permissionCards([message("1", 1), tools("2", 10), message("3", 20)], [permissionAsk("p", time(10))]);
    expect(keys(places.after.get("2"))).toEqual(["p"]);
  });

  it("skips groups without a time, and puts every ask first when none has one", () => {
    const places = permissionCards([message("1", 1), message("2"), message("3", 20)], [permissionAsk("p", time(12))]);
    expect(keys(places.after.get("1"))).toEqual(["p"]);
    expect(keys(permissionCards([message("1"), message("2")], [permissionAsk("p", time(12))]).before)).toEqual(["p"]);
  });

  it("drops asks made before the first loaded group while older entries are not loaded, and places the rest", () => {
    const places = permissionCards([message("1", 10), tools("2", 20)], [permissionAsk("p", time(1)), permissionAsk("q", time(12))], true);
    expect(places.before).toEqual([]);
    expect(keys(places.after.get("1"))).toEqual(["q"]);
    expect(permissionCards([], [permissionAsk("p", time(1))], true).before).toEqual([]);
  });
});

describe("permissionCardView", () => {
  const clock = (iso: string) => iso.slice(11, 16);

  it("says who allowed or denied a tool, with its time and the user's words", () => {
    expect(permissionCardView(permissionAsk("p", "2026-10-16T10:05:00.000Z"), clock)).toEqual({ kind: "Permission", subject: "rm -rf /tmp/x", outcome: "Allowed by you", tone: "positive", time: "10:05", words: null });
    expect(permissionCardView(permissionAsk("p", "2026-10-16T10:05:00.000Z", { outcome: "denied", words: "not there" }), clock)).toMatchObject({ outcome: "Denied by you", tone: "negative", words: "not there" });
    expect(permissionCardView(permissionAsk("p", "2026-10-16T10:05:00.000Z", { outcome: "denied", by: "rules", rule: "top-level" }), clock)).toMatchObject({ outcome: "Denied by Taro's rules (top-level)", tone: "negative" });
  });

  it("says a question was answered or dismissed", () => {
    const question = { kind: "question", subject: "Which database?" };
    expect(permissionCardView(permissionAsk("p", "2026-10-16T10:05:00.000Z", { ...question, words: "Database: Postgres" }), clock)).toMatchObject({ kind: "Question", outcome: "Answered by you", tone: "positive", words: "Database: Postgres" });
    expect(permissionCardView(permissionAsk("p", "2026-10-16T10:05:00.000Z", { ...question, outcome: "denied" }), clock)).toMatchObject({ kind: "Question", outcome: "Dismissed by you", tone: "neutral" });
  });

  it("says a cancelled ask was cancelled, by nobody and without words", () => {
    const cancelled = { outcome: "cancelled", by: null } as const;
    expect(permissionCardView(permissionAsk("p", "2026-10-16T10:05:00.000Z", cancelled), clock)).toEqual({ kind: "Permission", subject: "rm -rf /tmp/x", outcome: "Cancelled: the turn stopped", tone: "neutral", time: "10:05", words: null });
    expect(permissionCardView(permissionAsk("p", "2026-10-16T10:05:00.000Z", { ...cancelled, kind: "question" }), clock)).toMatchObject({ kind: "Question", outcome: "Cancelled: the turn stopped" });
  });
});

describe("blockCardSubject", () => {
  it("names a plan's ticket, has no subject for a plan without one, and gives a question its question", () => {
    expect(blockCardSubject({ id: "scope-approval", question: "Approve the plan for TR-7?" }, "TR-7")).toBe("Plan for TR-7");
    expect(blockCardSubject({ id: "scope-approval", question: "Approve the plan for TR-7?" }, null)).toBeNull();
    expect(blockCardSubject({ id: "storage", question: "Store fees per trade?" }, "TR-7")).toBe("Store fees per trade?");
  });
});
