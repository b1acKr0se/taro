import { describe, expect, it } from "vitest";

import { fileName, shellWords, toolAction, toolTally } from "./tool-wording";

const shell = (command: string) => toolAction({ type: "shell", command }, "Bash");

describe("fileName", () => {
  it("keeps the name of a path, whatever its separators", () => {
    expect(fileName("/home/user/project/src/notes.ts")).toBe("notes.ts");
    expect(fileName("C:\\project\\notes.ts")).toBe("notes.ts");
    expect(fileName("notes.ts")).toBe("notes.ts");
    expect(fileName("/home/user/project/src/")).toBe("src");
    expect(fileName("/")).toBe("/");
    expect(fileName("")).toBe("");
  });
});

describe("shellWords", () => {
  it("skips cd steps, assignments, comments and prefixes that only run the next word", () => {
    expect(shellWords("cd /home/user/project && npm test")).toEqual(["npm", "test"]);
    expect(shellWords("CI=1 NODE_ENV=test sudo /usr/bin/git status")).toEqual(["git", "status"]);
    expect(shellWords("# look first\nls -la")).toEqual(["ls", "-la"]);
    expect(shellWords("   ")).toEqual([]);
    expect(shellWords("cd /home/user/project")).toEqual(["cd", "/home/user/project"]);
  });
});

describe("toolAction", () => {
  it("names a file by its name, never its path", () => {
    expect(toolAction({ type: "read", filePath: "/home/user/project/README.md" }, "Read")).toEqual({ text: "Read README.md", category: "read" });
    expect(toolAction({ type: "edit", filePath: "/home/user/project/notes.ts" }, "Edit")).toEqual({ text: "Edited notes.ts", category: "edit" });
    expect(toolAction({ type: "write", filePath: "/home/user/project/new.ts" }, "Write")).toEqual({ text: "Wrote new.ts", category: "edit" });
  });

  it("says what a shell command did instead of the command", () => {
    expect(shell("ls -la")).toEqual({ text: "Listed files", category: "search" });
    expect(shell("grep -r 'notes' --include='*.ts' .")).toEqual({ text: "Searched the code", category: "search" });
    expect(shell("git log --oneline -5")).toEqual({ text: "Looked at the history", category: "read" });
    expect(shell("cd /home/user/project && npm test")).toEqual({ text: "Ran the tests", category: "run" });
    expect(shell("wc -l README.md notes.ts")).toEqual({ text: "Counted lines", category: "read" });
  });

  it("names the file a reading command reads, and only a file", () => {
    expect(shell("cat /home/user/project/README.md")).toEqual({ text: "Read README.md", category: "read" });
    expect(shell("sed -n 1,40p client/notes.ts")).toEqual({ text: "Read notes.ts", category: "read" });
    expect(shell("cat")).toEqual({ text: "Read a file", category: "read" });
    expect(shell("tail -f /var/log/app")).toEqual({ text: "Read a file", category: "read" });
  });

  it("names an unknown program with its subcommand, and a script by its name", () => {
    expect(shell("git push origin main")).toEqual({ text: "Ran git push", category: "run" });
    expect(shell("npm run typecheck > /tmp/log 2>&1")).toEqual({ text: "Ran the typecheck script", category: "run" });
    expect(shell("python3 -I tools/check.py")).toEqual({ text: "Ran python3", category: "run" });
    expect(shell("git --no-pager log")).toEqual({ text: "Ran git", category: "run" });
    expect(shell("")).toEqual({ text: "Ran a command", category: "run" });
  });

  it("quotes searched words, clipped, and tells a web search and a file pattern apart", () => {
    expect(toolAction({ type: "search", query: "toolRunSummary" }, "Grep")).toEqual({ text: "Searched for “toolRunSummary”", category: "search" });
    expect(toolAction({ type: "search", query: "**/*.ts", toolName: "glob" }, "Glob")).toEqual({ text: "Looked for files", category: "search" });
    expect(toolAction({ type: "search", query: "paseo plugin api", toolName: "web_search" }, "WebSearch")).toEqual({ text: "Searched the web for “paseo plugin api”", category: "web" });
    expect(toolAction({ type: "search", query: "x".repeat(60) }, "Grep").text).toBe(`Searched for “${"x".repeat(39)}…”`);
  });

  it("names a fetched page by its host, a subagent by its job, and anything else by its tool", () => {
    expect(toolAction({ type: "fetch", url: "https://docs.example.com/guide?page=2" }, "WebFetch")).toEqual({ text: "Opened docs.example.com", category: "web" });
    expect(toolAction({ type: "fetch", url: "not a url" }, "WebFetch").text).toBe("Opened not a url");
    expect(toolAction({ type: "sub_agent", description: "Review the diff" }, "Task")).toEqual({ text: "Started a subagent: Review the diff", category: "agent" });
    expect(toolAction({ type: "sub_agent" }, "Task").text).toBe("Started a subagent");
    expect(toolAction({ type: "plain_text", label: "Thinking about it" }, "x")).toEqual({ text: "Thinking about it", category: "other" });
    expect(toolAction({ type: "plan" }, "ExitPlanMode")).toEqual({ text: "Wrote a plan", category: "other" });
    expect(toolAction({ type: "unknown" }, "mcp__paseo__create_agent")).toEqual({ text: "create agent", category: "other" });
  });
});

describe("toolTally", () => {
  it("counts each kind once, in the order the agent first did it", () => {
    expect(toolTally(["search", "read", "read", "search", "read", "read"])).toBe("Searched twice, read 4 files");
    expect(toolTally(["run", "edit", "run", "run"])).toBe("Ran 3 commands, changed a file");
  });

  it("says one of a kind in words and counts the rest", () => {
    expect(toolTally(["read"])).toBe("Read a file");
    expect(toolTally(["search", "search", "search"])).toBe("Searched 3 times");
    expect(toolTally(["web", "web", "agent", "other", "other"])).toBe("Looked online twice, started a subagent, 2 other steps");
    expect(toolTally(["agent", "agent", "other"])).toBe("Started 2 subagents, one other step");
  });

  it("is empty for no calls", () => {
    expect(toolTally([])).toBe("");
  });
});
