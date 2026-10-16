import { describe, expect, it } from "vitest";

import { humanizeToolName, isPaseoToolName, joinsRuns, stripCwdPrefix, toolDisplay, toolRunTitle, toolTally, type ToolDetail } from "./tool-wording";

const CWD = "/home/user/notes-app";
const shell = (command: string) => toolDisplay({ type: "shell", command }, "Bash", CWD);
const title = (calls: [ToolDetail, string][]) => toolRunTitle(calls.map(([detail, name]) => toolTally(detail, name)));

describe("toolDisplay", () => {
  it("shows a command whole under Shell, never one word of it (TR-150: it read “Ran -u”)", () => {
    const command = "T=$(date -u +%Y-%m-%dT%H:%MZ); taro ticket edit NA-12 --append-notes \"MILESTONE $T — tests pass\"";
    expect(shell(command)).toEqual({ label: "Shell", summary: command, icon: "SquareTerminal" });
    expect(shell("env -u AGENT_ID paseo archive 3f2a --home /tmp/paseo-test").summary).toBe("env -u AGENT_ID paseo archive 3f2a --home /tmp/paseo-test");
    expect(shell("cd /home/user/notes-app; for f in a.ts b.ts; do grep -n x $f; done").summary).toContain("for f in a.ts b.ts");
    expect(shell("python3 - <<'EOF'\np='notes.ts'\nEOF").summary).toBe("python3 - <<'EOF'\np='notes.ts'\nEOF");
  });

  it("shows a file's path, inside the agent's folder from there, elsewhere whole", () => {
    expect(toolDisplay({ type: "read", filePath: `${CWD}/client/notes.ts` }, "Read", CWD)).toEqual({ label: "Read", summary: "client/notes.ts", icon: "Eye" });
    expect(toolDisplay({ type: "read", filePath: "/tmp/evidence/NA-12/after-phone-board.png" }, "Read", CWD)).toEqual({ label: "Read", summary: "/tmp/evidence/NA-12/after-phone-board.png", icon: "Eye" });
    expect(toolDisplay({ type: "edit", filePath: `${CWD}/README.md` }, "Edit", CWD)).toEqual({ label: "Edit", summary: "README.md", icon: "Pencil" });
    expect(toolDisplay({ type: "write", filePath: `${CWD}/a.ts` }, "Write", null)).toEqual({ label: "Write", summary: `${CWD}/a.ts`, icon: "Pencil" });
  });

  it("labels searches, pages, subagents and plans as Paseo does", () => {
    expect(toolDisplay({ type: "search", query: "toolRunSummary", toolName: "grep" }, "Grep")).toEqual({ label: "Search", summary: "toolRunSummary", icon: "Search" });
    expect(toolDisplay({ type: "fetch", url: "https://docs.example.com/guide" }, "WebFetch")).toEqual({ label: "Fetch", summary: "https://docs.example.com/guide", icon: "Search" });
    expect(toolDisplay({ type: "sub_agent", subAgentType: "Explore", description: "Find the board code" }, "Task")).toEqual({ label: "Explore", summary: "Find the board code", icon: "Bot" });
    expect(toolDisplay({ type: "sub_agent" }, "Task")).toEqual({ label: "Task", icon: "Bot" });
    expect(toolDisplay({ type: "plan" }, "ExitPlanMode")).toEqual({ label: "Plan", icon: "Brain" });
    expect(toolDisplay({ type: "worktree_setup", branchName: "feature/notes" }, "worktree_setup")).toEqual({ label: "Worktree setup", summary: "feature/notes", icon: "SquareTerminal" });
  });

  it("names any other tool by its name, made readable, with what it said", () => {
    expect(toolDisplay({ type: "plain_text", label: "Monitor event: \"board changes\"" }, "task_notification")).toEqual({ label: "Task notification", summary: "Monitor event: \"board changes\"", icon: "Wrench" });
    expect(toolDisplay({ type: "plain_text", label: "taro", icon: "sparkles" }, "Skill")).toEqual({ label: "Skill", summary: "taro", icon: "Sparkles" });
    expect(toolDisplay({ type: "unknown" }, "mcp__paseo__get_agent_activity")).toEqual({ label: "Get agent activity", icon: "Wrench" });
    expect(toolDisplay({ type: "unknown" }, "TaskStop")).toEqual({ label: "Taskstop", icon: "Wrench" });
    expect(toolDisplay({ type: "unknown" }, "task", null, { subAgentActivity: "Reading files" })).toEqual({ label: "Task", summary: "Reading files", icon: "Bot" });
    expect(toolDisplay({ type: "unknown" }, "thinking")).toEqual({ label: "Thinking", icon: "Brain" });
    expect(toolDisplay({ type: "plain_text", label: "npm run dev" }, "terminal")).toEqual({ label: "Terminal", summary: "npm run dev", icon: "Wrench" });
    expect(toolDisplay({ type: "unknown" }, "speak")).toEqual({ label: "Speak", icon: "MicVocal" });
  });

  it("never leaves an empty summary", () => {
    expect(shell("")).toEqual({ label: "Shell", icon: "SquareTerminal" });
    expect(toolDisplay({ type: "sub_agent", subAgentType: "", description: "" }, "Task")).toEqual({ label: "Task", icon: "Bot" });
  });
});

