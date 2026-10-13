import { describe, expect, it } from "vitest";

import { parseDecisionBlocks, parseStatusLine, withoutDecisionBlocks } from "./reports";

describe("parseStatusLine", () => {
  it("reads the last line", () => {
    expect(parseStatusLine("Did it.\n\ndone: PR https://x/1 ready")).toEqual({ state: "done", text: "PR https://x/1 ready" });
    expect(parseStatusLine("waiting: helper SC-1.2 on the API")).toEqual({ state: "waiting", text: "helper SC-1.2 on the API" });
  });

  it("tolerates markdown emphasis and case", () => {
    expect(parseStatusLine("**Blocked**: needs a token")).toEqual({ state: "blocked", text: "needs a token" });
    expect(parseStatusLine("`done: shipped`")).toEqual({ state: "done", text: "shipped" });
  });

  it("ignores a state word far above the end", () => {
    expect(parseStatusLine("done: early\none\ntwo\nthree\nfour")).toBeNull();
  });

  it("returns null without a status line", () => {
    expect(parseStatusLine("All finished, nothing else.")).toBeNull();
  });
});

const BLOCK = [
  "Here is my question.",
  "",
  "```decision",
  "id: fee-storage            # unique within the ticket",
  "question: Store fees per trade or aggregate hourly?",
  'why: "Hourly loses audit; per-trade is ~40× bigger"',
  "blocking: false",
  "options:",
  "  - label: Per trade",
  "    prompt: Store fees per trade",
  "    consequence: full audit",
  "  - label: Hourly",
  "    prompt: Aggregate fees hourly",
  "recommended: Per trade",
  "reason: audits need it",
  "default: Per trade",
  "```",
  "",
  "waiting: your choice on fee storage",
].join("\n");

describe("parseDecisionBlocks", () => {
  it("reads a complete block", () => {
    const [decision] = parseDecisionBlocks(BLOCK);
    expect(decision).toMatchObject({
      id: "fee-storage",
      question: "Store fees per trade or aggregate hourly?",
      why: "Hourly loses audit; per-trade is ~40× bigger",
      blocking: false,
      recommended: "Per trade",
      reason: "audits need it",
      default: "Per trade",
      withdrawn: false,
      problems: [],
    });
    expect(decision?.options).toEqual([
      { label: "Per trade", prompt: "Store fees per trade", consequence: "full audit" },
      { label: "Hourly", prompt: "Aggregate fees hourly", consequence: "" },
    ]);
  });

  it("reports what is missing instead of failing", () => {
    const [decision] = parseDecisionBlocks("```decision\nquestion: Which?\noptions:\n  - label: A\n```");
    expect(decision?.problems).toEqual(["no recommended option", "no reason for the recommendation", "no id"]);
    expect(decision?.options).toEqual([{ label: "A", prompt: "A", consequence: "" }]);
    expect(decision?.id).toMatch(/^untitled-/);
  });

  it("reads several blocks, blocking flags and withdrawal", () => {
    const text = "```decision\nid: a\nquestion: Q1\nblocking: true\noptions:\n  - label: X\nrecommended: X\nreason: r\n```\n```decision\nid: b\nstatus: withdrawn\n```";
    const decisions = parseDecisionBlocks(text);
    expect(decisions.map((decision) => [decision.id, decision.blocking, decision.withdrawn])).toEqual([
      ["a", true, false],
      ["b", false, true],
    ]);
  });

  it("strips blocks from the text the chat shows", () => {
    expect(withoutDecisionBlocks(BLOCK)).toBe("Here is my question.\n\nwaiting: your choice on fee storage");
  });

  it("flags a recommendation that names no option", () => {
    const [decision] = parseDecisionBlocks("```decision\nid: x\nquestion: Q\noptions:\n  - label: A\nrecommended: B\nreason: r\n```");
    expect(decision?.problems).toEqual(["recommended names no option"]);
  });
});
