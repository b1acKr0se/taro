import { describe, expect, it } from "vitest";

import { awaitsAcceptance, choosesAction, deciderPrompt, parseReply } from "./decider.ts";

describe("parseReply", () => {
  const log = (body: string) => `\nsome thinking\nREPLY abc123\n${body}\n`;
  it("reads the four fields after the nonce line", () => {
    expect(parseReply(log("choice: Approve\ntext: \npreference: none\nbrief: no"), "abc123")).toEqual({ choice: "Approve", text: "", preference: "none", briefAnswered: false });
  });
  it("reads a question reply with a preference and a brief hit", () => {
    expect(parseReply(log("choice: Slug of the title\ntext: Lowercase it.\npreference: P1\nbrief: yes"), "abc123")).toEqual({ choice: "Slug of the title", text: "Lowercase it.", preference: "P1", briefAnswered: true });
  });
  it("drops a (recommended) tag the card showed", () => {
    expect(parseReply(log("choice: Note id (recommended)\ntext:\npreference: none\nbrief: no"), "abc123")?.choice).toBe("Note id");
  });
  it("is null without the nonce line (another turn's text) or without a choice", () => {
    expect(parseReply("\nchoice: Approve\n", "abc123")).toBeNull();
    expect(parseReply(log("text: hello"), "abc123")).toBeNull();
    expect(parseReply(log("choice:"), "abc123")).toBeNull();
  });
  it("takes the last reply when the nonce is repeated", () => {
    expect(parseReply(`\nREPLY abc123\nchoice: Other\n\nREPLY abc123\nchoice: Approve`, "abc123")?.choice).toBe("Approve");
  });
});

describe("choosesAction", () => {
  it("ignores case, an ellipsis and a full stop", () => {
    expect(choosesAction("Approve", "Approve")).toBe(true);
    expect(choosesAction(" accept. ", "Accept")).toBe(true);
    expect(choosesAction("Request changes…", "Approve")).toBe(false);
  });
});

describe("awaitsAcceptance", () => {
  const ticket = (status: string, notes: string) => `---\nstatus: "${status}"\n---\n<!-- taro:notes -->\n${notes}\n<!-- /taro:notes -->`;
  it("is true for a delivered ticket not yet accepted", () => {
    expect(awaitsAcceptance(ticket("Awaiting acceptance", "EVIDENCE x"))).toBe(true);
  });
  it("is false once accepted, or in another status", () => {
    expect(awaitsAcceptance(ticket("Awaiting acceptance", "ACCEPTED 2026 — merging"))).toBe(false);
    expect(awaitsAcceptance(ticket("In Progress", ""))).toBe(false);
  });
});

describe("deciderPrompt", () => {
  it("carries the rules, the spec, the brief, the history, the card and the reply format", () => {
    const prompt = deciderPrompt({ kind: "question", card: "Question: Which?", spec: "SPEC TEXT", brief: "BRIEF TEXT", history: ['- plan "x" → Approve'], nonce: "n0nce" });
    ["never write code", "SPEC TEXT", "BRIEF TEXT", '- plan "x" → Approve', "Question: Which?", 'exactly "REPLY n0nce"', "choice is one option's exact label, or Other"].forEach((part) => expect(prompt.toLowerCase()).toContain(part.toLowerCase()));
  });
});
