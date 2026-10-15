import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentState, StoredDecision } from "../shared/state";
import { fetchLiveAgent, listTaroAgents } from "./agents";
import type { HookAgent, PaseoAgent, PaseoApi, TimelineItem, TurnOutcome } from "./host-types";
import { sendFromPlugin } from "./send";
import { viewTicket } from "./tickets";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { allAssistantText, autoCompactedThisTurn, closingText, currentTurn, humanMessages, identityFromLabels, Supervisor, tabMessages } from "./supervision";

vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn(), isMidTurn: () => false, listTaroAgents: vi.fn(async () => []) }));
vi.mock("./send", async (original) => ({ ...(await original<typeof import("./send")>()), sendFromPlugin: vi.fn(async () => undefined), sendCommand: vi.fn(async () => undefined) }));
vi.mock("./package-files", () => ({
  TEMPLATES: { reload: "reload", nudge: "nudge", subagentReport: "report", evidenceMissing: "evidence-missing", decisionHeld: "decision-held", decisionCorrection: "decision-correction" },
  skillDirectory: async () => "/skill",
  message: async (path: string, values: Record<string, string> = {}) => (path === "evidence-missing" ? `evidence-missing:${values.ticket}:${values.missing}` : path === "report" ? `report:${values.role}:${values.report}` : path === "decision-held" ? `decision-held:${values.held}:${values.open}` : `${path}:${values.ticket ?? ""}`),
}));
vi.mock("./projects", () => ({ readProjectConfig: async () => null, projectPaths: async () => ({ tracker: "/tracker" }) }));
vi.mock("./tickets", () => ({ viewTicket: vi.fn() }));

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

  it("counts a Taro chat's message as the user's words, but not as typed in the tab (TR-102)", () => {
    const withChat = [...turn, { type: "user_message", text: "from the chat", clientMessageId: "chat-abc-1" }] as unknown as TimelineItem[];
    expect(humanMessages(withChat)).toEqual(["also add a test", "from the chat"]);
    expect(tabMessages(withChat)).toEqual(["also add a test"]);
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

  // TR-108: a plan approval reads the same every round, so a re-ask is told from a replay by its turn.
  it("reopens an answered decision the agent asks again in a later turn, every round", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [human("start"), ask("scope-approval", "Approve the plan for TR-9?")];
    await run(taro, ...first);
    decisions[0]!.status = "answered";
    const second = [human("also remove the Screens section"), { type: "assistant_message", text: "Plan updated." }, ask("scope-approval", "Approve the plan for TR-9?")];
    await run(taro, ...first, ...second);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
    expect(decisions[0]?.answer).toBeNull();

    decisions[0]!.status = "withdrawn";
    const third = [plugin("one more change"), ask("scope-approval", "Approve the plan for TR-9?")];
    await run(taro, ...first, ...second, ...third);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
  });

  it("reopens a re-ask whose turn opens with the same words, as its text differs", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [human("go on"), ask("naming", "Which name?")];
    await run(taro, ...first);
    decisions[0]!.status = "answered";
    await run(taro, ...first, human("go on"), { type: "assistant_message", text: "Tried both names." }, ask("naming", "Which name?"));
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
  });

  it("keeps an answered decision answered when the same turn is seen again", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [human("start"), ask("scope-approval", "Approve the plan for TR-9?")];
    await run(taro, ...first);
    decisions[0]!.status = "answered";
    await run(taro, ...first);
    await run(taro, human("earlier"), reply, ...first);
    expect(decisions.map((decision) => decision.status)).toEqual(["answered"]);
  });

  it("keeps the question comparison for a decision stored before turns were recorded", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    await run(taro, human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
    // Loading the state file fills a missing turn with null.
    decisions[0]!.turn = null;
    decisions[0]!.status = "answered";
    await run(taro, human("reload"), ask("scope-approval", "Approve the plan for TR-9?"));
    expect(decisions.map((decision) => decision.status)).toEqual(["answered"]);
    await run(taro, human("change"), ask("scope-approval", "Approve the new plan for TR-9?"));
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
  });

  it("keeps an answered decision answered when the reconcile after a restart reads its turn again", async () => {
    const { state, decisions, agents } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [human("start"), ask("scope-approval", "Approve the plan for TR-9?")];
    await run(taro, ...first);
    decisions[0]!.status = "answered";
    delete agents[owner.id];
    // Paseo's projected page coalesces streamed chunks; a page without the turn's opening falls back to the question.
    const assistant = ask("scope-approval", "Approve the plan for TR-9?") as { text: string };
    const pages = [
      [human("start"), { type: "assistant_message", text: assistant.text.slice(0, 20) }, { type: "assistant_message", text: assistant.text.slice(20) }],
      [assistant],
    ];
    for (const page of pages) {
      vi.mocked(listTaroAgents).mockResolvedValueOnce([{ ...owner, updatedAt: new Date().toISOString() } as unknown as PaseoAgent]);
      const paseo = { agents: { ref: () => ({ timeline: { refetch: async () => ({ entries: page.map((item) => ({ item })) }) } }) } } as unknown as PaseoApi;
      await taro.reconcile(paseo, ["taro"]);
      delete agents[owner.id];
    }
    expect(decisions.map((decision) => decision.status)).toEqual(["answered"]);
  });

  it("reopens a re-ask the reconcile finds at the end of a turn longer than one page, paging back to its opening", async () => {
    const { state, decisions, agents } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    await run(taro, human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
    decisions[0]!.status = "answered";
    delete agents[owner.id];
    // The revision turn: its opening and some tool calls on an older page, the re-ask on the tail page.
    const tools = (from: number) => Array.from({ length: 40 }, (_, index) => ({ type: "tool_call", callId: `c${from + index}`, name: "shell", status: "completed" }));
    const tail = [...tools(40).slice(1), ask("scope-approval", "Approve the plan for TR-9?")];
    const older = [human("also remove the Screens section"), ...tools(0).slice(1)];
    const requests: unknown[] = [];
    const refetch = async (options: { direction: string }) => {
      requests.push(options);
      const page = options.direction === "tail" ? { items: tail, hasOlder: true } : { items: older, hasOlder: false };
      return { entries: page.items.map((item) => ({ item })), hasOlder: page.hasOlder, startCursor: { epoch: "e", seq: options.direction === "tail" ? 41 : 1 } };
    };
    vi.mocked(listTaroAgents).mockResolvedValueOnce([{ ...owner, updatedAt: new Date().toISOString() } as unknown as PaseoAgent]);
    await taro.reconcile({ agents: { ref: () => ({ timeline: { refetch } }) } } as unknown as PaseoApi, ["taro"]);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
    expect(requests).toEqual([
      { direction: "tail", limit: 40, projection: "projected" },
      { direction: "before", cursor: { epoch: "e", seq: 41 }, limit: 40, projection: "projected" },
    ]);
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

  it("keeps a decision open when the user sends a message from a Taro chat beside its card (TR-102, seen end to end)", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [plugin("start"), ask("indent-style", "Tabs or spaces?")];
    await run(taro, ...first);
    const fromChat = { type: "user_message", text: "a message sent while the decision is open", clientMessageId: "chat-mv8xqzqs-1kpppuif" };
    await run(taro, ...first, fromChat, reply);
    expect(decisions.map((decision) => [decision.status, decision.answer])).toEqual([["open", null]]);
    // Words typed in the agent's own tab still answer it.
    await run(taro, ...first, fromChat, reply, human("spaces"), reply);
    expect(decisions.map((decision) => [decision.status, decision.answer?.text])).toEqual([["answered", "spaces"]]);
  });

  // TR-124: an owner asks the user one thing at a time.
  describe("one open question per owner", () => {
    const held = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("decision-held:"));
    const both = (first: string, second: string) => ({ type: "assistant_message", text: `${(ask(first, `${first}?`) as { text: string }).text.replace(/\n\nwaiting: .*$/, "")}\n\n${(ask(second, `${second}?`) as { text: string }).text}` });

    beforeEach(() => {
      vi.mocked(sendFromPlugin).mockClear();
    });

    it("shows only the first of two decisions asked in one turn and tells the owner why", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("start"), both("naming", "scope-approval"));
      expect(decisions.map((decision) => [decision.id, decision.status, decision.held])).toEqual([
        ["naming", "open", undefined],
        ["scope-approval", "withdrawn", true],
      ]);
      expect(held()).toEqual(["decision-held:`scope-approval`:naming"]);
    });

    it("holds a later turn's decision while one is open, and shows it once the first is answered", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("start"), ask("naming", "naming?")];
      await run(taro, ...first);
      const second = [plugin("carry on"), ask("scope-approval", "scope-approval?")];
      await run(taro, ...first, ...second);
      expect(decisions.map((decision) => decision.status)).toEqual(["open", "withdrawn"]);
      expect(held()).toHaveLength(1);

      // The same turn seen again (a repeated hook, the reconcile) holds nothing new and says nothing.
      await run(taro, ...first, ...second);
      expect(held()).toHaveLength(1);

      decisions[0]!.status = "answered";
      await run(taro, ...first, ...second, plugin("Call it Notes"), ask("scope-approval", "scope-approval?"));
      // Shown now, so no longer held (TR-136).
      expect(decisions.map((decision) => [decision.id, decision.status, decision.held])).toEqual([
        ["naming", "answered", undefined],
        ["scope-approval", "open", undefined],
      ]);
      expect(held()).toHaveLength(1);
    });

    it("clears the hold when the owner withdraws a held-back question itself, so no new owner is handed it (TR-136)", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("start"), both("naming", "scope-approval")];
      await run(taro, ...first);
      expect(decisions[1]?.held).toBe(true);
      const withdrawal = { type: "assistant_message", text: "```decision\nid: scope-approval\nstatus: withdrawn\n```" };
      await run(taro, ...first, plugin("carry on"), withdrawal);
      expect(decisions.map((decision) => [decision.id, decision.status, decision.held])).toEqual([
        ["naming", "open", undefined],
        ["scope-approval", "withdrawn", false],
      ]);
    });

    it("lets the owner withdraw the open decision and ask the next in the same message", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("start"), ask("naming", "naming?")];
      await run(taro, ...first);
      const withdrawal = { type: "assistant_message", text: "Going with Notes.\n\n```decision\nid: naming\nstatus: withdrawn\n```" };
      await run(taro, ...first, plugin("carry on"), withdrawal, ask("scope-approval", "scope-approval?"));
      expect(decisions.map((decision) => [decision.id, decision.status])).toEqual([
        ["naming", "withdrawn"],
        ["scope-approval", "open"],
      ]);
      expect(held()).toEqual([]);
    });

    it("withdraws before it holds, so the withdrawal may follow the next question in the message", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("start"), ask("naming", "naming?")];
      await run(taro, ...first);
      const withdrawal = { type: "assistant_message", text: "```decision\nid: naming\nstatus: withdrawn\n```" };
      await run(taro, ...first, plugin("carry on"), ask("scope-approval", "scope-approval?"), withdrawal);
      expect(decisions.map((decision) => [decision.id, decision.status])).toEqual([
        ["naming", "withdrawn"],
        ["scope-approval", "open"],
      ]);
      expect(held()).toEqual([]);
    });

    it("shows the next question when the user answers in the tab and the owner asks it in the same reply", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("start"), ask("naming", "naming?")];
      await run(taro, ...first);
      await run(taro, ...first, human("Call it Notes"), ask("scope-approval", "scope-approval?"));
      expect(decisions.map((decision) => [decision.id, decision.status, decision.answer?.text ?? null])).toEqual([
        ["naming", "answered", "Call it Notes"],
        ["scope-approval", "open", null],
      ]);
      expect(held()).toEqual([]);
    });

    it("counts a held decision and reports its format problems when it is shown, not when it is held", async () => {
      const { state, decisions } = fakeState();
      const count = vi.fn(async () => undefined);
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count } as unknown as Stats, recovery);
      const incomplete = { type: "assistant_message", text: "```decision\nid: scope-approval\nquestion: Approve the plan for TR-9?\noptions:\n  - label: Approve\n    prompt: Approve\n```\n\nwaiting: plan" };
      const corrections = () => vi.mocked(sendFromPlugin).mock.calls.filter(([, , text]) => text.startsWith("decision-correction"));
      const first = [human("start"), ask("naming", "naming?"), incomplete];
      await run(taro, ...first);
      expect(decisions.map((decision) => decision.status)).toEqual(["open", "withdrawn"]);
      expect(count).toHaveBeenCalledTimes(1);
      expect(corrections()).toHaveLength(0);

      await run(taro, ...first, human("Call it Notes"), incomplete);
      expect(decisions.map((decision) => decision.status)).toEqual(["answered", "open"]);
      expect(count).toHaveBeenCalledTimes(2);
      expect(corrections()).toHaveLength(1);
    });

    it("still replaces the open decision when the owner asks it again", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("start"), ask("scope-approval", "Approve v1?")];
      await run(taro, ...first);
      await run(taro, ...first, plugin("revise"), ask("scope-approval", "Approve v2?"));
      expect(decisions.map((decision) => [decision.question, decision.status])).toEqual([["Approve v2?", "open"]]);
      expect(held()).toEqual([]);
    });

    it("leaves the manager free to ask several at once", async () => {
      const manager = { ...owner, id: "manager-1", title: "Taro manager", labels: { "taro.project": "taro", "taro.role": "manager" } };
      vi.mocked(fetchLiveAgent).mockResolvedValue(manager as unknown as PaseoAgent);
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("start"), both("start-TR-1", "start-TR-2"));
      expect(decisions.map((decision) => decision.status)).toEqual(["open", "open"]);
      expect(held()).toEqual([]);
    });
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
    // Marked as gone with its agent, so a new owner is handed it (TR-136).
    expect(decisions.map((decision) => decision.withdrawnWithAgent)).toEqual([true, undefined]);
  });

  it("at start, withdraws the project's decisions of agents Paseo no longer lists, keeping closed ones", async () => {
    // A closed agent is listed (not archived) and resumes when answered; the archived one is not listed.
    vi.mocked(listTaroAgents).mockResolvedValueOnce([{ id: "closed-owner", status: "closed", labels: {} } as unknown as PaseoAgent]);
    const decisions = [stored("archived-owner"), stored("closed-owner"), stored("archived-elsewhere", "other")];
    await supervisorOver(decisions).reconcile({} as PaseoApi, ["taro"]);
    expect(decisions.map((decision) => decision.status)).toEqual(["withdrawn", "open", "open"]);
    expect(decisions.map((decision) => decision.withdrawnWithAgent)).toEqual([true, undefined, undefined]);
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

  it("names a report held from before TR-017, stored with the role `helper`, as an implementer's", async () => {
    const held = { project: "taro", role: "owner", heldReports: [{ fromAgentId: "helper-1", role: "helper", title: "TR-3 · helper: x", ticket: "TR-3", text: "done: built", turnId: "t1" }], compaction: "none" };
    const agents: Record<string, unknown> = { [owner.id]: held };
    const state = {
      agent: async (agentId: string) => agents[agentId] ?? null,
      updateAgent: async <T>(agentId: string, _initial: () => AgentState, change: (record: AgentState) => T) => change(agents[agentId] as AgentState),
    } as unknown as PluginState;
    vi.mocked(sendFromPlugin).mockClear();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    expect(await taro.flushHeldReports({} as PaseoApi, owner.id)).toBe(true);
    expect(vi.mocked(sendFromPlugin).mock.calls.map(([, id, text]) => [id, text])).toEqual([[owner.id, "report:implementer:done: built"]]);
  });
});

