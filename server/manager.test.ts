import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentStateSchema, type AgentState } from "../shared/state";
import { fetchLiveAgent } from "./agents";
import { runPaseoJson } from "./cli";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { compactManager, restartManager, resumeManager } from "./manager";
import { updateProjectConfig } from "./projects";
import { sendCommand, sendFromPlugin } from "./send";
import type { PluginState } from "./state";

vi.mock("node:fs/promises", () => ({ writeFile: vi.fn(async () => undefined) }));
vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn(), isMidTurn: (agent: { status: string }) => agent.status === "running" }));
vi.mock("./cli", () => ({ runPaseoJson: vi.fn(async () => null) }));
vi.mock("./send", () => ({ sendFromPlugin: vi.fn(async () => undefined), sendCommand: vi.fn() }));
vi.mock("./models", () => ({ bypassModeId: async () => null, knownBypassMode: () => "" }));
vi.mock("./environment", () => ({ taroEnvironment: async () => ({}) }));
vi.mock("./taro-project", () => ({ ensureTaroProject: async () => ({ projectId: "taro-project" }) }));
vi.mock("./projects", () => ({
  projectPaths: async () => ({ home: "/home/notes", tracker: "/tracker", agents: "/home/notes/AGENTS.md", standingOrders: "/orders", suggestions: "/suggestions" }),
  requireProjectConfig: async () => ({
    project: "notes-app",
    repoPath: "/home/user/notes-app",
    baseBranch: "main",
    ticketPrefix: "NA",
    paseoProjectId: "p",
    managerAgentId: "manager-1",
    managerWorkspaceId: "ws-manager",
    manager: { model: "claude/claude-sonnet-5-5", thinking: "" },
    owner: { model: "claude/claude-sonnet-5-5", thinking: "" },
    subagentModels: [],
    delivery: "local-only",
    acceptAlsoMerges: false,
    maxParallelOwners: 2,
  }),
  updateProjectConfig: vi.fn(async () => ({})),
}));
vi.mock("./package-files", () => ({
  TEMPLATES: { managerOpening: "opening", managerRestart: "restart", managerResumed: "resumed", managerAgents: "agents" },
  skillDirectory: async () => "/skill",
  readTemplate: async () => "",
  fill: () => "",
  message: async (path: string, values: Record<string, string> = {}) => `${path}:${JSON.stringify(values)}`,
}));

const crash = "Claude stopped unexpectedly (signal SIGABRT).";

function manager(status: string): PaseoAgent {
  return { id: "manager-1", title: "notes-app · Manager", status, lastError: status === "error" ? crash : null, labels: {} } as unknown as PaseoAgent;
}

