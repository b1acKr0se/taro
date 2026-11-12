import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parsePlanted, parsePytest, scoreCards, runTestCommand, peakContextOf, storedAgentRecord, storedSessionIdOf, conformanceOf, countPermissions, countRecords, loggedViolations, parseNodeTest, parseTestOutput, parseUnittest, scoreQuestions, scoreStats } from "./score.ts";

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
  it("counts the permission asks it answered, and the ones it denied", () => {
    const ask = (decision: string) => JSON.stringify({ type: "permission", at: "t", tool: "Bash", detail: "cd /tmp/x; rm -rf y", decision, via: "ui" });
    expect(countPermissions([ask("allow"), ask("deny"), ask("allow"), "not json"].join("\n"))).toEqual({ asked: 3, denied: 1 });
    expect(countPermissions("")).toEqual({ asked: 0, denied: 0 });
  });
  it("collects the violations it logged", () => {
    expect(loggedViolations(log)).toEqual([{ kind: "card-missing", detail: "no plan card in 2 minutes" }]);
  });
});

describe("conformanceOf", () => {
  const building = `---
schema: 1
id: "AB-002"
title: "Pin notes"
status: "In Progress"
priority: null
labels: ["complexity-low"]
parent: null
depends_on: []
created: "2026-01-05T10:00:00Z"
updated: "2026-01-05T11:00:00Z"
---

## Notes

<!-- taro:notes -->
EXECUTION 2026-01-05T10:02Z — building
<!-- /taro:notes -->
`;

  it("reports a build that skipped Planning and the plugin's nudges", () => {
    const found = conformanceOf(building, 2, [{ from: "Queued", to: "In Progress", at: "2026-01-05T10:03:00.000Z" }]).map((violation) => violation.kind);
    expect(found).toContain("status-skip");
    expect(found).toContain("no-approval");
    expect(found).toContain("plugin-correction");
  });
});

describe("peakContextOf", () => {
  const line = (input: number, cacheRead: number, extra: object = {}): string => JSON.stringify({ type: "assistant", message: { usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead } }, ...extra });
  it("is the largest request, not the last: a context that dropped keeps its peak", () => {
    expect(peakContextOf([line(10, 150_000), line(10, 40_000), line(10, 60_000)].join("\n"))).toBe(150_010);
  });
  it("skips sidechains and lines that are not requests", () => {
    expect(peakContextOf([line(10, 90_000), line(10, 400_000, { isSidechain: true }), "not json", JSON.stringify({ type: "user" })].join("\n"))).toBe(90_010);
  });
  it("is null with no request", () => {
    expect(peakContextOf("")).toBeNull();
  });
});

describe("storedSessionIdOf", () => {
  const record = (persistence: unknown): string => JSON.stringify({ id: "agent-1", provider: "claude", cwd: "/home/user/notes-app", persistence });
  it("reads the session id from the daemon's stored agent record", () => {
    expect(storedSessionIdOf(record({ provider: "claude", sessionId: "11111111-2222-3333-4444-555555555555", nativeHandle: "x", metadata: { cwd: "/home/user/notes-app" } }))).toBe("11111111-2222-3333-4444-555555555555");
  });
  it("is null for another provider, no persistence, an empty id or text that is not JSON", () => {
    expect(storedSessionIdOf(record({ provider: "codex", sessionId: "abc" }))).toBeNull();
    expect(storedSessionIdOf(record(null))).toBeNull();
    expect(storedSessionIdOf(record({ provider: "claude", sessionId: "" }))).toBeNull();
    expect(storedSessionIdOf("Agent a1")).toBeNull();
  });
});