describe("Supervisor.onTurnEnded reminds about missing evidence", () => {
  const owner = {
    id: "owner-3",
    provider: "claude",
    model: "sonnet",
    title: "TR-9 · x",
    status: "idle",
    labels: { "taro.project": "taro", "taro.role": "owner", "taro.ticket": "TR-9" },
  };
  const hookAgent = { id: owner.id, parentAgentId: null } as unknown as HookAgent;
  const completed = { kind: "completed" } as unknown as TurnOutcome;
  const waiting = [{ type: "user_message", text: "carry on" }, { type: "assistant_message", text: "waiting: acceptance" }] as unknown as TimelineItem[];
  const recordWith = (...lines: string[]) => ["EVIDENCE 2026-10-13T11:00Z — x", ...lines].join("\n");

  let taro: Supervisor;

  function ticket(status: string, implementationNotes: string | null): void {
    vi.mocked(viewTicket).mockResolvedValue({ status, labels: ["investigation"], implementationNotes } as unknown as Awaited<ReturnType<typeof viewTicket>>);
  }

  async function turn(): Promise<void> {
    await taro.onTurnEnded({} as PaseoApi, hookAgent, completed, waiting, null, undefined);
  }

  function reminders(): string[] {
    return vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("evidence-missing:"));
  }

  beforeEach(() => {
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
    taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner as unknown as PaseoAgent);
    vi.mocked(sendFromPlugin).mockClear();
  });

  it("sends once per distinct missing set, again after it changes, and again after a complete one clears it", async () => {
    ticket("Awaiting acceptance", null);
    await turn();
    await turn();
    expect(reminders()).toEqual(["evidence-missing:TR-9:- an EVIDENCE record"]);

    ticket("Awaiting acceptance", recordWith("review: self"));
    await turn();
    expect(reminders()).toHaveLength(2);
    expect(reminders()[1]).toBe("evidence-missing:TR-9:- a check with its result");
    await turn();
    expect(reminders()).toHaveLength(2);

    ticket("Awaiting acceptance", recordWith("check: grep foo — 2 hits"));
    await turn();
    ticket("Awaiting acceptance", recordWith("review: self"));
    await turn();
    expect(reminders()).toHaveLength(3);
  });

  it("never sends for a complete record or a ticket that is not Awaiting acceptance", async () => {
    ticket("Awaiting acceptance", recordWith("check: grep foo — 2 hits"));
    await turn();
    ticket("In Progress", null);
    await turn();
    ticket("Reviewing", recordWith("review: self"));
    await turn();
    expect(reminders()).toEqual([]);
  });
});

