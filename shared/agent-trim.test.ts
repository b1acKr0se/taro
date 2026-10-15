import { describe, expect, it } from "vitest";

import {
  contextRecord,
  firstRequestTokens,
  HIDDEN_SKILLS,
  isTrimmedLaunch,
  isTrimmedTool,
  STARTING_CONTEXT_LIMIT,
  toolMissRecord,
  toolMisses,
  TRIMMED_TOOLS,
  withTrimmedTools,
} from "./agent-trim";
import { ticketMilestones } from "./milestones";

const taroEnv = { TARO_PROJECT: "notes-app", TARO_TRACKER: "/home/user/tracker", TARO_SKILL: "/home/user/skill" };

describe("the trimmed lists", () => {
  // Every role uses these (TR-139's inventory); removing one breaks an owner or a subagent.
  const needed = ["Bash", "Read", "Edit", "Write", "NotebookEdit", "Monitor", "TaskStop", "Skill", "WebFetch", "WebSearch", "ReportFindings", "Glob", "Grep"];

  it("never removes a tool a role uses, nor another project's MCP server", () => {
    for (const tool of needed) expect(isTrimmedTool(tool)).toBe(false);
    expect(isTrimmedTool("mcp__plugin_mongodb_mongodb__aggregate")).toBe(false);
    expect(isTrimmedTool("mcp__paseoish__tool")).toBe(false);
  });

  it("removes Paseo's whole MCP server and the tools no role uses", () => {
    expect(TRIMMED_TOOLS).toContain("mcp__paseo");
    for (const tool of ["mcp__paseo__create_agent", "mcp__paseo__browser_screenshot", "Agent", "SendMessage", "AskUserQuestion", "ExitPlanMode", "CronCreate", "ScheduleWakeup", "DesignSync"]) {
      expect(isTrimmedTool(tool)).toBe(true);
    }
  });

  it("hides only Paseo's agent skills and loop, keeping the user's own and project skills", () => {
    expect([...HIDDEN_SKILLS].sort()).toEqual(["loop", "paseo", "paseo-advisor", "paseo-committee", "paseo-handoff", "paseo-help"]);
    for (const kept of ["paseo-plugin", "taro", "lean-spec", "lean-implement", "claude-api", "run", "code-review", "mongo-env"]) expect(HIDDEN_SKILLS).not.toContain(kept);
  });
});

describe("isTrimmedLaunch", () => {
  it("trims a Claude owner or subagent carrying the Taro environment, with or without a model in the provider", () => {
    expect(isTrimmedLaunch({ provider: "claude", env: taroEnv, inManagerHome: false })).toBe(true);
    expect(isTrimmedLaunch({ provider: "claude/claude-sonnet-5-5", env: taroEnv, inManagerHome: false })).toBe(true);
  });

  it("leaves the manager, the user's own agents and other providers as they are", () => {
    expect(isTrimmedLaunch({ provider: "claude", env: taroEnv, inManagerHome: true })).toBe(false);
    expect(isTrimmedLaunch({ provider: "claude", env: undefined, inManagerHome: false })).toBe(false);
    expect(isTrimmedLaunch({ provider: "claude", env: {}, inManagerHome: false })).toBe(false);
    expect(isTrimmedLaunch({ provider: "claude", env: { TARO_PROJECT: "" }, inManagerHome: false })).toBe(false);
    expect(isTrimmedLaunch({ provider: "codex", env: taroEnv, inManagerHome: false })).toBe(false);
    expect(isTrimmedLaunch({ provider: "claudette", env: taroEnv, inManagerHome: false })).toBe(false);
  });
});

describe("withTrimmedTools", () => {
  it("adds the trimmed tools and keeps the other options and tools already disallowed, once each", () => {
    const options = withTrimmedTools({ allowedTools: ["Bash"], disallowedTools: ["Agent", "WebSearch"], sandbox: { enabled: false } });
    expect(options.allowedTools).toEqual(["Bash"]);
    expect(options.sandbox).toEqual({ enabled: false });
    const disallowed = options.disallowedTools as string[];
    expect(disallowed.slice(0, 2)).toEqual(["Agent", "WebSearch"]);
    expect(new Set(disallowed).size).toBe(disallowed.length);
    for (const tool of TRIMMED_TOOLS) expect(disallowed).toContain(tool);
  });

  it("starts from nothing when there are no options or the field is not a list", () => {
    expect(withTrimmedTools(undefined).disallowedTools).toEqual([...TRIMMED_TOOLS]);
    expect(withTrimmedTools({ disallowedTools: "Agent" }).disallowedTools).toEqual([...TRIMMED_TOOLS]);
  });
});

