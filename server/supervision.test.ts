import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentState, StoredDecision } from "../shared/state";
import { fetchLiveAgent, listTaroAgents } from "./agents";
import type { HookAgent, PaseoAgent, PaseoApi, TimelineItem, TurnOutcome } from "./host-types";
import { sendFromPlugin } from "./send";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { allAssistantText, autoCompactedThisTurn, closingText, currentTurn, humanMessages, identityFromLabels, Supervisor } from "./supervision";

vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn(), isMidTurn: () => false, listTaroAgents: vi.fn(async () => []) }));
vi.mock("./send", async (original) => ({ ...(await original<typeof import("./send")>()), sendFromPlugin: vi.fn(async () => undefined), sendCommand: vi.fn(async () => undefined) }));
vi.mock("./package-files", () => ({
  TEMPLATES: { reload: "reload", nudge: "nudge", subagentReport: "report" },
  skillDirectory: async () => "/skill",
  message: async (path: string, values: Record<string, string> = {}) => (path === "report" ? `report:${values.role}:${values.report}` : `${path}:${values.ticket ?? ""}`),
}));
vi.mock("./projects", () => ({ readProjectConfig: async () => null }));

const recovery = { onCrash: vi.fn(async () => undefined), recoverLeftovers: async () => 0 } as unknown as Recovery;

const turn = [
  { type: "user_message", text: "Approve the scope", clientMessageId: "taro-1" },
  { type: "user_message", text: "also add a test" },
  { type: "assistant_message", text: "Working on it." },
  { type: "tool_call", callId: "c1", name: "shell", status: "completed" },
  { type: "assistant_message", text: "Done. " },
  { type: "assistant_message", text: "\ndone: shipped" },
  { type: "reasoning", text: "…" },
] as unknown as TimelineItem[];

describe("turn text", () => {
  it("joins only the assistant messages at the very end", () => {
    expect(closingText(turn)).toBe("Done. \ndone: shipped");
  });

  it("collects every assistant message for decision blocks", () => {
    expect(allAssistantText(turn)).toBe("Working on it.Done. \ndone: shipped");
  });

  it("treats untagged user messages as the user's own words", () => {
    expect(humanMessages(turn)).toEqual(["also add a test"]);
  });
});

describe("identityFromLabels", () => {
  it("reads Taro's labels", () => {
    expect(identityFromLabels({ "taro.project": "app", "taro.role": "owner", "taro.ticket": "AP-1" }, "AP-1 · x")).toEqual({
      project: "app",
      role: "owner",
      ticket: "AP-1",
      title: "AP-1 · x",
    });
  });

  it("reads a subagent's job, and the label `helper` from before TR-017 as an implementer", () => {
    expect(identityFromLabels({ "taro.project": "app", "taro.role": "researcher", "taro.ticket": "AP-1" }, null)?.role).toBe("researcher");
    expect(identityFromLabels({ "taro.project": "app", "taro.role": "helper", "taro.ticket": "AP-1" }, null)?.role).toBe("implementer");
  });

  it("ignores agents that are not Taro's", () => {
    expect(identityFromLabels({ other: "x" }, null)).toBeNull();
    expect(identityFromLabels({ "taro.project": "app", "taro.role": "pilot" }, null)).toBeNull();
  });
});

// Shapes Paseo 0.11.2 emits: Claude maps compact_boundary to completed + "auto" | "manual"
// (providers/claude/agent.js); Codex adds a trigger only for a compaction it started on request
// (codex-app-server-agent.js createContextCompactionTimelineItem), and emits "loading" first.
const claudeAuto = { type: "compaction", status: "completed", trigger: "auto", preTokens: 160_000 };
const claudeManual = { type: "compaction", status: "completed", trigger: "manual", preTokens: 90_000 };
const codexAuto = { type: "compaction", status: "completed" };
const codexLoading = { type: "compaction", status: "loading" };

function items(...entries: readonly object[]): TimelineItem[] {
  return entries as unknown as TimelineItem[];
}

const userTurn = { type: "user_message", text: "carry on" };
const reloadTurn = { type: "user_message", text: "Your context was compacted.", messageId: "taro-reload" };
const reply = { type: "assistant_message", text: "done: tests pass" };

