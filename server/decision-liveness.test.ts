// TR-009: a decision from an archived (or vanished) agent is never shown, and answering one messages no one.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredDecision } from "../shared/state";
import { Actions } from "./actions";
import { fetchLiveAgent, listTaroAgents, projectAgents } from "./agents";
import { liveOpenDecisions } from "./board";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { sendFromPlugin } from "./send";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { Supervisor } from "./supervision";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn(), projectAgents: vi.fn(), listTaroAgents: vi.fn(async () => []), isMidTurn: () => false }));
vi.mock("./send", () => ({ sendFromPlugin: vi.fn(async () => undefined), sendWithoutInterrupting: vi.fn(async () => undefined), sendCommand: vi.fn() }));
vi.mock("./package-files", () => ({ TEMPLATES: { answer: "answer" }, skillDirectory: async () => "/skill", message: async (path: string) => path }));
vi.mock("./projects", () => ({
  projectPaths: async () => ({ tracker: "/tracker" }),
  readProjectConfig: async () => null,
  requireProjectConfig: async () => ({ owner: { model: "claude/sonnet", thinking: "" } }),
}));
vi.mock("./tickets", () => ({ appendTicketNote: vi.fn(async () => undefined), viewTicket: async () => ({ title: "x", implementationNotes: "" }) }));
vi.mock("./models", () => ({ bypassModeId: async () => null }));
vi.mock("./environment", () => ({ taroEnvironment: async () => ({}) }));

function stored(agentId: string, project = "taro", status: StoredDecision["status"] = "open"): StoredDecision {
  return {
    key: `${agentId}:scope-approval`,
    id: "scope-approval",
    question: "Approve?",
    options: [{ label: "Approve", prompt: "Approve", consequence: "" }],
    agentId,
    project,
    ticket: "TR-5",
    status,
    answer: null,
  } as unknown as StoredDecision;
}

function stateOver(decisions: StoredDecision[]): PluginState {
  return {
    allDecisions: async () => [...decisions],
    decision: async (key: string) => decisions.find((decision) => decision.key === key) ?? null,
    updateDecisions: async <T>(change: (stored: StoredDecision[]) => T) => change(decisions),
  } as unknown as PluginState;
}

const agent = (id: string) => ({ id }) as unknown as PaseoAgent;

beforeEach(() => {
  vi.mocked(sendFromPlugin).mockClear();
});

describe("liveOpenDecisions", () => {
  it("lists only open decisions of agents Paseo still has unarchived, per project", async () => {
    vi.mocked(projectAgents).mockImplementation(async (_paseo, project) => (project === "taro" ? [agent("new-owner")] : [agent("other-owner")]));
    const decisions = [stored("old-owner"), stored("new-owner"), stored("new-owner", "taro", "answered"), stored("other-owner", "other")];
    const state = stateOver(decisions);
    expect((await liveOpenDecisions({} as PaseoApi, state, "taro")).map((decision) => decision.key)).toEqual(["new-owner:scope-approval"]);
    expect((await liveOpenDecisions({} as PaseoApi, state, null)).map((decision) => decision.agentId)).toEqual(["new-owner", "other-owner"]);
  });

  it("is empty when nothing is open", async () => {
    vi.mocked(projectAgents).mockClear();
    expect(await liveOpenDecisions({} as PaseoApi, stateOver([]), null)).toEqual([]);
    expect(projectAgents).not.toHaveBeenCalled();
  });
});

describe("Actions.answerDecision", () => {
  function actionsOver(decisions: StoredDecision[]): Actions {
    const state = stateOver(decisions);
    return new Actions(state, new Supervisor(state, {} as Stats), {} as TrackerWatch, {} as Stats);
  }

  it("sends nothing to an archived agent and withdraws its decisions", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(null);
    const decisions = [stored("old-owner")];
    await expect(actionsOver(decisions).answerDecision({} as PaseoApi, "old-owner:scope-approval", "Approve", "")).rejects.toThrow(/archived or gone/);
    expect(sendFromPlugin).not.toHaveBeenCalled();
    expect(decisions[0]?.status).toBe("withdrawn");
  });

  it("still answers a live agent", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(agent("new-owner"));
    const decisions = [stored("new-owner")];
    await actionsOver(decisions).answerDecision({} as PaseoApi, "new-owner:scope-approval", "Approve", "");
    expect(sendFromPlugin).toHaveBeenCalledTimes(1);
    expect(decisions[0]?.status).toBe("answered");
  });
});

describe("Actions.relaunchOwner", () => {
  it("withdraws the previous owner's open decisions, even if the archive hook never fires", async () => {
    vi.mocked(listTaroAgents).mockResolvedValueOnce([{ id: "old-owner", workspaceId: "wks-1", status: "idle", updatedAt: "2026-10-13T12:00:00Z", labels: {} } as unknown as PaseoAgent]);
    const decisions = [stored("old-owner"), stored("other-owner")];
    const state = { ...stateOver(decisions), forgetAgent: async () => undefined } as unknown as PluginState;
    const archive = vi.fn(async () => undefined);
    const create = vi.fn(async () => undefined);
    const paseo = { agents: { ref: () => ({ archive }) }, workspaces: { ref: () => ({ agents: { create } }) } } as unknown as PaseoApi;
    await new Actions(state, new Supervisor(state, {} as Stats), {} as TrackerWatch, {} as Stats).relaunchOwner(paseo, "taro", "TR-5");
    expect(archive).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(decisions.map((decision) => decision.status)).toEqual(["withdrawn", "open"]);
  });
});
