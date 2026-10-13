import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Headroom } from "../shared/recovery";
import type { AgentState } from "../shared/state";
import { fetchLiveAgent } from "./agents";
import { runPaseoJson } from "./cli";
import { readHeadroom } from "./headroom";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { restartManager } from "./manager";
import { Recovery } from "./recovery";
import { sendFromPlugin } from "./send";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { identityFromLabels } from "./supervision";
import { appendTicketNote } from "./tickets";

vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn(), isMidTurn: (agent: { status: string }) => agent.status === "running", listTaroAgents: vi.fn(async () => []) }));
vi.mock("./cli", () => ({ runPaseoJson: vi.fn(async () => null) }));
vi.mock("./headroom", () => ({ readHeadroom: vi.fn(async () => null) }));
vi.mock("./manager", () => ({ restartManager: vi.fn(async () => ({ agentId: "manager-2", workspaceId: "w" })) }));
vi.mock("./send", () => ({ sendFromPlugin: vi.fn(async () => undefined), sendCommand: vi.fn(), isPluginMessageId: () => false }));
vi.mock("./tickets", () => ({ appendTicketNote: vi.fn(async () => undefined) }));
vi.mock("./projects", () => ({
  projectPaths: async () => ({ tracker: "/tracker" }),
  requireProjectConfig: async () => ({ managerAgentId: "manager-1" }),
  readProjectConfig: async () => null,
}));
vi.mock("./package-files", () => ({
  TEMPLATES: { crashRecovery: "crash", helperCrashed: "helper-crashed", headroomRecovered: "recovered" },
  skillDirectory: async () => "/skill",
  message: async (path: string, values: Record<string, string> = {}) => `${path}:${JSON.stringify(values)}`,
}));

const crash = "Claude stopped unexpectedly (signal SIGABRT).";
const paseo = {} as PaseoApi;

function agent(id: string, role: string, ticket: string | null, status = "error"): PaseoAgent {
  return {
    id,
    title: `${ticket ?? "manager"} agent`,
    status,
    updatedAt: new Date().toISOString(),
    lastError: crash,
    labels: { "taro.project": "taro", "taro.role": role, ...(ticket === null ? {} : { "taro.ticket": ticket }) },
  } as unknown as PaseoAgent;
}

function setUp(): { recovery: Recovery; agents: Record<string, AgentState>; counted: string[] } {
  const agents: Record<string, AgentState> = {};
  const state = {
    agent: async (agentId: string) => agents[agentId] ?? null,
    updateAgent: async <T>(agentId: string, initial: () => AgentState, change: (record: AgentState) => T) => {
      const record = agents[agentId] ?? initial();
      agents[agentId] = record;
      return change(record);
    },
  } as unknown as PluginState;
  const counted: string[] = [];
  const stats = { count: async (_project: string, ticket: string, field: string) => void counted.push(`${ticket}:${field}`) } as unknown as Stats;
  return { recovery: new Recovery(state, stats), agents, counted };
}

async function crashed(recovery: Recovery, target: PaseoAgent): Promise<void> {
  const identity = identityFromLabels(target.labels, target.title ?? null);
  if (identity === null) throw new Error("not a Taro agent");
  await recovery.onCrash(paseo, target, identity, crash);
}

const reloads = () => vi.mocked(runPaseoJson).mock.calls.filter(([args]) => args[0] === "agent" && args[1] === "reload").map(([args]) => args[2]);
const sentTo = (prefix: string) => vi.mocked(sendFromPlugin).mock.calls.filter(([, , text]) => text.startsWith(prefix)).map(([, id]) => id);
const high: Headroom = { current: 1900, max: 2048, high: true, highSince: "2026-10-13T11:56:00Z" };