describe("currentTurn", () => {
  it("starts at the last user message", () => {
    expect(currentTurn(items(userTurn, claudeAuto, reply, reloadTurn, reply))).toEqual([reloadTurn, reply]);
  });

  it("is the whole timeline without a user message, and empty for an empty one", () => {
    expect(currentTurn(items(claudeAuto, reply))).toEqual([claudeAuto, reply]);
    expect(currentTurn([])).toEqual([]);
  });
});

describe("autoCompactedThisTurn", () => {
  it("sees Claude's auto trigger and Codex's untriggered compaction", () => {
    expect(autoCompactedThisTurn(items(userTurn, claudeAuto, reply))).toBe(true);
    expect(autoCompactedThisTurn(items(userTurn, codexLoading, codexAuto, reply))).toBe(true);
  });

  it("ignores manual and still-loading compactions", () => {
    expect(autoCompactedThisTurn(items(userTurn, claudeManual, reply))).toBe(false);
    expect(autoCompactedThisTurn(items(userTurn, { ...codexAuto, trigger: "manual" }, reply))).toBe(false);
    expect(autoCompactedThisTurn(items(userTurn, codexLoading, reply))).toBe(false);
  });

  it("ignores a compaction from an earlier turn", () => {
    expect(autoCompactedThisTurn(items(userTurn, claudeAuto, reply, reloadTurn, reply))).toBe(false);
  });

  it("is false for an empty timeline", () => {
    expect(autoCompactedThisTurn([])).toBe(false);
  });
});

describe("Supervisor.onTurnEnded after an automatic compaction", () => {
  const owner = {
    id: "owner-1",
    provider: "claude",
    model: "sonnet",
    title: "TR-9 · x",
    status: "idle",
    labels: { "taro.project": "taro", "taro.role": "owner", "taro.ticket": "TR-9" },
  };

  function supervisor(): Supervisor {
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
    const stats = { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats;
    return new Supervisor(state, stats, recovery);
  }

  const hookAgent = { id: owner.id, parentAgentId: null } as unknown as HookAgent;
  const completed = { kind: "completed" } as unknown as TurnOutcome;

  beforeEach(() => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner as unknown as PaseoAgent);
    vi.mocked(sendFromPlugin).mockClear();
  });

  function reloads(): number {
    return vi.mocked(sendFromPlugin).mock.calls.filter(([, , text]) => text.startsWith("reload:")).length;
  }

  for (const [provider, compaction] of [
    ["Claude", claudeAuto],
    ["Codex", codexAuto],
  ] as const) {
    it(`sends the reload once for a ${provider} automatic compaction`, async () => {
      const taro = supervisor();
      const first = items(userTurn, compaction, reply);
      await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, first, null, undefined);
      expect(reloads()).toBe(1);
      expect(vi.mocked(sendFromPlugin).mock.calls[0]?.[2]).toBe("reload:TR-9");

      // The reload's own turn, and any later one: the compaction is still in the stored timeline.
      await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, items(...first, reloadTurn, reply), null, undefined);
      await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, items(...first, reloadTurn, reply, userTurn, reply), null, undefined);
      expect(reloads()).toBe(1);
    });
  }

  it("sends no reload for a manual or still-loading compaction", async () => {
    const taro = supervisor();
    await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, items(userTurn, claudeManual, reply), null, undefined);
    await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, items(userTurn, codexLoading, reply), null, undefined);
    expect(reloads()).toBe(0);
  });
});

