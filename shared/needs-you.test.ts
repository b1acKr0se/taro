import { describe, expect, it } from "vitest";

import { deliveredLine, permissionAsk } from "./needs-you";

describe("permissionAsk", () => {
  it("names a tool by its title and the command it runs", () => {
    expect(permissionAsk({ name: "Bash", kind: "tool", title: "Run a command", input: { command: "npm install --save-dev vitest" } })).toEqual({
      title: "Run a command",
      detail: "npm install --save-dev vitest",
    });
  });

  it("asks to allow the tool by name without a title, acting on a file, an address or the description", () => {
    expect(permissionAsk({ name: "Bash", kind: "tool", input: { command: "ls" } })).toEqual({ title: "Allow Bash?", detail: "ls" });
    expect(permissionAsk({ name: "Edit", kind: "tool", input: { file_path: "/repo/src/index.ts" } })).toEqual({ title: "Allow Edit?", detail: "/repo/src/index.ts" });
    expect(permissionAsk({ name: "WebFetch", kind: "tool", input: { url: "https://example.com" } })).toEqual({ title: "Allow WebFetch?", detail: "https://example.com" });
    expect(permissionAsk({ name: "Custom", kind: "tool", description: "Writes the cache" })).toEqual({ title: "Allow Custom?", detail: "Writes the cache" });
    expect(permissionAsk({ name: "Custom", kind: "tool" })).toEqual({ title: "Allow Custom?", detail: null });
  });

  it("keeps the first line of a multi-line command", () => {
    expect(permissionAsk({ name: "Bash", kind: "tool", input: { command: "\n  cd /repo\nnpm test" } }).detail).toBe("cd /repo");
  });

  it("cuts a very long command", () => {
    const detail = permissionAsk({ name: "Bash", kind: "tool", input: { command: "x".repeat(500) } }).detail ?? "";
    expect(detail.length).toBe(240);
    expect(detail.endsWith("…")).toBe(true);
  });

  it("shows a question form's first question as what is asked", () => {
    const request = { name: "AskUserQuestion", kind: "question", input: { questions: [{ question: "Which port range?" }, { question: "Second?" }] } };
    expect(permissionAsk(request)).toEqual({ title: "Which port range?", detail: null });
  });

  it("treats a question form without questions as a tool", () => {
    expect(permissionAsk({ name: "AskUserQuestion", kind: "question", input: { questions: [] } })).toEqual({ title: "Allow AskUserQuestion?", detail: null });
  });

  it("shows a plan's first line", () => {
    expect(permissionAsk({ name: "ExitPlanMode", kind: "plan", input: { plan: "# Plan\n1. Do it" } })).toEqual({ title: "Approve the plan", detail: "# Plan" });
  });
});

describe("deliveredLine", () => {
  it("is null without a summary", () => {
    expect(deliveredLine(null)).toBeNull();
    expect(deliveredLine("")).toBeNull();
    expect(deliveredLine("FINAL 2026-10-13T17:50Z —\n\n")).toBeNull();
  });

  it("drops the record header and keeps the first sentence", () => {
    expect(deliveredLine("FINAL 2026-10-13T17:50Z — Manager questions are cards in Needs you. Suggestions sit at the composer.")).toBe(
      "Manager questions are cards in Needs you.",
    );
  });

  it("skips blank lines, rules and Markdown markers", () => {
    expect(deliveredLine("\n---\n## **Delivered**: the `board` strip is gone\nmore")).toBe("Delivered: the board strip is gone");
    expect(deliveredLine("- First bullet\n- Second")).toBe("First bullet");
  });

  it("keeps a sentence whole when no capital follows the full stop", () => {
    expect(deliveredLine("Bumped to v1.2 and e.g. kept the API")).toBe("Bumped to v1.2 and e.g. kept the API");
  });
});
