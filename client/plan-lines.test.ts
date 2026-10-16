import { describe, expect, it } from "vitest";

import { planAnswers, planLines, planLineText, type PlanLine } from "./plan-lines";

const plan = "```decision\nid: scope-approval\nquestion: Approve the plan for NA-1?\nblocking: true\noptions:\n  - label: Approve\n    prompt: Approve\n```";
const withdrawn = "```decision\nid: scope-approval\nstatus: withdrawn\n```";
const asking = (key: string, at: string, words = "The plan is in the ticket.") => ({ key, kind: "agent", text: `${words}\n\n${plan}\n\nwaiting: approval`, at });
const agent = (key: string, at: string, text: string) => ({ key, kind: "agent", text, at });
const user = (key: string, text: string) => ({ key, kind: "user", text });
const clock = (iso: string) => iso.slice(11, 16);
const text = (line: PlanLine | undefined) => (line === undefined ? undefined : planLineText(line, clock));

describe("planAnswers", () => {
  it("reads the plan card's answers from the notes, oldest first, and skips other decisions", () => {
    const notes = [
      'ANSWER 2026-01-05T10:20:00.000Z — scope-approval: "Approve the plan for NA-1?" → Approve ("Approve") (the user, from the Taro screen)',
      'ANSWER 2026-01-05T10:05:00.000Z — scope-approval: "Approve the plan for "NA-1"?" → Request changes ("Keep the old list") (the user, from the agent\'s tab)',
      'ANSWER 2026-01-05T10:10:00.000Z — fee-storage: "Store fees?" → Per trade ("Store fees per trade") (the user, from the Taro screen)',
      'ANSWER 2026-01-05T10:15:00.000Z — scope-approval: "Approve the plan for NA-1?" → Split into children ("Split it") (the user, from the Taro screen)',
      'ANSWER 2026-01-05T10:01:00.000Z — scope-approval: "Approve the plan for NA-1?" → "drop the export" (the user, from the Taro screen)',
      "MILESTONE 2026-01-05T10:30Z — approved; building",
      'ANSWER not-a-time — scope-approval: "Approve?" → Approve ("Approve")',
    ].join("\n\n");
    expect(planAnswers(notes)).toEqual([
      { at: "2026-01-05T10:01:00.000Z", outcome: "changes requested" },
      { at: "2026-01-05T10:05:00.000Z", outcome: "changes requested" },
      { at: "2026-01-05T10:15:00.000Z", outcome: "split into children" },
      { at: "2026-01-05T10:20:00.000Z", outcome: "approved" },
    ]);
  });

  it("is empty without notes or answers", () => {
    expect(planAnswers(null)).toEqual([]);
    expect(planAnswers("")).toEqual([]);
    expect(planAnswers("MILESTONE 2026-01-05T10:30Z — started")).toEqual([]);
  });

  it("reads a multi-line typed answer from its first line", () => {
    expect(planAnswers('ANSWER 2026-01-05T10:05:00.000Z — scope-approval: "Approve?" → Request changes ("First line\nsecond line") (the user, from the Taro screen)')).toEqual([
      { at: "2026-01-05T10:05:00.000Z", outcome: "changes requested" },
    ]);
  });
});

