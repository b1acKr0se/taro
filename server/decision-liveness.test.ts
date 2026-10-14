// TR-009: a decision from an archived (or vanished) agent is never shown, and answering one messages no one.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredDecision } from "../shared/state";
import { Actions } from "./actions";
import { isAgentLive, listTaroAgents, projectAgents, projectArchivedAgents } from "./agents";
import { invalidateBoards, liveOpenDecisions, loadBoard } from "./board";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { sendFromPlugin } from "./send";
import type { Recovery } from "./recovery";
import { appendTicketNote } from "./tickets";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { Supervisor } from "./supervision";
import type { TrackerWatch } from "./tracker-watch";

// isAgentGone stays real: what it makes of Paseo's answers (and failures) is under test.
vi.mock("./agents", async (original) => ({
  ...(await original<typeof import("./agents")>()),
  fetchLiveAgent: vi.fn(),
  projectAgents: vi.fn(),
  projectArchivedAgents: vi.fn(async () => []),
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
    return new Actions(state, new Supervisor(state, {} as Stats, {} as Recovery), {} as TrackerWatch, {} as Stats, {} as Recovery);
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

  // TR-045: a chip on a card answers at once, and a second tap before the board reloads must not send a second answer.
  it("sends nothing for a decision already answered or withdrawn", async () => {
    const live = paseoWhere(async () => ({ agent: { id: "owner", status: "idle", archivedAt: null } }));
    for (const status of ["answered", "withdrawn"] as const) {
      vi.mocked(sendFromPlugin).mockClear();
      const decisions = [stored("owner", "taro", status)];
      await expect(actionsOver(decisions).answerDecision(live, key, "Approve", "")).rejects.toThrow("That decision is no longer open.");
      expect(sendFromPlugin).not.toHaveBeenCalled();
      expect(decisions[0]?.status).toBe(status);
    }
  });

  it("answers once when the same key is answered twice", async () => {
    const live = paseoWhere(async () => ({ agent: { id: "owner", status: "idle", archivedAt: null } }));
    const decisions = [stored("owner")];
    const actions = actionsOver(decisions);
    await actions.answerDecision(live, key, "Approve", "");
    await expect(actions.answerDecision(live, key, "Approve", "")).rejects.toThrow("That decision is no longer open.");
    expect(sendFromPlugin).toHaveBeenCalledTimes(1);
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

  // TR-028: an option that asks for text ("Change…") plus the user's text sent only the option's prompt.
  describe("with an option and typed text", () => {
    const live = paseoWhere(async () => ({ agent: { id: "owner", status: "idle", archivedAt: null } }));
    const withChange = (): StoredDecision => {
      const decision = stored("owner");
      decision.options.push({ label: "Change…", prompt: "Change the proposal…", consequence: "" });
      return decision;
    };

    beforeEach(() => vi.mocked(appendTicketNote).mockClear());

    it("sends the option's prompt followed by the text, and records the same words", async () => {
      const decisions = [withChange()];
      await actionsOver(decisions).answerDecision(live, key, "Change…", "  use cards B\n");
      expect(sendFromPlugin).toHaveBeenCalledTimes(1);
      expect(decisions[0]?.answer).toMatchObject({ text: "Change the proposal: use cards B", label: "Change…" });
      expect(vi.mocked(appendTicketNote).mock.calls[0]?.[2]).toContain(`→ Change… ("Change the proposal: use cards B")`);
    });

    it("joins text to an option whose prompt does not ask for it", async () => {
      const decisions = [withChange()];
      await actionsOver(decisions).answerDecision(live, key, "Approve", "and ship today");
      expect(decisions[0]?.answer?.text).toBe("Approve: and ship today");
    });

    it("sends only the prompt when the text is empty or blank", async () => {
      for (const text of ["", "   "]) {
        vi.mocked(sendFromPlugin).mockClear();
        const decisions = [withChange()];
        await actionsOver(decisions).answerDecision(live, key, "Change…", text);
        expect(decisions[0]?.answer?.text).toBe("Change the proposal…");
        expect(sendFromPlugin).toHaveBeenCalledTimes(1);
      }
    });

    it("does not repeat the prompt when the text already starts with it", async () => {
      for (const [label, text, words] of [
        ["Approve", "Approve", "Approve"],
        ["Change…", "Change the proposal…", "Change the proposal…"],
        ["Change…", "Change the proposal use cards B", "Change the proposal use cards B"],
      ] as const) {
        const decisions = [withChange()];
        await actionsOver(decisions).answerDecision(live, key, label, text);
        expect(decisions[0]?.answer?.text).toBe(words);
      }
    });

    it("sends the text alone when no option is chosen", async () => {
      const decisions = [withChange()];
      await actionsOver(decisions).answerDecision(live, key, null, " my own words ");
      expect(decisions[0]?.answer).toMatchObject({ text: "my own words", label: null });
    });
  });

  it("records where the user answered in the ANSWER note", async () => {
    const live = paseoWhere(async () => ({ agent: { id: "owner", status: "idle", archivedAt: null } }));
    for (const [from, words] of [
      ["tab", "the agent's tab"],
      [undefined, "the Taro screen"],
    ] as const) {
      vi.mocked(appendTicketNote).mockClear();
      await actionsOver([stored("owner")]).answerDecision(live, key, "Approve", "", from);
      expect(vi.mocked(appendTicketNote).mock.calls[0]?.[2]).toMatch(new RegExp(`^ANSWER .*\\(the user, from ${words}\\)$`));
    }
  });
});

describe("isAgentLive", () => {
  const paseoWhere = (refresh: () => Promise<unknown>) => ({ agents: { ref: () => ({ refresh }) } }) as unknown as PaseoApi;

  it("is false only when Paseo says the agent is archived or unknown", async () => {
    expect(await isAgentLive(paseoWhere(async () => ({ agent: { id: "a", archivedAt: null } })), "a")).toBe(true);
    expect(await isAgentLive(paseoWhere(async () => ({ agent: { id: "a", archivedAt: "2026-10-13T12:00:00Z" } })), "a")).toBe(false);
    expect(await isAgentLive(paseoWhere(async () => null), "a")).toBe(false);
  });

  it("counts a failed lookup as live, so a hiccup does not hide an open card", async () => {
    expect(await isAgentLive(paseoWhere(async () => Promise.reject(new Error("timeout"))), "a")).toBe(true);
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
    await new Actions(state, new Supervisor(state, {} as Stats, {} as Recovery), {} as TrackerWatch, {} as Stats, {} as Recovery).relaunchOwner(paseo, "taro", "TR-5");
    expect(archive).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(decisions.map((decision) => decision.status)).toEqual(["withdrawn", "open"]);
  });
});
