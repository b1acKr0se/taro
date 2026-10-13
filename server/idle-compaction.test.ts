import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentState } from "../shared/state";
import { fetchLiveAgent, listTaroAgents } from "./agents";
import type { HookAgent, PaseoAgent, PaseoApi, TimelineItem, TurnOutcome } from "./host-types";
import type { Recovery } from "./recovery";
import { sendCommand, sendFromPlugin } from "./send";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { Supervisor } from "./supervision";

vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn(), isMidTurn: () => false, listTaroAgents: vi.fn(async () => []) }));
vi.mock("./send", async (original) => ({ ...(await original<typeof import("./send")>()), sendFromPlugin: vi.fn(async () => undefined), sendCommand: vi.fn(async () => undefined) }));
vi.mock("./package-files", () => ({
  TEMPLATES: {
    reload: "reload",
    nudge: "nudge",
    handoffRequest: "handoff",
    compactInstructions: "keep",
    managerHandoffRequest: "manager-handoff",
    managerReload: "manager-reload",
  },
  skillDirectory: async () => "/skill",
  message: async (path: string, values: Record<string, string> = {}) => `${path}:${values.ticket ?? values.handoff ?? ""}:${values.usedTokens ?? ""}`,
}));
vi.mock("./projects", () => ({
  readProjectConfig: async () => ({ project: "taro", compactThresholdTokens: 250_000, idleCompactThresholdTokens: 200_000 }),
  projectPaths: async () => ({ home: "/taro/projects/taro" }),
}));

const endedAt = "2026-10-13T12:00:00.000Z";
const at = (minutes: number) => Date.parse(endedAt) + minutes * 60_000;
const recovery = { onCrash: vi.fn(async () => undefined), recoverLeftovers: async () => 0 } as unknown as Recovery;
const completed = { kind: "completed" } as unknown as TurnOutcome;
const turn = [
  { type: "user_message", text: "carry on", messageId: "taro-1" },
  { type: "assistant_message", text: "ok\n\nwaiting: compaction" },
] as unknown as TimelineItem[];

function agent(id: string, role: string, ticket: string | null, usedTokens: number): PaseoAgent {
  const labels: Record<string, string> = { "taro.project": "taro", "taro.role": role };
  if (ticket !== null) labels["taro.ticket"] = ticket;
  return { id, provider: "claude", model: "sonnet", title: id, status: "idle", pendingPermissions: [], labels, updatedAt: endedAt, lastUsage: { contextWindowUsedTokens: usedTokens } } as unknown as PaseoAgent;
}

function setup() {
  const agents: Record<string, AgentState> = {};
  const state = {
    allDecisions: async () => [],
    updateDecisions: async <T>(change: (decisions: never[]) => T) => change([]),
    agent: async (agentId: string) => agents[agentId] ?? null,
    updateAgent: async <T>(agentId: string, initial: () => AgentState, change: (record: AgentState) => T) => {
      const record = agents[agentId] ?? initial();
      agents[agentId] = record;
      return change(record);
    },
  } as unknown as PluginState;
  const stats = { turnEnded: vi.fn(async () => undefined), count: vi.fn(async () => undefined), countProject: vi.fn(async () => undefined) };
  const taro = new Supervisor(state, stats as unknown as Stats, recovery);
  return { taro, agents, stats };
}

/** The plugin saw `id`'s last turn end at `endedAt`. */
async function seenIdle(taro: Supervisor, live: PaseoAgent): Promise<void> {
  vi.mocked(fetchLiveAgent).mockResolvedValue(live);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(endedAt));
  await taro.onTurnEnded({} as PaseoApi, { id: live.id, parentAgentId: null } as unknown as HookAgent, completed, turn, null, undefined);
  vi.useRealTimers();
}

async function endTurn(taro: Supervisor, live: PaseoAgent): Promise<void> {
  vi.mocked(fetchLiveAgent).mockResolvedValue(live);
  await taro.onTurnEnded({} as PaseoApi, { id: live.id, parentAgentId: null } as unknown as HookAgent, completed, turn, null, undefined);
}

const sent = () => vi.mocked(sendFromPlugin).mock.calls.map(([, id, text]) => `${id} ${text}`);

beforeEach(() => {
  vi.mocked(sendFromPlugin).mockClear();
  vi.mocked(sendCommand).mockClear();
});