// The hook passes the agent's whole stored timeline (agent-manager.js passes timelineStore.getItems),
// so every reader must look only at the turn that ended.
describe("Supervisor.onTurnEnded reads only the current turn", () => {
  const owner = {
    id: "owner-2",
    provider: "claude",
    model: "sonnet",
    title: "TR-9 · x",
    status: "idle",
    labels: { "taro.project": "taro", "taro.role": "owner", "taro.ticket": "TR-9" },
  };
  const hookAgent = { id: owner.id, parentAgentId: null } as unknown as HookAgent;
  const completed = { kind: "completed" } as unknown as TurnOutcome;

  function fakeState(): { state: PluginState; decisions: StoredDecision[]; agents: Record<string, AgentState> } {
    const decisions: StoredDecision[] = [];
    const agents: Record<string, AgentState> = {};
    const state = {
      allDecisions: async () => decisions,
      updateDecisions: async <T>(change: (stored: StoredDecision[]) => T) => change(decisions),
      agent: async (agentId: string) => agents[agentId] ?? null,
      updateAgent: async <T>(agentId: string, initial: () => AgentState, change: (record: AgentState) => T) => {
        const record = agents[agentId] ?? initial();
        agents[agentId] = record;
        return change(record);
      },
    } as unknown as PluginState;
    return { state, decisions, agents };
  }

  function ask(id: string, question: string): object {
    return {
      type: "assistant_message",
      text: `Need a call.\n\n\`\`\`decision\nid: ${id}\nquestion: ${question}\nwhy: it matters\nblocking: true\noptions:\n  - label: Yes\n    prompt: Yes\n  - label: No\n    prompt: No\nrecommended: Yes\nreason: simpler\n\`\`\`\n\nwaiting: ${id}`,
    };
  }

  const human = (text: string) => ({ type: "user_message", text });
  const plugin = (text: string) => ({ type: "user_message", text, messageId: "taro-x" });

  async function run(taro: Supervisor, ...timeline: readonly object[]): Promise<void> {
    await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, items(...timeline), null, undefined);
  }

  beforeEach(() => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner as unknown as PaseoAgent);
  });

  it("does not reopen an answered decision from an earlier turn's block", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [human("start"), ask("scope", "Approve v1?")];
    const second = [plugin("revise"), ask("scope", "Approve v2?")];
    await run(taro, ...first);
    await run(taro, ...first, ...second);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.question).toBe("Approve v2?");
    decisions[0]!.status = "answered";

    await run(taro, ...first, ...second, plugin("carry on"), reply);
    expect(decisions.map((decision) => [decision.question, decision.status])).toEqual([["Approve v2?", "answered"]]);
  });

  it("does not let an earlier turn's user words close a decision asked later", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [human("hi"), reply];
    const second = [plugin("nudge"), ask("merge", "Merge now?")];
    await run(taro, ...first, ...second);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);

    await run(taro, ...first, ...second, plugin("implementer report"), reply);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);

    await run(taro, ...first, ...second, plugin("implementer report"), reply, human("yes, merge"), reply);
    expect(decisions.map((decision) => [decision.status, decision.answer?.text])).toEqual([["answered", "yes, merge"]]);
  });

  it("does not let an earlier turn's user words close a stored decision whose block is not in the timeline", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    // Stored from an earlier read (for instance reconcile's tail page); its block is not in this timeline.
    await run(taro, plugin("start"), ask("merge", "Merge now?"));
    await run(taro, human("hi"), reply, plugin("implementer report"), reply);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
  });

  it("closes an earlier turn's decision when the user answers in the tab, though the block is in the timeline", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [plugin("start"), ask("merge", "Merge now?")];
    await run(taro, ...first);
    await run(taro, ...first, human("merge it"), reply);
    expect(decisions.map((decision) => decision.status)).toEqual(["answered"]);
  });

  it("takes the status line from this turn only, not an earlier turn's closing message", async () => {
    const { state, agents } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const failed = { kind: "failed" } as unknown as TurnOutcome;
    await taro.onTurnEnded({} as PaseoApi, hookAgent, failed, items(human("go"), reply, human("again"), { type: "tool_call", callId: "c2", name: "shell", status: "failed" }), null, undefined);
    expect(agents[owner.id]?.lastStatus).toBeNull();
  });
});

// TR-009: an archived or relaunched agent's questions can never be answered.
describe("Supervisor withdraws decisions of agents that are no longer live", () => {
  function stored(agentId: string, project = "taro"): StoredDecision {
    return { key: `${agentId}:scope-approval`, id: "scope-approval", agentId, project, status: "open" } as unknown as StoredDecision;
  }

  function supervisorOver(decisions: StoredDecision[]): Supervisor {
    const state = {
      allDecisions: async () => decisions,
      updateDecisions: async <T>(change: (stored: StoredDecision[]) => T) => change(decisions),
      agent: async () => null,
      updateAgent: async () => undefined,
    } as unknown as PluginState;
    return new Supervisor(state, {} as Stats, recovery);
  }

  it("withdraws every open decision of an archived agent and no one else's", async () => {
    const decisions = [stored("old-owner"), stored("new-owner")];
    expect(await supervisorOver(decisions).withdrawDecisionsOf("old-owner")).toBe(1);
    expect(decisions.map((decision) => decision.status)).toEqual(["withdrawn", "open"]);
  });

  it("at start, withdraws the project's decisions of agents Paseo no longer lists, keeping closed ones", async () => {
    // A closed agent is listed (not archived) and resumes when answered; the archived one is not listed.
    vi.mocked(listTaroAgents).mockResolvedValueOnce([{ id: "closed-owner", status: "closed", labels: {} } as unknown as PaseoAgent]);
    const decisions = [stored("archived-owner"), stored("closed-owner"), stored("archived-elsewhere", "other")];
    await supervisorOver(decisions).reconcile({} as PaseoApi, ["taro"]);
    expect(decisions.map((decision) => decision.status)).toEqual(["withdrawn", "open", "open"]);
  });
});