describe("humanizeToolName and isPaseoToolName", () => {
  it("reads Paseo's MCP tools by their own name and leaves other namespaced names alone", () => {
    expect(isPaseoToolName("mcp__paseo__create_agent")).toBe(true);
    expect(isPaseoToolName("paseo.create_agent")).toBe(true);
    expect(isPaseoToolName("mcp__paseo_dev__list_agents")).toBe(true);
    expect(isPaseoToolName("mcp__github__create_issue")).toBe(false);
    expect(isPaseoToolName("paseo__speak")).toBe(false);
    expect(humanizeToolName("mcp__paseo__create_agent")).toBe("Create agent");
    expect(humanizeToolName("mcp__github__create_issue")).toBe("mcp__github__create_issue");
    expect(humanizeToolName("web-search.v2")).toBe("web-search.v2");
    expect(humanizeToolName("  ")).toBe("  ");
  });
});

describe("stripCwdPrefix", () => {
  it("cuts the folder only at a path boundary", () => {
    expect(stripCwdPrefix("/home/user/notes-app/a.ts", "/home/user/notes-app/")).toBe("a.ts");
    expect(stripCwdPrefix("/home/user/notes-app", "/home/user/notes-app")).toBe(".");
    expect(stripCwdPrefix("/home/user/notes-app-2/a.ts", "/home/user/notes-app")).toBe("/home/user/notes-app-2/a.ts");
    expect(stripCwdPrefix("C:\\notes\\a.ts", "C:\\notes")).toBe("a.ts");
    expect(stripCwdPrefix("", "/home/user")).toBe("");
  });
});

describe("toolRunTitle", () => {
  it("reads like Paseo's: kinds in its order, joined with a serial “and”", () => {
    expect(
      title([
        [{ type: "plain_text", label: "Monitor event" }, "task_notification"],
        [{ type: "shell", command: "taro ticket view NA-12" }, "Bash"],
        [{ type: "shell", command: "git fetch origin -q" }, "Bash"],
        [{ type: "read", filePath: "/tmp/after-phone-owner.png" }, "Read"],
      ]),
    ).toBe("Ran 2 commands, read 1 file, and used 1 other tool");
    expect(title([[{ type: "shell", command: "ls" }, "Bash"], [{ type: "read", filePath: "/a" }, "Read"]])).toBe("Ran 1 command and read 1 file");
    expect(title([[{ type: "shell", command: "ls" }, "Bash"]])).toBe("Ran 1 command");
    expect(title([])).toBe("");
  });

  it("counts a file once however often it was read or changed", () => {
    const read = (filePath: string): [ToolDetail, string] => [{ type: "read", filePath }, "Read"];
    expect(title([read("/a.ts"), read("/a.ts"), read("/b.ts"), [{ type: "edit", filePath: "/a.ts" }, "Edit"], [{ type: "write", filePath: "/a.ts" }, "Write"]])).toBe("Edited 1 file and read 2 files");
  });

  it("counts searches, web searches, other tools and Paseo calls apart", () => {
    expect(
      title([
        [{ type: "search", query: "x" }, "Grep"],
        [{ type: "unknown" }, "mcp__exa__web_search"],
        [{ type: "unknown" }, "TodoWrite"],
        [{ type: "unknown" }, "mcp__paseo__list_agents"],
        [{ type: "unknown" }, "paseo_send"],
        [{ type: "sub_agent", description: "Review" }, "Task"],
      ]),
    ).toBe("Searched 2 times, used 2 other tools, and called Paseo 2 times");
  });
});

describe("joinsRuns", () => {
  it("keeps a plan and a spoken reply out of a run", () => {
    expect(joinsRuns({ type: "plan" }, "ExitPlanMode")).toBe(false);
    expect(joinsRuns({ type: "unknown" }, "speak")).toBe(false);
    expect(joinsRuns({ type: "shell", command: "ls" }, "Bash")).toBe(true);
  });
});
