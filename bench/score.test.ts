import { describe, expect, it } from "vitest";

import { countRecords, loggedViolations, parseNodeTest, parseTestOutput, parseUnittest, scoreQuestions, scoreStats } from "./score.ts";

describe("parseNodeTest", () => {
  it("reads passes and the total from the summary", () => {
    expect(parseNodeTest("✔ a (1ms)\nℹ tests 13\nℹ suites 0\nℹ pass 12\nℹ fail 1\n")).toEqual({ passed: 12, total: 13 });
  });
  it("reads the tap reporter's summary too", () => {
    expect(parseNodeTest("# tests 4\n# pass 4\n# fail 0\n")).toEqual({ passed: 4, total: 4 });
  });
  it("reads all failing", () => {
    expect(parseNodeTest("ℹ tests 11\nℹ pass 0\nℹ fail 11\n")).toEqual({ passed: 0, total: 11 });
  });
  it("is null when no test ran (no summary)", () => {
    expect(parseNodeTest("Could not find 'hidden/*.test.js'\n")).toBeNull();
    expect(parseNodeTest("")).toBeNull();
  });
});

describe("parseUnittest", () => {
  it("reads a run where everything passed", () => {
    expect(parseUnittest("..........\n----------------------------------------------------------------------\nRan 10 tests in 0.032s\n\nOK\n")).toEqual({ passed: 10, total: 10 });
  });
  it("takes failures and errors off the total", () => {
    expect(parseUnittest("Ran 14 tests in 1.200s\n\nFAILED (failures=3, errors=2)\n")).toEqual({ passed: 9, total: 14 });
    expect(parseUnittest("Ran 1 test in 0.001s\n\nFAILED (errors=1)\n")).toEqual({ passed: 0, total: 1 });
  });
  it("counts skipped tests as run and not failed", () => {
    expect(parseUnittest("Ran 5 tests in 0.1s\n\nOK (skipped=2)\n")).toEqual({ passed: 5, total: 5 });
    expect(parseUnittest("Ran 5 tests in 0.1s\n\nFAILED (failures=1, skipped=2)\n")).toEqual({ passed: 4, total: 5 });
  });
  it("is null when none ran or the runner did not start", () => {
    expect(parseUnittest("----------------------------------------------------------------------\nRan 0 tests in 0.000s\n\nNO TESTS RAN\n")).toBeNull();
    expect(parseUnittest("/usr/bin/python3: No module named unittest\n")).toBeNull();
    expect(parseUnittest("")).toBeNull();
  });
  it("parseTestOutput reads either runner", () => {
    expect(parseTestOutput("ℹ tests 4\nℹ pass 3\n")).toEqual({ passed: 3, total: 4 });
    expect(parseTestOutput("Ran 4 tests in 0.1s\n\nFAILED (failures=1)\n")).toEqual({ passed: 3, total: 4 });
    expect(parseTestOutput("nothing")).toBeNull();
  });
});

describe("scoreStats", () => {
  const stats = {
    transitions: [
      { from: null, to: "Queued", at: "2026-01-05T10:00:00Z" },
      { from: "Queued", to: "Planning", at: "2026-01-05T10:01:00Z" },
      { from: "Planning", to: "In Progress", at: "2026-01-05T10:11:00Z" },
      { from: "In Progress", to: "Done", at: "2026-01-05T10:41:00Z" },
    ],
    agents: {
      a: { agentId: "a", role: "owner", model: "claude/claude-opus-5-5", turns: 12, activeMs: 600000, costUsd: 4.5, contextTokens: 140000 },
      b: { agentId: "b", role: "implementer", model: "claude/claude-sonnet-5-5", turns: 3, activeMs: 120000, costUsd: 0.5, contextTokens: 60000 },
      c: { agentId: "c", role: "implementer", model: "claude/claude-haiku-5-5", turns: 2, activeMs: 30000, costUsd: null, contextTokens: 80000 },
    },
    nudges: 1,
    decisions: 3,
    recoveries: 0,
  };
  it("sums cost per role, keeps the peak context, and times each status", () => {
    const score = scoreStats(stats, new Date("2026-01-05T11:00:00Z"));
    expect(score.costUsd).toBe(5);
    expect(score.byRole.owner).toEqual({ agents: 1, models: ["claude/claude-opus-5-5"], costUsd: 4.5, peakContextTokens: 140000, turns: 12, activeMs: 600000 });
    expect(score.byRole.implementer?.agents).toBe(2);
    expect(score.byRole.implementer?.peakContextTokens).toBe(80000);
    expect(score.timePerStatusMs).toEqual({ Queued: 60000, Planning: 600000, "In Progress": 1800000, Done: 1140000 });
    expect([score.decisions, score.nudges, score.recoveries]).toEqual([3, 1, 0]);
  });
});

describe("countRecords", () => {
  it("counts the records and the FINAL", () => {
    const text = "x\n<!-- taro:notes -->\nEXECUTION a\n\nRISKS 2026 — one\n\nEVIDENCE t — x\ncheck: y\n\nEVIDENCE t2\n\nRULING a - b - c\n<!-- /taro:notes -->\n<!-- taro:final-summary -->\nFINAL x\n<!-- /taro:final-summary -->";
    expect(countRecords(text)).toEqual({ RISKS: 1, RULING: 1, EVIDENCE: 2, FINAL: 1 });
  });
  it("has no FINAL when its section is empty", () => {
    expect(countRecords("<!-- taro:notes -->\nEXECUTION a\n<!-- /taro:notes -->\n<!-- taro:final-summary -->\n\n<!-- /taro:final-summary -->").FINAL).toBe(0);
  });
});

describe("the decider's log", () => {
  const answer = (kind: string, preference: string, briefAnswered: boolean) =>
    JSON.stringify({ type: "answer", at: "t", kind, id: "q", via: "ui", choice: "A", text: "", preference, briefAnswered });
  const log = [
    JSON.stringify({ type: "prompt", at: "t", kind: "question", id: "q", text: "?" }),
    answer("question", "P1", false),
    answer("question", "none", true),
    answer("question", "none", false),
    answer("plan", "none", false),
    JSON.stringify({ type: "violation", at: "t", kind: "card-missing", detail: "no plan card in 2 minutes" }),
    "not json",
  ].join("\n");
  it("counts questions, preference hits and questions the brief answered", () => {
    expect(scoreQuestions(log)).toEqual({ asked: 3, preferenceHits: 1, redundant: 1 });
  });
  it("collects the violations it logged", () => {
    expect(loggedViolations(log)).toEqual([{ kind: "card-missing", detail: "no plan card in 2 minutes" }]);
  });
});