describe("Supervisor.onTurnEnded records the agent's cost (TR-097)", () => {
  const subagent = {
    id: "implementer-1",
    provider: "claude",
    model: "sonnet",
    title: "TR-9.1 · implementer: x",
    status: "idle",
    labels: { "taro.project": "taro", "taro.role": "implementer", "taro.ticket": "TR-9.1" },
  };

  async function endTurn(live: object): Promise<unknown[]> {
    vi.mocked(fetchLiveAgent).mockResolvedValue(live as unknown as PaseoAgent);
    const state = {
      allDecisions: async () => [],
      updateDecisions: async <T>(change: (decisions: never[]) => T) => change([]),
      agent: async () => null,
      updateAgent: async <T>(_agentId: string, initial: () => AgentState, change: (record: AgentState) => T) => change(initial()),
    } as unknown as PluginState;
    const turnEnded = vi.fn(async () => undefined);
    const taro = new Supervisor(state, { turnEnded, count: async () => undefined } as unknown as Stats, recovery);
    await taro.onTurnEnded({} as PaseoApi, { id: subagent.id, parentAgentId: null } as unknown as HookAgent, { kind: "completed" } as unknown as TurnOutcome, items(userTurn, reply), null, 4_000);
    return turnEnded.mock.calls[0] ?? [];
  }

  it("passes Paseo's usage at the turn end, so a subagent archived before Done keeps its cost", async () => {
    const call = await endTurn({ ...subagent, lastUsage: { totalCostUsd: 1.2, contextWindowUsedTokens: 9 } });
    expect(call).toEqual(["taro", "TR-9.1", { id: subagent.id, role: "implementer", model: "claude/sonnet", title: subagent.title }, 4_000, { costUsd: 1.2, contextTokens: 9 }]);
  });

  it("passes an empty reading when Paseo has no usage (after a daemon restart)", async () => {
    const call = await endTurn(subagent);
    expect(call[4]).toEqual({ costUsd: null, contextTokens: null });
  });
});
