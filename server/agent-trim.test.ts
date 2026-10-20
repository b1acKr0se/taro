import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { HIDDEN_SKILLS, TRIMMED_TOOLS } from "../shared/agent-trim";
import { trimAgentLaunch, trimmingStartedAt, watchTrimmedTurn } from "./agent-trim";
import type { Stats } from "./stats";
import { appendTicketNote } from "./tickets";

const scratch = mkdtempSync(join(tmpdir(), "taro-agent-trim-"));
const state = join(scratch, "state");
const projects = join(scratch, "projects");
const claudeConfig = join(scratch, "claude");

vi.mock("./data-dir", () => ({ statePath: (entry: string) => join(state, entry) }));
vi.mock("./projects", () => ({
  projectsDirectory: async () => projects,
  projectPaths: async (project: string) => ({ tracker: join(projects, project, "tracker") }),
}));
// NA-7's notes; any other ticket (a child) has none, so a record is found only where it is written.
let ticketNotes: string | null = null;
vi.mock("./tickets", () => ({
  appendTicketNote: vi.fn(async () => undefined),
  childRecords: vi.fn(async (_tracker: string, id: string) => ({ id, status: "In Progress", labels: [], notes: id === "NA-7" ? ticketNotes : null })),
}));

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.XDG_CONFIG_HOME = join(scratch, "xdg");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

function worktree(): string {
  const path = mkdtempSync(join(scratch, "notes-app-"));
  git(path, "init", "-q", "-b", "main");
  writeFileSync(join(path, "README.md"), "notes\n");
  git(path, "add", ".");
  git(path, "-c", "user.name=Alex", "-c", "user.email=alex@example.com", "commit", "-q", "-m", "init");
  return path;
}

const taroEnv = { TARO_PROJECT: "notes-app", TARO_TRACKER: "/home/user/tracker", TARO_SKILL: "/home/user/skill" };
const settingsOf = (cwd: string) => join(cwd, ".claude", "settings.local.json");

beforeEach(() => {
  vi.mocked(appendTicketNote).mockClear();
  ticketNotes = null;
});

describe("trimAgentLaunch", () => {
  it("trims a Taro owner's or subagent's launch, keeping its options, and turns the skills off in its worktree", async () => {
    const cwd = worktree();
    const request = { config: { provider: "claude", cwd, model: "claude-sonnet-5-5", modeId: "bypassPermissions", providerOptions: { disallowedTools: ["WebSearch"] } }, env: taroEnv };
    const trimmed = await trimAgentLaunch(request);
    expect(trimmed?.config).toMatchObject({ provider: "claude", cwd, model: "claude-sonnet-5-5", modeId: "bypassPermissions" });
    expect(trimmed?.env).toEqual(taroEnv);
    expect(trimmed?.config.providerOptions?.disallowedTools).toEqual(["WebSearch", ...TRIMMED_TOOLS]);
    const settings = JSON.parse(readFileSync(settingsOf(cwd), "utf8")) as { skillOverrides: Record<string, string> };
    expect(Object.keys(settings.skillOverrides)).toEqual([...HIDDEN_SKILLS]);
    expect(git(cwd, "status", "--porcelain")).toBe("");
  });

  it("leaves the manager, the user's own agents and Codex agents as they are, writing nothing", async () => {
    const managerHome = join(projects, "notes-app");
    mkdirSync(managerHome, { recursive: true });
    const cwd = worktree();
    expect(await trimAgentLaunch({ config: { provider: "claude", cwd: managerHome }, env: taroEnv })).toBeNull();
    expect(await trimAgentLaunch({ config: { provider: "claude", cwd } })).toBeNull();
    expect(await trimAgentLaunch({ config: { provider: "codex", cwd }, env: taroEnv })).toBeNull();
    expect(existsSync(settingsOf(managerHome))).toBe(false);
    expect(existsSync(settingsOf(cwd))).toBe(false);
  });

  it("still trims the tools when the repository tracks the settings file, and leaves that file alone", async () => {
    const cwd = worktree();
    mkdirSync(join(cwd, ".claude"));
    writeFileSync(settingsOf(cwd), "{}\n");
    git(cwd, "add", "-f", ".claude/settings.local.json");
    git(cwd, "-c", "user.name=Alex", "-c", "user.email=alex@example.com", "commit", "-q", "-m", "settings");
    const request: { config: { provider: string; cwd: string; providerOptions?: Record<string, unknown> }; env: Record<string, string> } = { config: { provider: "claude", cwd }, env: taroEnv };
    const trimmed = await trimAgentLaunch(request);
    expect(trimmed?.config.providerOptions?.disallowedTools).toEqual([...TRIMMED_TOOLS]);
    expect(readFileSync(settingsOf(cwd), "utf8")).toBe("{}\n");
  });
});