describe("storedAgentRecord", () => {
  it("finds <home>/agents/<slug>/<agentId>.json, and null for a missing agent or an unsafe id", () => {
    const home = mkdtempSync(join(tmpdir(), "taro-bench-test."));
    try {
      mkdirSync(join(home, "agents", "home-user-notes-app"), { recursive: true });
      writeFileSync(join(home, "agents", "home-user-notes-app", "agent-1.json"), '{"id":"agent-1"}');
      expect(storedAgentRecord(home, "agent-1")).toBe('{"id":"agent-1"}');
      expect(storedAgentRecord(home, "agent-2")).toBeNull();
      expect(storedAgentRecord(home, "../agent-1")).toBeNull();
      expect(storedAgentRecord(join(home, "none"), "agent-1")).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("parsePytest", () => {
  it("reads passed and failed from the summary line, quiet or verbose", () => {
    expect(parsePytest("........F\n8 failed, 177 passed in 3.21s\n")).toEqual({ passed: 177, total: 185 });
    expect(parsePytest("============ 3 failed, 10 passed, 2 skipped, 1 warning in 0.5s ============\n")).toEqual({ passed: 12, total: 15 });
    expect(parsePytest("201 passed in 12.00s (0:00:12)\n")).toEqual({ passed: 201, total: 201 });
    expect(parsePytest("1 error in 0.1s\n")).toEqual({ passed: 0, total: 1 });
  });
  it("is null when only a traceback printed or nothing ran (pytest_output_unparseable)", () => {
    expect(parsePytest("Traceback (most recent call last):\n  File \"<frozen runpy>\", line 189\nModuleNotFoundError: No module named 'pytest'\n")).toBeNull();
    expect(parsePytest("no tests ran in 0.01s\n")).toBeNull();
    expect(parsePytest("")).toBeNull();
    expect(parseTestOutput("Traceback (most recent call last):\nModuleNotFoundError\n")).toBeNull();
  });
  it("parseTestOutput reads pytest too", () => {
    expect(parseTestOutput("2 failed, 5 passed in 0.2s\n")).toEqual({ passed: 5, total: 7 });
  });
});

describe("parsePlanted", () => {
  const line = (number: number, outcome: string): string => `hidden_tests/suite_planted/test_planted.py::test_planted_${number}_some_name ${outcome} [ ${number}%]`;
  it("planted_counts_passing_planted_tests", () => {
    const some = [line(1, "PASSED"), line(2, "FAILED"), line(3, "PASSED"), line(4, "FAILED"), line(5, "PASSED"), line(6, "FAILED"), line(7, "FAILED"), line(8, "FAILED")].join("\n");
    expect(parsePlanted(some)).toEqual({ caught: 3, total: 8 });
    expect(parsePlanted(Array.from({ length: 8 }, (_, index) => line(index + 1, "FAILED")).join("\n"))).toEqual({ caught: 0, total: 8 });
    expect(parsePlanted(Array.from({ length: 8 }, (_, index) => line(index + 1, "PASSED")).join("\n"))).toEqual({ caught: 8, total: 8 });
  });
  it("counts a planted test once and an erroring one as not caught", () => {
    expect(parsePlanted([line(1, "PASSED"), line(1, "PASSED"), line(2, "ERROR")].join("\n"))).toEqual({ caught: 1, total: 8 });
  });
  it("is null when the suite is missing or the runner printed no test lines", () => {
    expect(parsePlanted("hidden_tests/suite_minisheet/test_lexer.py::test_a PASSED\n")).toBeNull();
    expect(parsePlanted("Traceback (most recent call last):\nModuleNotFoundError\n")).toBeNull();
    expect(parsePlanted("")).toBeNull();
  });
});

describe("runTestCommand", () => {
  const fake = (installCode = 0, testCode = 0) => {
    const calls: { command: string; args: readonly string[]; env?: Record<string, string | undefined>; cwd?: string }[] = [];
    const removed: string[] = [];
    const tools = {
      run: async (command: string, args: readonly string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}) => {
        calls.push({ command, args, ...options });
        const installing = args.includes("pip");
        return { code: installing ? installCode : testCode, stdout: installing ? "" : "1 passed in 0.1s", stderr: "", timedOut: false };
      },
      makeDirectory: () => "/tmp/taro-bench-pytest.Ab12Cd",
      remove: (path: string) => void removed.push(path),
    };
    return { calls, removed, tools };
  };
  const command = 'PYTHONPATH="$PYTEST_PATH:src:." python3 -m pytest hidden_tests -v';

  it("pytest_target_installed_and_removed", async () => {
    const { calls, removed, tools } = fake();
    const outcome = await runTestCommand(command, "/tmp/taro-bench-hidden.X", tools);
    expect(calls[0]).toMatchObject({ command: "python3", args: ["-m", "pip", "install", "-q", "--target", "/tmp/taro-bench-pytest.Ab12Cd", "pytest"] });
    expect(calls[1]?.command).toBe("sh");
    expect(calls[1]?.args).toEqual(["-c", command]);
    expect(calls[1]?.env?.PYTEST_PATH).toBe("/tmp/taro-bench-pytest.Ab12Cd");
    expect(calls[1]?.cwd).toBe("/tmp/taro-bench-hidden.X");
    expect(removed).toEqual(["/tmp/taro-bench-pytest.Ab12Cd"]);
    expect(outcome.output).toContain("1 passed");
  });
  it("installs the task's extra packages in the same call", async () => {
    const { calls, tools } = fake();
    await runTestCommand(command, "/tmp/taro-bench-hidden.X", tools, ["playwright==1.62.0"]);
    expect(calls[0]?.args.slice(-2)).toEqual(["pytest", "playwright==1.62.0"]);
  });
  it("removes the folder when the install fails, and does not run the tests", async () => {
    const { calls, removed, tools } = fake(1);
    const outcome = await runTestCommand(command, "/tmp/taro-bench-hidden.X", tools);
    expect(calls).toHaveLength(1);
    expect(removed).toEqual(["/tmp/taro-bench-pytest.Ab12Cd"]);
    expect(outcome.output).toContain("pytest install failed");
    expect(parseTestOutput(outcome.output)).toBeNull();
  });
  it("installs nothing for a command that does not use pytest", async () => {
    const { calls, removed, tools } = fake();
    await runTestCommand("python3 -m unittest discover -s tests", "/tmp/taro-bench-hidden.X", tools);
    expect(calls).toHaveLength(1);
    expect(removed).toEqual([]);
  });
});

describe("scoreCards", () => {
  const answer = (at: string, kind: string, id: string, choice: string, preference = "none") => JSON.stringify({ type: "answer", at, kind, id, via: "rpc", choice, text: "", preference, briefAnswered: false });
  const ticketWith = (notes: string) => `---\nid: "AB-001"\n---\n\n<!-- taro:notes -->\n${notes}\n<!-- /taro:notes -->\n`;
  const ticket = ticketWith("APPROVAL 2026-01-05T10:10Z — the user: \"Approve the plan\"");

  it("counts nothing when the log is empty", () => {
    expect(scoreCards("", ticket)).toEqual({ cardsAfterApproval: 0, userMinutesModelled: 0, preferences: { beforeApproval: 0, afterApproval: 0 } });
  });

  it("has no cards after approval when every question came before it", () => {
    const log = [
      answer("2026-01-05T10:02:00.000Z", "question", "q1#Format", "YAML", "P1"),
      answer("2026-01-05T10:03:00.000Z", "question", "q2#Name", "slug", "P2"),
      answer("2026-01-05T10:10:00.000Z", "plan", "scope-approval", "Approve"),
      answer("2026-01-05T10:50:00.000Z", "acceptance", "accept", "Accept"),
    ].join("\n");
    expect(scoreCards(log, ticket)).toEqual({ cardsAfterApproval: 0, userMinutesModelled: 4 * 30, preferences: { beforeApproval: 2, afterApproval: 0 } });
  });

  it("counts a question card once however many questions it holds, and ignores the plan and Accept", () => {
    const log = [
      answer("2026-01-05T10:10:00.000Z", "plan", "scope-approval", "Approve"),
      answer("2026-01-05T10:20:00.000Z", "question", "q1#Format", "YAML", "P1"),
      answer("2026-01-05T10:20:00.000Z", "question", "q1#Name", "slug", "P2"),
      answer("2026-01-05T10:30:00.000Z", "question", "q2#Order", "newest", "none"),
      answer("2026-01-05T10:50:00.000Z", "acceptance", "accept", "Accept"),
    ].join("\n");
    expect(scoreCards(log, ticket, 10)).toEqual({ cardsAfterApproval: 2, userMinutesModelled: 4 * 10, preferences: { beforeApproval: 0, afterApproval: 2 } });
  });

  it("counts from the first Approve of the round after a Request changes", () => {
    const log = [
      answer("2026-01-05T10:02:00.000Z", "plan", "scope-approval", "Request changes"),
      answer("2026-01-05T10:05:00.000Z", "question", "q1#Format", "YAML", "P1"),
      answer("2026-01-05T10:10:00.000Z", "plan", "scope-approval", "Approve"),
      answer("2026-01-05T10:20:00.000Z", "question", "q2#Name", "slug", "P2"),
      answer("2026-01-05T10:25:00.000Z", "plan", "scope-approval", "Request changes"),
      answer("2026-01-05T10:30:00.000Z", "plan", "scope-approval", "Approve"),
      answer("2026-01-05T10:40:00.000Z", "question", "q3#Order", "newest", "none"),
    ].join("\n");
    expect(scoreCards(log, ticket)).toEqual({ cardsAfterApproval: 2, userMinutesModelled: 7 * 30, preferences: { beforeApproval: 1, afterApproval: 1 } });
  });

  it("counts a preference answered twice once, on the side of its first answer", () => {
    const log = [
      answer("2026-01-05T10:05:00.000Z", "question", "q1#Format", "YAML", "P1"),
      answer("2026-01-05T10:10:00.000Z", "plan", "scope-approval", "Approve"),
      answer("2026-01-05T10:20:00.000Z", "question", "q2#Format", "YAML again", "P1"),
      answer("2026-01-05T10:21:00.000Z", "question", "q3#Both", "both", "P2, P2"),
    ].join("\n");
    expect(scoreCards(log, ticket).preferences).toEqual({ beforeApproval: 1, afterApproval: 1 });
  });

  it("takes the ticket's APPROVAL when the log has no Approve, and counts everything before a run that was never approved", () => {
    const log = [answer("2026-01-05T10:05:00.000Z", "question", "q1#A", "x", "P1"), answer("2026-01-05T10:20:00.000Z", "question", "q2#B", "y", "P2")].join("\n");
    expect(scoreCards(log, ticket)).toEqual({ cardsAfterApproval: 1, userMinutesModelled: 60, preferences: { beforeApproval: 1, afterApproval: 1 } });
    expect(scoreCards(log, ticketWith("EXECUTION x"))).toEqual({ cardsAfterApproval: 0, userMinutesModelled: 60, preferences: { beforeApproval: 2, afterApproval: 0 } });
  });
});
