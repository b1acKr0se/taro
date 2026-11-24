import { describe, expect, it } from "vitest";

import { cutResult, errorWords, readable, RESULT_LIMIT, toolText, toolTiming } from "./tool-detail";
import { noteRunningCalls, watchedStart } from "./tool-watch";

describe("toolText", () => {
  it("shows a shell call's whole command, output and exit code", () => {
    const command = "npm test -- --reporter verbose && echo a-long-command-that-the-line-cuts-off";
    expect(toolText({ type: "shell", command, output: "ok\n", exitCode: 1 })).toEqual({ call: command, result: "ok\n", outcome: "exit code 1" });
    expect(toolText({ type: "shell", command: "ls" })).toEqual({ call: "ls", result: "" });
  });
  it("shows a read's path with its range and content", () => {
    expect(toolText({ type: "read", filePath: "/p/a.ts", content: "x", offset: 10, limit: 5 })).toEqual({ call: "/p/a.ts (from line 10, 5 lines)", result: "x" });
    expect(toolText({ type: "read", filePath: "/p/a.ts", content: "x" }).call).toBe("/p/a.ts");
  });
  it("shows an edit's diff, or its old and new text", () => {
    expect(toolText({ type: "edit", filePath: "/p/a.ts", unifiedDiff: "@@\n-a\n+b" }).result).toBe("@@\n-a\n+b");
    expect(toolText({ type: "edit", filePath: "/p/a.ts", oldString: "a", newString: "b" }).result).toBe("- a\n+ b");
  });
  it("shows a write's content", () => {
    expect(toolText({ type: "write", filePath: "/p/a.ts", content: "hello" })).toEqual({ call: "/p/a.ts", result: "hello" });
  });
  it("shows a search's matches, files or web hits, with its own duration", () => {
    expect(toolText({ type: "search", query: "todo", content: "a.ts:1", durationMs: 40 })).toEqual({ call: "todo", result: "a.ts:1", durationMs: 40 });
    expect(toolText({ type: "search", query: "*.ts", filePaths: ["a.ts", "b.ts"], durationSeconds: 2 })).toEqual({ call: "*.ts", result: "a.ts\nb.ts", durationMs: 2000 });
    expect(toolText({ type: "search", query: "q", webResults: [{ title: "T", url: "https://example.com" }] }).result).toBe("T\nhttps://example.com");
  });
  it("shows a fetch's address, prompt, page and status", () => {
    expect(toolText({ type: "fetch", url: "https://example.com", prompt: "title?", result: "Example", code: 404, codeText: "Not Found", durationMs: 300 })).toEqual({
      call: "https://example.com\ntitle?",
      result: "Example",
      outcome: "HTTP 404 Not Found",
      durationMs: 300,
    });
  });
  it("shows setup, subagent, plain text and plan details", () => {
    expect(toolText({ type: "worktree_setup", branchName: "b", log: "done" })).toEqual({ call: "b", result: "done" });
    expect(toolText({ type: "sub_agent", subAgentType: "Explore", description: "find it", log: "found" })).toEqual({ call: "Explore: find it", result: "found" });
    expect(toolText({ type: "plain_text", label: "Wait", text: "3s" })).toEqual({ call: "Wait", result: "3s" });
    expect(toolText({ type: "plan", text: "step" })).toEqual({ call: "", result: "step" });
  });
  it("shows an unknown detail as its input and output", () => {
    expect(toolText({ type: "unknown", input: { a: 1 }, output: "done" })).toEqual({ call: '{\n  "a": 1\n}', result: "done" });
    expect(toolText(undefined)).toEqual({ call: "", result: "" });
  });
});

describe("readable", () => {
  it("drops colour codes and control characters but keeps lines and tabs", () => {
    expect(readable("\u001b[31mred\u001b[0m\u0000\u0007 ok\r\nnext\tcol")).toBe("red ok\nnext\tcol");
    expect(toolText({ type: "shell", command: "x", output: "a\u0000b" }).result).toBe("ab");
  });
});

describe("errorWords", () => {
  it("reads an error as its message, a string or JSON", () => {
    expect(errorWords({ message: "boom" })).toBe("boom");
    expect(errorWords("bad")).toBe("bad");
    expect(errorWords({ code: 2 })).toBe('{\n  "code": 2\n}');
    expect(errorWords(null)).toBe("");
    expect(errorWords({ type: "tool_result", content: "Exit code 1\nno such file", is_error: true })).toBe("Exit code 1\nno such file");
    expect(errorWords({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] })).toBe("one\ntwo");
  });
});

describe("cutResult", () => {
  it("leaves a short result and cuts a long one with the count left out", () => {
    expect(cutResult("short")).toEqual({ shown: "short", cut: 0 });
    const long = cutResult("x".repeat(RESULT_LIMIT + 7));
    expect(long.shown.length).toBe(RESULT_LIMIT);
    expect(long.cut).toBe(7);
  });
});

describe("toolTiming", () => {
  const at = "2026-11-24T07:17:50.000Z";
  const base = Date.parse(at);
  it("counts a running call from when it last changed, or from when it was watched starting", () => {
    expect(toolTiming({ status: "running", changedAt: at, now: base + 12_000 })).toEqual({ text: "for 12s", ticking: true });
    expect(toolTiming({ status: "running", changedAt: at, now: base + 12_000, watchedStartedAt: base + 2_000 }).text).toBe("for 10s");
    expect(toolTiming({ status: "running", changedAt: undefined, now: base })).toEqual({ text: "", ticking: false });
  });
  it("says took and finished for a call watched to its end", () => {
    const text = toolTiming({ status: "completed", changedAt: at, now: base + 99_000, watchedStartedAt: base - 5_000 }).text;
    expect(text).toMatch(/^took 5s · finished \d\d:\d\d:\d\d$/);
  });
  it("prefers the call's own duration", () => {
    expect(toolTiming({ status: "completed", changedAt: at, now: base, ownMs: 300, watchedStartedAt: base - 5_000 }).text).toMatch(/^took under 1s · finished/);
  });
  it("gives only the finish time for a call it never saw run, and never a duration", () => {
    const timing = toolTiming({ status: "failed", changedAt: at, now: base });
    expect(timing.text).toMatch(/^finished \d\d:\d\d:\d\d$/);
    expect(timing.ticking).toBe(false);
    expect(toolTiming({ status: "completed", changedAt: undefined, now: base }).text).toBe("");
  });
});

describe("noteRunningCalls", () => {
  it("keeps the first sighting", () => {
    noteRunningCalls(["call-a"], 1000);
    noteRunningCalls(["call-a", "call-b"], 5000);
    expect(watchedStart("call-a")).toBe(1000);
    expect(watchedStart("call-b")).toBe(5000);
    expect(watchedStart(undefined)).toBeUndefined();
  });
});
