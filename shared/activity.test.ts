import { describe, expect, it } from "vitest";

import { latestActivity, toolActivity } from "./activity";

const shell = (command: string) => toolActivity({ type: "tool_call", name: "Bash", detail: { type: "shell", command } });

describe("toolActivity", () => {
  it("names what a shell command is for", () => {
    expect(shell("npm test > /tmp/test.log 2>&1")).toBe("running tests");
    expect(shell("cd /home/user/project && npx vitest run client/card-now.test.ts")).toBe("running tests");
    expect(shell("npm run typecheck")).toBe("type-checking");
    expect(shell("node tools/phone.cjs /pw out.png Board")).toBe("taking screenshots");
    expect(shell("git -c user.name=x commit -m 'fix: y'")).toBe("committing");
    expect(shell("git rebase main")).toBe("rebasing");
    expect(shell("taro ticket edit NA-001 --append-notes 'x'")).toBe("updating the ticket");
    expect(shell("cd /tracker && TARO_TRACKER=/tracker taro ticket view NA-001")).toBe("updating the ticket");
    expect(shell("paseo run -d --provider claude/x 'brief'")).toBe("managing agents");
    expect(shell("grep -rn lastStatus server")).toBe("searching the code");
    expect(shell("npm install")).toBe("installing dependencies");
  });

  it("falls back to the program run, or a plain phrase for an empty command", () => {
    expect(shell("/usr/local/bin/python3 scripts/migrate.py")).toBe("running python3");
    expect(shell("")).toBe("running a command");
  });

  it("names files by their base name", () => {
    expect(toolActivity({ type: "tool_call", name: "Read", detail: { type: "read", filePath: "/home/user/project/client/card-now.ts" } })).toBe("reading card-now.ts");
    expect(toolActivity({ type: "tool_call", name: "Edit", detail: { type: "edit", filePath: "/home/user/project/shared/board.ts" } })).toBe("editing board.ts");
    expect(toolActivity({ type: "tool_call", name: "Write", detail: { type: "write", filePath: "" } })).toBe("editing");
  });

  it("covers searches, the web, subagents and other tools", () => {
    expect(toolActivity({ type: "tool_call", name: "Grep", detail: { type: "search", toolName: "grep" } })).toBe("searching the code");
    expect(toolActivity({ type: "tool_call", name: "WebSearch", detail: { type: "search", toolName: "web_search" } })).toBe("searching the web");
    expect(toolActivity({ type: "tool_call", name: "WebFetch", detail: { type: "fetch" } })).toBe("reading a web page");
    expect(toolActivity({ type: "tool_call", name: "Task", detail: { type: "sub_agent" } })).toBe("running a subagent");
    expect(toolActivity({ type: "tool_call", name: "mcp__paseo__browser_screenshot", detail: { type: "unknown" } })).toBe("taking screenshots");
    expect(toolActivity({ type: "tool_call", name: "mcp__paseo__browser_click", detail: { type: "unknown" } })).toBe("using the browser");
    expect(toolActivity({ type: "tool_call", name: "mcp__paseo__create_agent", detail: { type: "unknown" } })).toBe("using create agent");
    expect(toolActivity({ type: "tool_call", detail: { type: "unknown" } })).toBe("working");
    expect(toolActivity({ type: "tool_call", name: "Task notification", detail: { type: "plain_text", label: "Run integration suite" } })).toBe("reading a background task's result");
  });
});

describe("latestActivity", () => {
  it("takes the last tool call, past the words after it", () => {
    const entries = [
      { item: { type: "tool_call", name: "Read", detail: { type: "read", filePath: "/a/b.ts" } }, timestamp: "2026-01-01T10:00:00Z" },
      { item: { type: "tool_call", name: "Bash", detail: { type: "shell", command: "npm test" } }, timestamp: "2026-01-01T10:01:00Z" },
      { item: { type: "assistant_message" }, timestamp: "2026-01-01T10:02:00Z" },
    ];
    expect(latestActivity(entries)).toEqual({ text: "running tests", at: "2026-01-01T10:01:00Z" });
  });

  it("is null without a tool call", () => {
    expect(latestActivity([])).toBeNull();
    expect(latestActivity([{ item: { type: "user_message" }, timestamp: "2026-01-01T10:00:00Z" }])).toBeNull();
  });
});