describe("Supervisor.compactIdleAgents", () => {
  it("asks an idle owner and the manager for a handoff and counts each, never a subagent", async () => {
    const { taro, agents, stats } = setup();
    const all = [agent("owner-1", "owner", "TR-5", 250_000), agent("manager-1", "manager", null, 250_000), agent("implementer-1", "implementer", "TR-5", 250_000), agent("reviewer-1", "reviewer", "TR-5", 250_000)];
    for (const live of all) await seenIdle(taro, live);
    vi.mocked(sendFromPlugin).mockClear();
    vi.mocked(listTaroAgents).mockResolvedValue(all);

    expect(await taro.compactIdleAgents({} as PaseoApi, ["taro"], at(56), 55 * 60_000)).toBe(2);
    expect(sent()).toEqual(["owner-1 handoff:TR-5:250k", "manager-1 manager-handoff:/taro/projects/taro/manager-handoff.md:250k"]);
    expect([agents["owner-1"]?.compaction, agents["owner-1"]?.idleCompaction]).toEqual(["handoff", "running"]);
    expect([agents["manager-1"]?.compaction, agents["manager-1"]?.idleCompaction]).toEqual(["handoff", "running"]);
    expect(agents["implementer-1"]?.compaction).toBe("none");
    expect(stats.count).toHaveBeenCalledWith("taro", "TR-5", "idleCompactions");
    expect(stats.countProject).toHaveBeenCalledWith("taro", "idleCompactions");
    expect(stats.countProject).toHaveBeenCalledTimes(1);
  });

  it("leaves agents under the idle threshold, too early or too late", async () => {
    const { taro } = setup();
    const small = agent("owner-1", "owner", "TR-5", 200_000);
    const large = agent("owner-2", "owner", "TR-6", 250_000);
    await seenIdle(taro, small);
    await seenIdle(taro, large);
    vi.mocked(sendFromPlugin).mockClear();
    vi.mocked(listTaroAgents).mockResolvedValue([small, large]);
    expect(await taro.compactIdleAgents({} as PaseoApi, ["taro"], at(54), 55 * 60_000)).toBe(0);
    expect(await taro.compactIdleAgents({} as PaseoApi, ["taro"], at(61), 55 * 60_000)).toBe(0);
    expect(await taro.compactIdleAgents({} as PaseoApi, ["taro"], at(57), 55 * 60_000)).toBe(1);
    expect(sent()).toEqual(["owner-2 handoff:TR-6:250k"]);
  });

  it("runs the manager through handoff → /compact → reload, then not again until a turn of its own", async () => {
    const { taro, agents } = setup();
    const manager = agent("manager-1", "manager", null, 250_000);
    await seenIdle(taro, manager);
    vi.mocked(listTaroAgents).mockResolvedValue([manager]);
    await taro.compactIdleAgents({} as PaseoApi, ["taro"], at(56), 55 * 60_000);

    await endTurn(taro, manager); // the handoff turn
    expect(vi.mocked(sendCommand).mock.calls.map(([, id, text]) => `${id} ${text}`)).toEqual(["manager-1 /compact keep::"]);
    expect(agents["manager-1"]?.compaction).toBe("compacting");

    vi.mocked(sendFromPlugin).mockClear();
    await endTurn(taro, manager); // the /compact turn
    expect(sent()).toEqual(["manager-1 manager-reload:/taro/projects/taro/manager-handoff.md:"]);
    expect(agents["manager-1"]?.compaction).toBe("none");

    await endTurn(taro, manager); // the reload's turn
    expect(agents["manager-1"]?.idleCompaction).toBe("done");
    // Still above the threshold an hour after the reload: not compacted again.
    const reloadEndedAt = Date.parse(agents["manager-1"]?.lastTurnEndedAt ?? "");
    vi.mocked(sendFromPlugin).mockClear();
    expect(await taro.compactIdleAgents({} as PaseoApi, ["taro"], reloadEndedAt + 56 * 60_000, 55 * 60_000)).toBe(0);

    await endTurn(taro, manager); // the user came back
    expect(agents["manager-1"]?.idleCompaction).toBe("none");
    const userEndedAt = Date.parse(agents["manager-1"]?.lastTurnEndedAt ?? "");
    expect(await taro.compactIdleAgents({} as PaseoApi, ["taro"], userEndedAt + 56 * 60_000, 55 * 60_000)).toBe(1);
  });

  it("reloads an owner with its ticket after an idle compaction, as after the Compact button", async () => {
    const { taro, agents } = setup();
    const owner = agent("owner-1", "owner", "TR-5", 250_000);
    await seenIdle(taro, owner);
    vi.mocked(listTaroAgents).mockResolvedValue([owner]);
    await taro.compactIdleAgents({} as PaseoApi, ["taro"], at(56), 55 * 60_000);
    await endTurn(taro, owner);
    vi.mocked(sendFromPlugin).mockClear();
    await endTurn(taro, owner);
    expect(sent()).toEqual(["owner-1 reload:TR-5:"]);
    await endTurn(taro, owner);
    expect(agents["owner-1"]?.idleCompaction).toBe("done");
  });
});
