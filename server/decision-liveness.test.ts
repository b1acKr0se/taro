// TR-009: a decision from an archived (or vanished) agent is never shown, and answering one messages no one.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredDecision } from "../shared/state";
import { Actions } from "./actions";
import { listTaroAgents, projectAgents } from "./agents";
import { invalidateBoards, liveOpenDecisions, loadBoard } from "./board";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { sendFromPlugin } from "./send";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { Supervisor } from "./supervision";
import type { TrackerWatch } from "./tracker-watch";

// isAgentGone stays real: what it makes of Paseo's answers (and failures) is under test.
vi.mock("./agents", async (original) => ({
  ...(await original<typeof import("./agents")>()),
  fetchLiveAgent: vi.fn(),
  projectAgents: vi.fn(),
  listTaroAgents: vi.fn(async () => []),
  isMidTurn: () => false,
}));
vi.mock("./send", () => ({ sendFromPlugin: vi.fn(async () => undefined), sendWithoutInterrupting: vi.fn(async () => undefined), sendCommand: vi.fn() }));
vi.mock("./package-files", () => ({ TEMPLATES: { answer: "answer" }, skillDirectory: async () => "/skill", message: async (path: string) => path }));
vi.mock("./projects", () => ({
  projectPaths: async () => ({ tracker: "/tracker", suggestions: "/nonexistent/taro-suggestions.md" }),
  readProjectConfig: async () => null,
  requireProjectConfig: async () => ({ owner: { model: "claude/sonnet", thinking: "" } }),
}));
vi.mock("./tickets", () => ({
  appendTicketNote: vi.fn(async () => undefined),
  viewTicket: async () => ({ title: "x", implementationNotes: "" }),
  listTickets: async () => [{ id: "TR-5", title: "x", status: "Planning", labels: [], parentTaskId: null, acceptanceCriteriaCompleted: 0, acceptanceCriteriaCount: 0, updatedAt: null }],
}));
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

  const paseoWhere = (refresh: () => Promise<unknown>) => ({ agents: { ref: () => ({ refresh }) } }) as unknown as PaseoApi;
  const key = "owner:scope-approval";

  for (const [gone, refresh] of [
    ["archived", async () => ({ agent: { id: "owner", archivedAt: "2026-10-13T12:00:00Z" } })],
    ["unknown to Paseo", async () => null],
  ] as const) {
    it(`sends nothing to an agent ${gone} and withdraws its decisions`, async () => {
      const decisions = [stored("owner")];
      await expect(actionsOver(decisions).answerDecision(paseoWhere(refresh), key, "Approve", "")).rejects.toThrow(/archived or gone/);
      expect(sendFromPlugin).not.toHaveBeenCalled();
      expect(decisions[0]?.status).toBe("withdrawn");
    });
  }

  it("keeps the decision open when Paseo cannot be asked, sending nothing", async () => {
    const decisions = [stored("owner")];
    const failing = paseoWhere(async () => Promise.reject(new Error("timeout")));
    await expect(actionsOver(decisions).answerDecision(failing, key, "Approve", "")).rejects.toThrow("timeout");
    expect(sendFromPlugin).not.toHaveBeenCalled();
    expect(decisions[0]?.status).toBe("open");
  });

  it("still answers a live agent, closed ones included", async () => {
    for (const status of ["idle", "closed"]) {
      vi.mocked(sendFromPlugin).mockClear();
      const decisions = [stored("owner")];
      await actionsOver(decisions).answerDecision(paseoWhere(async () => ({ agent: { id: "owner", status, archivedAt: null } })), key, "Approve", "");
      expect(sendFromPlugin).toHaveBeenCalledTimes(1);
      expect(decisions[0]?.status).toBe("answered");
    }
  });
});

describe("loadBoard", () => {
  it("shows a ticket's and the manager's decisions only from agents Paseo still lists", async () => {
    invalidateBoards();
    const live = { id: "new-owner", status: "idle", provider: "claude", pendingPermissions: [], updatedAt: "2026-10-13T12:00:00Z", labels: { "taro.role": "owner", "taro.ticket": "TR-5" } };
    vi.mocked(projectAgents).mockResolvedValue([live as unknown as PaseoAgent]);
    const managerDecision = (agentId: string) => ({ ...stored(agentId), key: `${agentId}:priority`, ticket: null }) as StoredDecision;
    const decisions = [stored("old-owner"), stored("new-owner"), managerDecision("old-manager"), stored("old-owner", "other")];
    const board = await loadBoard({} as PaseoApi, { ...stateOver(decisions), allAgents: async () => ({}) } as unknown as PluginState, "taro");
    expect(board.cards[0]?.decisions.map((decision) => decision.agentId)).toEqual(["new-owner"]);
    expect(board.managerDecisions).toEqual([]);
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