function fakePaseo(): { paseo: PaseoApi; archived: string[]; created: Array<{ prompt: string }> } {
  const archived: string[] = [];
  const created: Array<{ prompt: string }> = [];
  const paseo = {
    agents: { ref: (id: string) => ({ archive: async () => void archived.push(id) }) },
    workspaces: {
      ref: () => ({
        refresh: async () => ({ id: "ws-manager" }),
        agents: {
          create: async (input: { prompt: string }) => {
            created.push(input);
            return { id: "manager-2" };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  return { paseo, archived, created };
}

function fakeState(records: Record<string, AgentState>): Pick<PluginState, "agent" | "updateAgent"> {
  return {
    agent: async (agentId) => records[agentId] ?? null,
    updateAgent: async (agentId, initial, change) => {
      const record = records[agentId] ?? initial();
      records[agentId] = record;
      return change(record);
    },
  };
}

function stalledRecord(): AgentState {
  return AgentStateSchema.parse({ role: "manager", project: "notes-app", stalled: true, stalledReason: `Crashed: crashed 3 times within an hour, so it was not restarted again (last: ${crash}).` });
}

const reloads = () => vi.mocked(runPaseoJson).mock.calls.filter(([args]) => args[0] === "agent" && args[1] === "reload").map(([args]) => args[2]);
const sent = () => vi.mocked(sendFromPlugin).mock.calls.map(([, id, text]) => ({ id, text }));

describe("resumeManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runPaseoJson).mockResolvedValue(null);
  });

  it("reloads the same crashed manager, clears the stall and tells it why", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(manager("error"));
    const records = { "manager-1": stalledRecord() };
    const { paseo, archived, created } = fakePaseo();

    await expect(resumeManager(paseo, "notes-app", fakeState(records))).resolves.toEqual({ agentId: "manager-1", workspaceId: "ws-manager" });

    expect(reloads()).toEqual(["manager-1"]);
    expect(records["manager-1"]).toMatchObject({ stalled: false, stalledReason: null });
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.id).toBe("manager-1");
    expect(sent()[0]!.text).toMatch(/^resumed:/);
    expect(JSON.parse(sent()[0]!.text.slice("resumed:".length)).why).toBe(
      `after the plugin stopped recovering you (crashed 3 times within an hour, so it was not restarted again (last: ${crash}))`,
    );
    // Same agent: nothing archived, nothing new.
    expect(archived).toEqual([]);
    expect(created).toEqual([]);
  });

  it("names the error of a manager that stopped without the plugin giving up on it", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(manager("error"));
    const { paseo } = fakePaseo();
    await resumeManager(paseo, "notes-app", fakeState({}));
    expect(JSON.parse(sent()[0]!.text.slice("resumed:".length)).why).toBe(`after you stopped with an error (${crash})`);
  });

  it("says the user asked when the manager was idle and healthy", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(manager("idle"));
    const { paseo } = fakePaseo();
    await resumeManager(paseo, "notes-app", fakeState({}));
    expect(reloads()).toEqual(["manager-1"]);
    expect(JSON.parse(sent()[0]!.text.slice("resumed:".length)).why).toBe("at their request");
  });

  it("refuses a manager in the middle of a turn, reloading nothing", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(manager("running"));
    const { paseo } = fakePaseo();
    await expect(resumeManager(paseo, "notes-app", fakeState({}))).rejects.toThrow(/middle of a turn/);
    expect(reloads()).toEqual([]);
    expect(sent()).toEqual([]);
  });

  it("refuses when there is no manager, pointing to a fresh one", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(null);
    const { paseo } = fakePaseo();
    await expect(resumeManager(paseo, "notes-app", fakeState({}))).rejects.toThrow(/no manager to resume\. Start a fresh manager instead/);
    expect(reloads()).toEqual([]);
  });

  it("a failed reload says so and offers the fresh start, but starts nothing and keeps the stall", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(manager("error"));
    vi.mocked(runPaseoJson).mockRejectedValueOnce(new Error("agent not found"));
    const records = { "manager-1": stalledRecord() };
    const { paseo, archived, created } = fakePaseo();

    await expect(resumeManager(paseo, "notes-app", fakeState(records))).rejects.toThrow(
      "The notes-app manager could not be resumed: agent not found. Use Start a fresh manager instead; the old conversation is archived, not deleted.",
    );
    expect(archived).toEqual([]);
    expect(created).toEqual([]);
    expect(sent()).toEqual([]);
    expect(updateProjectConfig).not.toHaveBeenCalled();
    expect(records["manager-1"]).toMatchObject({ stalled: true });
  });
});

describe("restartManager (Start a fresh manager)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("archives the old manager and starts a new agent with a new conversation", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(manager("error"));
    const { paseo, archived, created } = fakePaseo();

    await expect(restartManager(paseo, "notes-app")).resolves.toEqual({ agentId: "manager-2", workspaceId: "ws-manager" });

    expect(archived).toEqual(["manager-1"]);
    expect(created).toHaveLength(1);
    expect(created[0]!.prompt).toContain("restart:");
    expect(reloads()).toEqual([]);
    expect(updateProjectConfig).toHaveBeenCalledWith("notes-app", { managerAgentId: "manager-2" });
  });
});

describe("compactManager (the Compact button)", () => {
  it("starts the handoff → /compact → reload pipeline as the manager, never a bare /compact", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue({ ...manager("idle"), lastUsage: { contextWindowUsedTokens: 180_000 } } as unknown as PaseoAgent);
    const startCompaction = vi.fn(async () => undefined);
    expect(await compactManager({} as PaseoApi, "notes-app", { startCompaction })).toBe("manager-1");
    expect(startCompaction).toHaveBeenCalledWith({}, "manager-1", { project: "notes-app", role: "manager", ticket: null, title: "notes-app · Manager" }, 180_000, "button");
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("refuses a manager in the middle of a turn, starting nothing", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(manager("running"));
    const startCompaction = vi.fn(async () => undefined);
    await expect(compactManager({} as PaseoApi, "notes-app", { startCompaction })).rejects.toThrow(/middle of a turn/);
    expect(startCompaction).not.toHaveBeenCalled();
  });
});