describe("Supervisor.onTurnEnded after a crash (TR-012)", () => {
  const manager = {
    id: "manager-1",
    provider: "claude",
    model: "opus",
    title: "Taro manager",
    status: "error",
    labels: { "taro.project": "taro", "taro.role": "manager" },
  };
  const hookAgent = { id: manager.id, parentAgentId: null } as unknown as HookAgent;

  function fakeState(): PluginState {
    const agents: Record<string, AgentState> = {};
    return {
      allDecisions: async () => [],
      updateDecisions: async <T>(change: (stored: never[]) => T) => change([]),
      agent: async (agentId: string) => agents[agentId] ?? null,
      updateAgent: async <T>(agentId: string, initial: () => AgentState, change: (record: AgentState) => T) => {
        const record = agents[agentId] ?? initial();
        agents[agentId] = record;
        return change(record);
      },
    } as unknown as PluginState;
  }
  const stats = { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats;
  const failed = (message: string) => ({ kind: "failed", error: { message } }) as unknown as TurnOutcome;

  beforeEach(() => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(manager as unknown as PaseoAgent);
    vi.mocked(recovery.onCrash).mockClear();
    vi.mocked(sendFromPlugin).mockClear();
  });

  it("hands any role's crash, the manager's included, to recovery and sends nothing else", async () => {
    const taro = new Supervisor(fakeState(), stats, recovery);
    const crash = "Claude stopped unexpectedly (signal SIGABRT). Any background shells, monitors or other work it had running were terminated with it.";
    await taro.onTurnEnded({} as PaseoApi, hookAgent, failed(crash), items(userTurn, reply), null, undefined);
    expect(vi.mocked(recovery.onCrash).mock.calls.map(([, agent, identity, error]) => [agent.id, identity.role, error])).toEqual([[manager.id, "manager", crash]]);
    expect(sendFromPlugin).not.toHaveBeenCalled();
  });

  it("leaves other failures to the existing handling", async () => {
    const taro = new Supervisor(fakeState(), stats, recovery);
    await taro.onTurnEnded({} as PaseoApi, hookAgent, failed("API Error: 529 overloaded"), items(userTurn, reply), null, undefined);
    await taro.onTurnEnded({} as PaseoApi, hookAgent, { kind: "completed" } as unknown as TurnOutcome, items(userTurn, reply), null, undefined);
    expect(recovery.onCrash).not.toHaveBeenCalled();
  });
});

describe("Supervisor.onTurnEnded delivers a subagent's report", () => {
  const owner = { id: "owner-3", title: "TR-3 · x", status: "idle", updatedAt: "2026-10-13T15:00:00Z", labels: { "taro.project": "taro", "taro.role": "owner", "taro.ticket": "TR-3" } };

  function subagent(label: string) {
    return { id: `${label}-1`, title: `TR-3 · ${label}: building the parser`, status: "idle", labels: { "taro.project": "taro", "taro.role": label, "taro.ticket": "TR-3" } };
  }

  function supervisor(): Supervisor {
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
    return new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
  }

  // `helper` is the label of subagents started before TR-017.
  it.each([
    ["implementer", "implementer"],
    ["researcher", "researcher"],
    ["helper", "implementer"],
  ])("sends the final message of an agent labelled %s to the ticket's owner as its %s's report", async (label, job) => {
    const agent = subagent(label);
    vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (id === agent.id ? agent : id === owner.id ? owner : null) as unknown as PaseoAgent);
    vi.mocked(sendFromPlugin).mockClear();
    await supervisor().onTurnEnded({} as PaseoApi, { id: agent.id, parentAgentId: owner.id } as unknown as HookAgent, { kind: "completed" } as unknown as TurnOutcome, items(userTurn, reply), null, undefined);
    expect(vi.mocked(sendFromPlugin).mock.calls.map(([, id, text]) => [id, text])).toEqual([[owner.id, `report:${job}:done: tests pass`]]);
  });
});
