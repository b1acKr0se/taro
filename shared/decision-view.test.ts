import { describe, expect, it } from "vitest";

import { decisionBlockView, decisionTimelineItems, untrackedDecision } from "./decision-view";
import { decisionMessageSegments, parseDecisionBody, type ParsedDecision } from "./reports";
import type { StoredDecision } from "./state";

const block = (id: string, question = "Approve?") =>
  ["```decision", `id: ${id}`, `question: ${question}`, "options:", "  - label: Yes", "    prompt: Yes please", "recommended: Yes", "```"].join("\n");

function stored(decision: ParsedDecision, change: Partial<StoredDecision> = {}): StoredDecision {
  return { ...untrackedDecision(decision, "agent-1"), key: `agent-1:${decision.id}`, project: "p", ...change };
}

describe("decisionMessageSegments", () => {
  it("returns null for a message without a block", () => {
    expect(decisionMessageSegments("")).toBeNull();
    expect(decisionMessageSegments("Just text\n```ts\ncode\n```")).toBeNull();
  });

  it("keeps text and blocks in order", () => {
    const segments = decisionMessageSegments(`Before.\n\n${block("a")}\n\nBetween.\n${block("b", "Second?")}\n\nwaiting: approval`);
    expect(segments?.map((segment) => (segment.kind === "text" ? `text:${segment.text}` : `decision:${segment.decision.id}`))).toEqual([
      "text:Before.",
      "decision:a",
      "text:Between.",
      "decision:b",
      "text:waiting: approval",
    ]);
  });

  it("drops blank text around adjacent blocks and reads CRLF", () => {
    const segments = decisionMessageSegments(`${block("a")}\r\n\r\n${block("b")}`.replace(/\n/g, "\r\n"));
    expect(segments?.map((segment) => segment.kind)).toEqual(["decision", "decision"]);
    expect(segments?.[0]?.kind === "decision" && segments[0].decision.question).toBe("Approve?");
  });

  it("leaves an unclosed block as text", () => {
    expect(decisionMessageSegments("Text\n```decision\nid: a\nquestion: half")).toBeNull();
  });
});

describe("decisionTimelineItems", () => {
  it("leaves streaming and block-free messages to Paseo", () => {
    expect(decisionTimelineItems(`Hi\n${block("a")}`, "streaming")).toBeUndefined();
    expect(decisionTimelineItems("Hi", "complete")).toBeUndefined();
  });

  it("explodes a finished message into text and decision items with stable ids", () => {
    const result = decisionTimelineItems(`Hi\n${block("a")}\nwaiting: you`, "complete");
    expect(result?.items.map((item) => [item.id, item.kind])).toEqual([
      ["segment-0", "taro-decision-text"],
      ["segment-1", "taro-decision-block"],
      ["segment-2", "taro-decision-text"],
    ]);
    // Data must survive JSON (Paseo's contract).
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe("decisionBlockView", () => {
  const asked = parseDecisionBody("id: a\nquestion: Approve?\noptions:\n  - label: Yes\n    prompt: Yes please");

  it("is untracked when Taro holds nothing", () => {
    expect(decisionBlockView(asked, null, true)).toEqual({ kind: "untracked" });
  });

  it("is the open card while open and the agent is live", () => {
    const decision = stored(asked);
    expect(decisionBlockView(asked, decision, true)).toEqual({ kind: "open", decision });
  });

  it("is withdrawn when the agent is gone or the decision withdrawn", () => {
    expect(decisionBlockView(asked, stored(asked), false)).toEqual({ kind: "withdrawn" });
    expect(decisionBlockView(asked, stored(asked, { status: "withdrawn" }), true)).toEqual({ kind: "withdrawn" });
  });

  it("shows the answer once answered, whether the agent lives or not", () => {
    const answered = stored(asked, { status: "answered", answer: { text: "Yes please", label: "Yes", at: "t" } });
    expect(decisionBlockView(asked, answered, false)).toEqual({ kind: "answered", answer: "Yes please", label: "Yes" });
  });

  it("is replaced when a later block with the same id asks something else", () => {
    const later = parseDecisionBody("id: a\nquestion: Approve the new scope?\noptions:\n  - label: Yes\n    prompt: Yes please");
    expect(decisionBlockView(asked, stored(later), true)).toEqual({ kind: "replaced" });
  });

  it("marks a withdrawing block as such, whatever is stored", () => {
    const withdrawal = parseDecisionBody("id: a\nstatus: withdrawn");
    expect(decisionBlockView(withdrawal, stored(asked), true)).toEqual({ kind: "withdrawal" });
    expect(decisionBlockView(withdrawal, null, true)).toEqual({ kind: "withdrawal" });
  });
});