function call(name: string, status: "completed" | "failed" | "running", error: unknown = null, detail: unknown = { type: "unknown", input: {}, output: null }) {
  return { type: "tool_call", callId: `call-${name}`, name, status, error, detail };
}

describe("toolMisses", () => {
  it("finds nothing in an ordinary turn, failures included", () => {
    expect(toolMisses([])).toEqual([]);
    expect(
      toolMisses([
        { type: "assistant_message", text: "Running the tests" },
        call("Bash", "failed", { message: "Command exited with code 1" }),
        call("Read", "failed", "File does not exist."),
        call("Skill", "completed", null, { type: "unknown", input: { skill: "lean-spec" }, output: null }),
        call("mcp__plugin_mongodb_mongodb__aggregate", "completed"),
      ]),
    ).toEqual([]);
  });

  it("flags a call to a removed tool, a Paseo MCP tool by its server, whatever its status", () => {
    expect(toolMisses([call("mcp__paseo__list_agents", "completed"), call("Agent", "running")])).toEqual([
      { tool: "mcp__paseo__list_agents", reason: "a removed tool" },
      { tool: "Agent", reason: "a removed tool" },
    ]);
  });

  it("flags a hidden skill, and a tool or skill Claude Code refused as missing", () => {
    expect(toolMisses([call("Skill", "failed", "Unknown skill: paseo", { type: "unknown", input: { skill: "paseo" }, output: null })])).toEqual([{ tool: "Skill(paseo)", reason: "a hidden skill" }]);
    expect(toolMisses([call("Skill", "failed", { message: "Unknown skill: deploy" }, { type: "unknown", input: { skill: "deploy" }, output: null })])).toEqual([
      { tool: "Skill", reason: 'refused: {"message":"Unknown skill: deploy"}' },
    ]);
    expect(toolMisses([call("NewTool", "failed", "<tool_use_error>No such tool available: NewTool</tool_use_error>")])).toEqual([
      { tool: "NewTool", reason: "refused: <tool_use_error>No such tool available: NewTool</tool_use_error>" },
    ]);
  });

  it("lists a repeated miss once", () => {
    expect(toolMisses([call("ScheduleWakeup", "failed", "x"), call("ScheduleWakeup", "failed", "y")])).toHaveLength(1);
  });
});

describe("records", () => {
  it("are records the Ticket tab reads, with their time", () => {
    const notes = [
      toolMissRecord("2026-10-16T01:02Z", { id: "agent-1", role: "reviewer" }, [{ tool: "Agent", reason: "a removed tool" }]),
      contextRecord("2026-10-16T01:03Z", { id: "agent-2", role: "owner" }, 41_250),
    ].join("\n\n");
    expect(ticketMilestones(notes).map((record) => [record.kind, record.time])).toEqual([
      ["TOOL-MISS", "2026-10-16T01:02Z"],
      ["CONTEXT", "2026-10-16T01:03Z"],
    ]);
    expect(notes).toContain("Agent (a removed tool)");
    expect(notes).toContain("41,250 tokens");
    expect(notes).toContain(STARTING_CONTEXT_LIMIT.toLocaleString("en-US"));
  });
});

describe("firstRequestTokens", () => {
  const assistant = (usage: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ type: "assistant", message: { role: "assistant", usage }, ...extra });

  it("adds fresh, cache-written and cache-read input", () => {
    expect(firstRequestTokens(assistant({ input_tokens: 2, cache_creation_input_tokens: 53_269, cache_read_input_tokens: 0, output_tokens: 183 }))).toBe(53_271);
    expect(firstRequestTokens(assistant({ input_tokens: 5, cache_read_input_tokens: 19_000 }))).toBe(19_005);
  });

  it("skips other lines, a built-in subagent's, empty usage and broken JSON", () => {
    expect(firstRequestTokens(JSON.stringify({ type: "user", message: { usage: { input_tokens: 9 } } }))).toBeNull();
    expect(firstRequestTokens(assistant({ input_tokens: 9 }, { isSidechain: true }))).toBeNull();
    expect(firstRequestTokens(assistant({ input_tokens: 0 }))).toBeNull();
    expect(firstRequestTokens(assistant("none"))).toBeNull();
    expect(firstRequestTokens('{"type":"assistant","usage":')).toBeNull();
  });
});
