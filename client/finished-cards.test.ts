import { describe, expect, it } from "vitest";

import { StoredDecisionSchema, type StoredDecision } from "../shared/state";
import { deliveryCards, deliveryCardView, deliveryRecords, planCardView, questionCards, type DeliveryRecord } from "./finished-cards";
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

  it("quotes a typed answer without a label", () => {
    const typed = stored("one", { answer: { text: "Use SQLite", label: null, at: "2026-01-19T10:05:00Z" } });
    expect(cards([message("a", [block("one")])], [typed]).get("a")).toEqual([{ id: "one", subject: "Question one?", outcome: "Answered: “Use SQLite”", tone: "positive", time: "10:05", words: null }]);
  });

  it("says withdrawn, and that its agent went away", () => {
    const rows = [message("a", [block("one"), block("two")])];
    const out = cards(rows, [stored("one", { status: "withdrawn", answer: null }), stored("two", { status: "withdrawn", answer: null, withdrawnWithAgent: true })]).get("a");
    expect(out?.map((card) => [card.outcome, card.tone, card.time])).toEqual([["Withdrawn", "neutral", null], ["Withdrawn: its agent went away", "neutral", null]]);
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
    expect(cards([message("a", [block("one")], undefined)], []).size).toBe(0);
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
