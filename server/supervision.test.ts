import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentState, StoredDecision } from "../shared/state";
import { fetchLiveAgent } from "./agents";
import type { HookAgent, PaseoAgent, PaseoApi, TimelineItem, TurnOutcome } from "./host-types";
import { sendFromPlugin } from "./send";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { allAssistantText, autoCompactedThisTurn, closingText, currentTurn, humanMessages, identityFromLabels, Supervisor } from "./supervision";

vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn(), isMidTurn: () => false, listTaroAgents: async () => [] }));
vi.mock("./send", async (original) => ({ ...(await original<typeof import("./send")>()), sendFromPlugin: vi.fn(async () => undefined), sendCommand: vi.fn(async () => undefined) }));
vi.mock("./package-files", () => ({
  TEMPLATES: { reload: "reload", nudge: "nudge" },
  skillDirectory: async () => "/skill",
  message: async (path: string, values: Record<string, string> = {}) => `${path}:${values.ticket ?? ""}`,
}));
vi.mock("./projects", () => ({ readProjectConfig: async () => null }));

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
    return new Supervisor(state, stats);
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
      await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, first, null);
      expect(reloads()).toBe(1);
      expect(vi.mocked(sendFromPlugin).mock.calls[0]?.[2]).toBe("reload:TR-9");

      // The reload's own turn, and any later one: the compaction is still in the stored timeline.
      await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, items(...first, reloadTurn, reply), null);
      await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, items(...first, reloadTurn, reply, userTurn, reply), null);
      expect(reloads()).toBe(1);
    });
  }

  it("sends no reload for a manual or still-loading compaction", async () => {
    const taro = supervisor();
    await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, items(userTurn, claudeManual, reply), null);
    await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, items(userTurn, codexLoading, reply), null);
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
    await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, items(...timeline), null);
  }

  beforeEach(() => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner as unknown as PaseoAgent);
  });

  it("does not reopen an answered decision from an earlier turn's block", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats);
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
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats);
    const first = [human("hi"), reply];
    const second = [plugin("nudge"), ask("merge", "Merge now?")];
    await run(taro, ...first, ...second);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);

    await run(taro, ...first, ...second, plugin("helper report"), reply);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);

    await run(taro, ...first, ...second, plugin("helper report"), reply, human("yes, merge"), reply);
    expect(decisions.map((decision) => [decision.status, decision.answer?.text])).toEqual([["answered", "yes, merge"]]);
  });

  it("does not let an earlier turn's user words close a stored decision whose block is not in the timeline", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats);
    // Stored from an earlier read (for instance reconcile's tail page); its block is not in this timeline.
    await run(taro, plugin("start"), ask("merge", "Merge now?"));
    await run(taro, human("hi"), reply, plugin("helper report"), reply);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
  });

  it("closes an earlier turn's decision when the user answers in the tab, though the block is in the timeline", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats);
    const first = [plugin("start"), ask("merge", "Merge now?")];
    await run(taro, ...first);
    await run(taro, ...first, human("merge it"), reply);
    expect(decisions.map((decision) => decision.status)).toEqual(["answered"]);
  });

  it("takes the status line from this turn only, not an earlier turn's closing message", async () => {
    const { state, agents } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats);
    const failed = { kind: "failed" } as unknown as TurnOutcome;
    await taro.onTurnEnded({} as PaseoApi, hookAgent, failed, items(human("go"), reply, human("again"), { type: "tool_call", callId: "c2", name: "shell", status: "failed" }), null);
    expect(agents[owner.id]?.lastStatus).toBeNull();
  });
});