function fakeStats(recorded: boolean) {
  const taken: number[] = [];
  const stats = {
    hasStartingContext: vi.fn(async () => recorded),
    startingContext: vi.fn(async (_project: string, _ticket: string, _agentId: string, tokens: number) => {
      taken.push(tokens);
      return true;
    }),
  };
  return { stats: stats as unknown as Stats, taken, calls: stats };
}

function transcript(cwd: string, sessionId: string, firstTokens: number): void {
  const folder = join(claudeConfig, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(folder, { recursive: true });
  const lines = [
    { type: "user", message: { role: "user", content: "You are the Taro task owner for NA-7." } },
    { type: "assistant", message: { usage: { input_tokens: 2, cache_creation_input_tokens: firstTokens - 2, cache_read_input_tokens: 0 } } },
    { type: "assistant", message: { usage: { input_tokens: 2, cache_creation_input_tokens: 900, cache_read_input_tokens: firstTokens } } },
  ];
  writeFileSync(join(folder, `${sessionId}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

const owner = { project: "notes-app", role: "owner", ticket: "NA-7" };
const missTurn = [{ type: "tool_call", callId: "c1", name: "mcp__paseo__list_agents", status: "completed", error: null, detail: { type: "unknown", input: {}, output: null } }];

describe("watchTrimmedTurn", () => {
  it("notes a removed tool on the ticket, and records the starting context once with a CONTEXT note over the limit", async () => {
    const since = await trimmingStartedAt();
    const cwd = worktree();
    transcript(cwd, "session-big", 41_250);
    const { stats, taken } = fakeStats(false);
    const agent = { id: "agent-1", provider: "claude", cwd, createdAt: since, persistence: { sessionId: "session-big" } };
    await watchTrimmedTurn(stats, agent, owner, missTurn, claudeConfig);
    expect(taken).toEqual([41_250]);
    const records = vi.mocked(appendTicketNote).mock.calls.map(([tracker, ticket, record]) => [tracker, ticket, record.split(" ")[0]]);
    expect(records).toEqual([
      [join(projects, "notes-app", "tracker"), "NA-7", "TOOL-MISS"],
      [join(projects, "notes-app", "tracker"), "NA-7", "CONTEXT"],
    ]);
    expect(vi.mocked(appendTicketNote).mock.calls[0]?.[2]).toContain("`mcp__paseo__list_agents` (a removed tool)");
  });

  it("records a start under the limit without a note, and reads the transcript no more once recorded", async () => {
    const since = await trimmingStartedAt();
    const cwd = worktree();
    transcript(cwd, "session-small", 18_400);
    const fresh = fakeStats(false);
    await watchTrimmedTurn(fresh.stats, { id: "agent-2", provider: "claude", cwd, createdAt: since, persistence: { sessionId: "session-small" } }, owner, [], claudeConfig);
    expect(fresh.taken).toEqual([18_400]);
    const recorded = fakeStats(true);
    await watchTrimmedTurn(recorded.stats, { id: "agent-2", provider: "claude", cwd, createdAt: since, persistence: { sessionId: "session-small" } }, owner, [], claudeConfig);
    expect(recorded.calls.startingContext).not.toHaveBeenCalled();
    expect(appendTicketNote).not.toHaveBeenCalled();
  });

  it("leaves alone agents created before trimming began, the manager, Codex agents and agents without a ticket", async () => {
    const since = await trimmingStartedAt();
    const cwd = worktree();
    transcript(cwd, "session-old", 53_269);
    const { stats, calls } = fakeStats(false);
    const base = { id: "agent-3", provider: "claude", cwd, createdAt: since, persistence: { sessionId: "session-old" } };
    await watchTrimmedTurn(stats, { ...base, createdAt: "2026-01-01T00:00:00.000Z" }, owner, missTurn, claudeConfig);
    await watchTrimmedTurn(stats, base, { ...owner, role: "manager", ticket: null }, missTurn, claudeConfig);
    await watchTrimmedTurn(stats, base, { ...owner, role: "manager" }, missTurn, claudeConfig);
    await watchTrimmedTurn(stats, { ...base, provider: "codex" }, owner, missTurn, claudeConfig);
    await watchTrimmedTurn(stats, base, { ...owner, ticket: null }, missTurn, claudeConfig);
    expect(appendTicketNote).not.toHaveBeenCalled();
    expect(calls.startingContext).not.toHaveBeenCalled();
  });

  it("watches every subagent role", async () => {
    const since = await trimmingStartedAt();
    const cwd = worktree();
    for (const role of ["implementer", "reviewer", "researcher"]) {
      await watchTrimmedTurn(fakeStats(true).stats, { id: `agent-${role}`, provider: "claude", cwd, createdAt: since, persistence: null }, { ...owner, role }, missTurn, claudeConfig);
    }
    expect(vi.mocked(appendTicketNote).mock.calls.map(([, , record]) => record.split(" ")[0])).toEqual(["TOOL-MISS", "TOOL-MISS", "TOOL-MISS"]);
  });

  it("keeps the moment trimming began across calls", async () => {
    const first = await trimmingStartedAt();
    expect(await trimmingStartedAt()).toBe(first);
    expect(JSON.parse(readFileSync(join(state, "context-trim.json"), "utf8"))).toEqual({ since: first });
  });
});

function overEstimateStats() {
  const noted = new Set<string>();
  const stats = {
    hasStartingContext: vi.fn(async () => true),
    hasOverEstimateNote: vi.fn(async () => false),
    startingContext: vi.fn(async () => false),
    noteOverEstimate: vi.fn(async (_project: string, ticket: string, agentId: string) => {
      const key = `${ticket}:${agentId}`;
      if (noted.has(key)) return false;
      noted.add(key);
      return true;
    }),
  };
  return stats as unknown as Stats;
}

/** Requests of 31k, 90k and 142k, and a built-in subagent's 300k that is not the agent's own. */
function peakTranscript(cwd: string, sessionId: string): void {
  const folder = join(claudeConfig, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(folder, { recursive: true });
  const request = (tokens: number, extra: Record<string, unknown> = {}) => ({ type: "assistant", message: { usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens - 2 } }, ...extra });
  const lines = [request(31_000), request(90_000), request(300_000, { isSidechain: true }), request(142_000), { type: "user", message: { role: "user", content: "next" } }];
  writeFileSync(join(folder, `${sessionId}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

const estimateOf = (estimate: string) => `EXECUTION 2026-10-20T10:00Z — subagent sub-1, implementer, NA-7.01, claude/claude-sonnet-5-5, workspace w1, estimate: ${estimate}`;

describe("the over-estimate note", () => {
  const subagent = { project: "notes-app", role: "implementer", ticket: "NA-7" };
  const notes = () => vi.mocked(appendTicketNote).mock.calls.map(([, , record]) => record).filter((record) => record.startsWith("CONTEXT"));

  async function turn(stats: Stats, identity = subagent, session = "session-peak") {
    const since = await trimmingStartedAt();
    // No git here: the transcript is found by the directory's name alone.
    const cwd = mkdtempSync(join(scratch, "peak-"));
    peakTranscript(cwd, session);
    await watchTrimmedTurn(stats, { id: "sub-1", provider: "claude", cwd, createdAt: since, persistence: { sessionId: session } }, identity, [], claudeConfig);
    return { cwd, since };
  }

  it("notes a peak over the estimate once", async () => {
    ticketNotes = estimateOf("60k");
    const stats = overEstimateStats();
    const { cwd, since } = await turn(stats);
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toMatch(/^CONTEXT \S+ — peaked at 142k against an estimate of 60k: implementer sub-1\. Split the task/);
    await watchTrimmedTurn(stats, { id: "sub-1", provider: "claude", cwd, createdAt: since, persistence: { sessionId: "session-peak" } }, subagent, [], claudeConfig);
    expect(notes()).toHaveLength(1);
  });

  it("reads a child subagent's estimate from its parent, where the owner records it", async () => {
    ticketNotes = estimateOf("60k");
    await turn(overEstimateStats(), { ...subagent, ticket: "NA-7.01" });
    expect(notes()).toHaveLength(1);
  });

  it("no note without an estimate", async () => {
    ticketNotes = "EXECUTION 2026-10-20T10:00Z — subagent sub-1, implementer, NA-7.01";
    await turn(overEstimateStats());
    expect(notes()).toEqual([]);
  });

  it("no note at 1.2× the estimate", async () => {
    ticketNotes = estimateOf("118k");
    await turn(overEstimateStats());
    expect(notes()).toEqual([]);
  });

  it("an owner gets no over-estimate note", async () => {
    ticketNotes = estimateOf("60k");
    await turn(overEstimateStats(), { ...subagent, role: "owner" });
    expect(notes()).toEqual([]);
  });

  it("sidechain requests are not the peak", async () => {
    // 142k is the largest of the agent's own requests: an estimate of 115k (bar 143.75k) is not exceeded, though the sidechain's 300k would be.
    ticketNotes = estimateOf("115k");
    await turn(overEstimateStats());
    expect(notes()).toEqual([]);
  });
});