describe("Recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(readHeadroom).mockResolvedValue(null);
    vi.mocked(runPaseoJson).mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reloads a crashed owner in place, sends one message, notes the ticket and counts it", async () => {
    const owner = agent("owner-1", "owner", "TR-5");
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner);
    const { recovery, agents, counted } = setUp();
    await crashed(recovery, owner);
    expect(reloads()).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reloads()).toEqual(["owner-1"]);
    expect(sentTo("crash:")).toEqual(["owner-1"]);
    expect(agents["owner-1"]?.recoveries).toHaveLength(1);
    expect(counted).toEqual(["TR-5:recoveries"]);
    expect(vi.mocked(appendTicketNote).mock.calls[0]?.[2]).toMatch(/^RECOVERY .* owner owner-1 crashed .*reloaded owner-1 in place.*recovery 1 of 2/);
  });

  it("waits while threads are short, then recovers several agents one tick apart", async () => {
    const targets = [agent("manager-1", "manager", null), agent("owner-1", "owner", "TR-5"), agent("helper-1", "helper", "TR-5")];
    vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => targets.find((target) => target.id === id) ?? null);
    vi.mocked(readHeadroom).mockResolvedValue(high);
    const { recovery } = setUp();
    for (const target of targets) await crashed(recovery, target);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reloads()).toEqual([]);

    vi.mocked(readHeadroom).mockResolvedValue({ current: 1200, max: 2048, high: false, highSince: null });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(reloads()).toEqual(["manager-1"]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(reloads()).toEqual(["manager-1", "owner-1"]);
    // Usage climbs again between two recoveries: the rest waits.
    vi.mocked(readHeadroom).mockResolvedValue(high);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(reloads()).toEqual(["manager-1", "owner-1"]);
    vi.mocked(readHeadroom).mockResolvedValue(null);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(reloads()).toEqual(["manager-1", "owner-1", "helper-1"]);
  });

  it("queues an agent once however often its crash is reported", async () => {
    const owner = agent("owner-1", "owner", "TR-5");
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner);
    const { recovery } = setUp();
    await crashed(recovery, owner);
    await crashed(recovery, owner);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reloads()).toEqual(["owner-1"]);
  });

  it("skips an agent that is archived or already running again", async () => {
    const owner = agent("owner-1", "owner", "TR-5");
    vi.mocked(fetchLiveAgent).mockResolvedValue({ ...owner, status: "running" } as PaseoAgent);
    const { recovery } = setUp();
    await crashed(recovery, owner);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reloads()).toEqual([]);
  });

  it("allows two recoveries an hour, then leaves the agent stalled with the reason", async () => {
    const owner = agent("owner-1", "owner", "TR-5");
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner);
    const { recovery, agents } = setUp();
    await crashed(recovery, owner);
    await vi.advanceTimersByTimeAsync(20_000);
    await crashed(recovery, owner);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reloads()).toEqual(["owner-1", "owner-1"]);

    await crashed(recovery, owner);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reloads()).toEqual(["owner-1", "owner-1"]);
    expect(agents["owner-1"]?.stalled).toBe(true);
    expect(agents["owner-1"]?.stalledReason).toMatch(/^Crashed: crashed 3 times within an hour/);
    expect(vi.mocked(appendTicketNote).mock.calls.at(-1)?.[2]).toMatch(/left stalled for the user/);

    // An hour after the first recovery, a crash is recovered again.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await crashed(recovery, owner);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reloads()).toHaveLength(3);
  });

  it("relaunches an owner whose reload failed", async () => {
    const owner = agent("owner-1", "owner", "TR-5");
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner);
    vi.mocked(runPaseoJson).mockRejectedValue(new Error("paseo agent failed: no such agent"));
    const { recovery } = setUp();
    const relaunch = vi.fn(async () => "owner-2");
    recovery.setRelaunchOwner(relaunch);
    await crashed(recovery, owner);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(relaunch).toHaveBeenCalledWith(paseo, "taro", "TR-5");
    expect(sentTo("crash:")).toEqual([]);
    expect(vi.mocked(appendTicketNote).mock.calls[0]?.[2]).toMatch(/reload failed .*relaunched a fresh owner owner-2/);
  });

  it("restarts the manager whose reload failed", async () => {
    const manager = agent("manager-1", "manager", null);
    vi.mocked(fetchLiveAgent).mockResolvedValue(manager);
    vi.mocked(runPaseoJson).mockRejectedValue(new Error("boom"));
    const { recovery } = setUp();
    await crashed(recovery, manager);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restartManager).toHaveBeenCalledWith(paseo, "taro");
    // The manager has no ticket to note.
    expect(appendTicketNote).not.toHaveBeenCalled();
  });

  it("tells a helper's owner when the helper cannot be reloaded", async () => {
    const helper = agent("helper-1", "helper", "TR-5");
    const owner = agent("owner-1", "owner", "TR-5", "idle");
    vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (id === "helper-1" ? helper : null));
    const { listTaroAgents } = await import("./agents");
    vi.mocked(listTaroAgents).mockResolvedValue([owner]);
    vi.mocked(runPaseoJson).mockRejectedValue(new Error("boom"));
    const { recovery, agents } = setUp();
    await crashed(recovery, helper);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentTo("helper-crashed:")).toEqual(["owner-1"]);
    expect(agents["helper-1"]?.stalled).toBe(true);
  });

  it("holds the manager's slot-free wake-up while threads are short and sends it after", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(agent("manager-1", "manager", null, "idle"));
    vi.mocked(readHeadroom).mockResolvedValue(high);
    const { recovery } = setUp();
    await recovery.tellManagerWhenHeadroom(paseo, "taro", "manager-1", "TR-5 is Done");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendFromPlugin).not.toHaveBeenCalled();
    vi.mocked(readHeadroom).mockResolvedValue({ current: 900, max: 2048, high: false, highSince: null });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(vi.mocked(sendFromPlugin).mock.calls.map(([, id, text]) => [id, text.startsWith("recovered:") && text.includes("TR-5 is Done")])).toEqual([["manager-1", true]]);
  });

  it("sends the wake-up at once when there is headroom", async () => {
    const { recovery } = setUp();
    await recovery.tellManagerWhenHeadroom(paseo, "taro", "manager-1", "TR-5 is Done");
    expect(vi.mocked(sendFromPlugin).mock.calls.map(([, id, text]) => [id, text])).toEqual([["manager-1", "TR-5 is Done"]]);
  });

  it("after a start, queues only recent crashes left in error", async () => {
    const old = { ...agent("owner-old", "owner", "TR-1"), updatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() } as PaseoAgent;
    const apiError = { ...agent("owner-api", "owner", "TR-2"), lastError: "API Error: 529" } as PaseoAgent;
    const idle = agent("owner-idle", "owner", "TR-3", "idle");
    const recent = agent("owner-new", "owner", "TR-4");
    vi.mocked(fetchLiveAgent).mockResolvedValue(recent);
    const { recovery } = setUp();
    expect(await recovery.recoverLeftovers(paseo, [old, apiError, idle, recent])).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reloads()).toEqual(["owner-new"]);
  });
});