describe("planLines", () => {
  const approved = { at: "2026-01-05T10:20:00.000Z", outcome: "approved" };
  const changes = { at: "2026-01-05T10:10:00.000Z", outcome: "changes requested" };

  it("labels an approved plan with its time", () => {
    const rows = [asking("1", "2026-01-05T10:00:00Z"), user("2", "Approve"), agent("3", "2026-01-05T10:21:00Z", "Building.")];
    expect(text(planLines(rows, [approved], null).get("1"))).toBe("Plan · approved 10:20");
  });

  it("labels a plan with changes requested and asked again, and leaves the live card's message alone", () => {
    const rows = [asking("1", "2026-01-05T10:00:00Z"), user("2", "Keep the old list"), asking("3", "2026-01-05T10:12:00Z")];
    const lines = planLines(rows, [changes], "3");
    expect(text(lines.get("1"))).toBe("Plan · changes requested 10:10 — replaced by the plan below");
    expect(lines.has("3")).toBe(false);
  });

  it("gives each asking only the answer between it and the next asking", () => {
    const rows = [asking("1", "2026-01-05T10:00:00Z"), asking("2", "2026-01-05T10:12:00Z"), agent("3", "2026-01-05T10:30:00Z", "Building.")];
    const lines = planLines(rows, [changes, approved], null);
    expect(text(lines.get("1"))).toBe("Plan · changes requested 10:10 — replaced by the plan below");
    expect(text(lines.get("2"))).toBe("Plan · approved 10:20");
  });

  it("says a plan asked again without an answer was replaced", () => {
    const rows = [asking("1", "2026-01-05T10:00:00Z"), agent("2", "2026-01-05T10:01:00Z", "One more thing."), asking("3", "2026-01-05T10:02:00Z")];
    expect(text(planLines(rows, [], "3").get("1"))).toBe("Plan · replaced by the plan below");
  });

  it("says a plan the owner withdrew was withdrawn", () => {
    const rows = [asking("1", "2026-01-05T10:00:00Z"), agent("2", "2026-01-05T10:05:00Z", `Dropping it.\n\n${withdrawn}`)];
    const lines = planLines(rows, [], null);
    expect(text(lines.get("1"))).toBe("Plan · withdrawn");
    expect(lines.has("2")).toBe(false);
  });

  it("says a plan answered in words in the chat was answered there, with no time", () => {
    const rows = [asking("1", "2026-01-05T10:00:00Z"), user("2", "looks good, go"), agent("3", "2026-01-05T10:05:00Z", `Recorded.\n\n${withdrawn}`)];
    expect(text(planLines(rows, [], null).get("1"))).toBe("Plan · answered in chat");
    const reasked = [asking("1", "2026-01-05T10:00:00Z"), user("2", "make it shorter"), asking("3", "2026-01-05T10:05:00Z")];
    expect(text(planLines(reasked, [], "3").get("1"))).toBe("Plan · answered in chat — replaced by the plan below");
  });

  it("draws no line under the newest plan with nothing after it: its card may not be stored yet", () => {
    expect(planLines([asking("1", "2026-01-05T10:00:00Z")], [], null).size).toBe(0);
    expect(planLines([asking("1", "2026-01-05T10:00:00Z")], [], "1").size).toBe(0);
  });

  it("holds the newest plan's line while its answer's record is read, never reading it as answered in chat", () => {
    const rows = [asking("1", "2026-01-05T10:00:00Z"), asking("2", "2026-01-05T10:12:00Z"), user("3", "Approve")];
    const settling = planLines(rows, [changes], null, true);
    expect(settling.has("2")).toBe(false);
    expect(text(settling.get("1"))).toBe("Plan · changes requested 10:10 — replaced by the plan below");
    expect(text(planLines(rows, [changes, approved], null, true).get("2"))).toBe("Plan · approved 10:20");
    expect(text(planLines(rows, [changes], null, false).get("2"))).toBe("Plan · answered in chat");
  });

  it("ignores an answer from before the plan was asked (an earlier asking past the timeline's tail)", () => {
    const rows = [asking("1", "2026-01-05T10:15:00Z"), asking("2", "2026-01-05T10:30:00Z")];
    expect(text(planLines(rows, [changes], "2").get("1"))).toBe("Plan · replaced by the plan below");
  });

  it("leaves rows without a time, other decisions and an empty chat alone", () => {
    const other = { key: "1", kind: "agent", text: "```decision\nid: fee-storage\nquestion: Per trade?\noptions:\n  - label: Yes\n    prompt: Yes\n```" };
    expect(planLines([other, user("2", "Yes")], [approved], null).size).toBe(0);
    expect(planLines([{ ...asking("1", ""), at: undefined }, user("2", "Approve")], [approved], null).size).toBe(0);
    expect(planLines([], [approved], null).size).toBe(0);
  });

  it("names another option the user picked", () => {
    const rows = [asking("1", "2026-01-05T10:00:00Z"), user("2", "Split it")];
    expect(text(planLines(rows, [{ at: "2026-01-05T10:01:00.000Z", outcome: "split into children" }], null).get("1"))).toBe("Plan · split into children 10:01");
  });
});
