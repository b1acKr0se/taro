import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { questionHoldingAccept } from "../shared/delivery-end";
import { AgentStateSchema, type AgentState, type StoredDecision } from "../shared/state";
import { fetchLiveAgent, listTaroAgents } from "./agents";
import type { HookAgent, PaseoAgent, PaseoApi, TimelineItem, TimelinePage, TurnOutcome } from "./host-types";
import { sendFromPlugin } from "./send";
import { runCommand } from "./process";
import { branchName, commitsPast } from "./branch-commits";
import { readProjectConfig } from "./projects";
import { appendTicketNote, endDelivery, viewTicket } from "./tickets";
import { stepTicket } from "./next-step";
import { PluginState as StoredPluginState } from "./state";
import type { StepTicket } from "../shared/next-step";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { allAssistantText, autoCompactedThisTurn, closingText, currentTurn, humanMessages, identityFromLabels, Supervisor, tabMessages, throughTurn, turnEndLine, turnIdentity } from "./supervision";

vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn(), isMidTurn: () => false, listTaroAgents: vi.fn(async () => []) }));
vi.mock("./send", async (original) => ({ ...(await original<typeof import("./send")>()), sendFromPlugin: vi.fn(async () => undefined), sendCommand: vi.fn(async () => undefined) }));
vi.mock("./package-files", () => ({
  TEMPLATES: { reload: "reload", nudge: "nudge", subagentReport: "report", evidenceMissing: "evidence-missing", decisionHeld: "decision-held", acceptQuestionRefused: "accept-question-refused", decisionCorrection: "decision-correction", planningQuestion: "planning-question", deliveryWithOpenQuestion: "delivery-open-question", noPlan: "no-plan", noApproval: "no-approval", approvalRepeated: "approval-repeated", acceptingTooEarly: "accepting-too-early", acceptUnfinished: "accept-unfinished", deliveryMissing: "delivery-missing", planWithoutMockups: "plan-without-mockups", planLint: "plan-lint" },
  skillDirectory: async () => "/skill",
  message: async (path: string, values: Record<string, string> = {}) => (path === "delivery-missing" ? `delivery-missing:${values.ticket}:${values.missing}` : path === "evidence-missing" ? `evidence-missing:${values.ticket}:${values.missing}` : path === "report" ? `report:${values.role}:${values.report}` : path === "accept-question-refused" ? `accept-question-refused:${values.refused}` : path === "decision-held" ? `decision-held:${values.held}:${values.open}` : path === "planning-question" ? `planning-question:${values.question}` : path === "delivery-open-question" ? `delivery-open-question:${values.ticket}:${values.question}` : path === "plan-without-mockups" ? `plan-without-mockups:${values.ticket}:${values.missing}` : path === "plan-lint" ? `plan-lint:${values.ticket}:${values.gaps}` : path === "accept-unfinished" ? `accept-unfinished:${values.ticket}:${values.pullRequest}` : path === "accepting-too-early" ? `accepting-too-early:${values.ticket}:${values.status}:${values.missing}` : path === "no-plan" ? `no-plan:${values.ticket}:${values.branch}:${values.commits}:${values.base}` : path === "no-approval" ? `no-approval:${values.ticket}:${values.branch}:${values.commits}:${values.base}` : path === "approval-repeated" ? `approval-repeated:${values.ticket}:${values.questions}` : `${path}:${values.ticket ?? ""}`),
}));
vi.mock("./projects", () => ({ readProjectConfig: vi.fn(async () => null), projectPaths: async () => ({ tracker: "/tracker" }) }));
vi.mock("./process", async (original) => ({ ...(await original<typeof import("./process")>()), runCommand: vi.fn(async () => ({ code: 0, stdout: '{"state":"OPEN","mergeable":"CONFLICTING"}', stderr: "" })) }));
vi.mock("./branch-commits", () => ({ commitsPast: vi.fn(async () => 0), branchName: vi.fn(async () => "taro/tr-9") }));
vi.mock("./tickets", () => ({ viewTicket: vi.fn(), endDelivery: vi.fn(async () => true), appendTicketNote: vi.fn(async () => undefined) }));
// The step's facts are read from the tracker in ./next-step; in tests that are not about steps the ticket is unrated, so no step.
const UNRATED = { id: "TR-0", status: "Planning", labels: [], notes: null, children: [], baseBranch: "main", deliveryGaps: [] };
vi.mock("./next-step", () => ({
  stepTicket: vi.fn(async () => UNRATED),
  stepText: vi.fn(async (step: { page: string; facts: Record<string, string> }) => `step:${step.page}:round ${step.facts.round}`),
}));

/** Paseo's projected timeline holding `items`, where supervision reads a turn at its end (TR-233: the hook's is empty). */
function withTimeline(items: readonly TimelineItem[]): PaseoApi {
  return { agents: { ref: () => ({ timeline: { refetch: async () => ({ entries: items.map((item) => ({ item })), hasOlder: false, startCursor: null }) } }) } } as unknown as PaseoApi;
}

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

describe("a turn opened by a message another agent sent", () => {
  const received = (text: string) => ({ type: "tool_call", agentMessage: { text, sender: { title: "taro · Manager" } } });
  const plan = (text: string) => ({ type: "assistant_message", text });

  it("starts at the received message and has an identity", () => {
    expect(currentTurn(items(userTurn, reply, received("start"), reply))).toEqual([received("start"), reply]);
    expect(turnIdentity(items(received("start"), plan("plan")))).not.toBeNull();
  });

  it("tells a re-ask in a later turn from the first ask (TR-221)", () => {
    const first = turnIdentity(currentTurn(items(received("start"), plan("approve the plan"))));
    const second = turnIdentity(currentTurn(items(received("start"), plan("approve the plan"), { type: "user_message", text: "changes please" }, plan("approve the plan"))));
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
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
      await taro.onTurnEnded(withTimeline(first), hookAgent, completed, null, undefined);
      expect(reloads()).toBe(1);
      expect(vi.mocked(sendFromPlugin).mock.calls[0]?.[2]).toBe("reload:TR-9");

      // The reload's own turn, and any later one: the compaction is still in the stored timeline.
      await taro.onTurnEnded(withTimeline(items(...first, reloadTurn, reply)), hookAgent, completed, null, undefined);
      await taro.onTurnEnded(withTimeline(items(...first, reloadTurn, reply, userTurn, reply)), hookAgent, completed, null, undefined);
      expect(reloads()).toBe(1);
    });
  }

  it("sends no reload for a manual or still-loading compaction", async () => {
    const taro = supervisor();
    await taro.onTurnEnded(withTimeline(items(userTurn, claudeManual, reply)), hookAgent, completed, null, undefined);
    await taro.onTurnEnded(withTimeline(items(userTurn, codexLoading, reply)), hookAgent, completed, null, undefined);
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
  const manager = { ...owner, id: "manager-1", title: "Taro manager", labels: { "taro.project": "taro", "taro.role": "manager" } };
  // Words typed in a tab answer only the manager's decisions (TR-134).
  const asManager = () => vi.mocked(fetchLiveAgent).mockResolvedValue(manager as unknown as PaseoAgent);
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
    await taro.onTurnEnded(withTimeline(items(...timeline)), hookAgent, completed, null, undefined);
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

  // TR-239: a dismissed question stays closed while the same turn is read again, and is a new question when asked in a later turn.
  it("keeps a dismissal across a replay of the same turn, and shows the question again when asked in a later turn", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [human("start"), ask("naming", "Which name?")];
    await run(taro, ...first);
    decisions[0]!.status = "dismissed";

    await run(taro, ...first);
    expect(decisions.map((decision) => decision.status)).toEqual(["dismissed"]);

    await run(taro, ...first, human("any news?"), ask("naming", "Which name?"));
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

  // TR-221: an owner's first turn opens with a received message; Request changes, then the same ask.
  const received = (text: string) => ({ type: "tool_call", agentMessage: { text, sender: { title: "taro · Manager" } } });

  it("reopens the re-ask after a first turn opened by a received message, and keeps a replay of the first turn quiet", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [received("start"), ask("scope-approval", "Approve the plan for TR-9?")];
    await run(taro, ...first);
    decisions[0]!.status = "answered";
    await run(taro, ...first);
    expect(decisions.map((decision) => decision.status)).toEqual(["answered"]);
    await run(taro, ...first, human("changes please"), reply, ask("scope-approval", "Approve the plan for TR-9?"));
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
  });

  it("reopens a re-ask for a decision stored without a turn when an earlier turn held the same block", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [received("start"), ask("scope-approval", "Approve the plan for TR-9?")];
    await run(taro, ...first);
    decisions[0]!.turn = null;
    decisions[0]!.status = "answered";
    await run(taro, ...first);
    expect(decisions.map((decision) => decision.status)).toEqual(["answered"]);
    await run(taro, ...first, human("changes please"), reply, ask("scope-approval", "Approve the plan for TR-9?"));
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
    asManager();
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [human("hi"), reply];
    const second = [plugin("nudge"), ask("rollout", "Ship it now?")];
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
    await run(taro, plugin("start"), ask("rollout", "Ship it now?"));
    await run(taro, human("hi"), reply, plugin("implementer report"), reply);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
  });

  it("closes an earlier turn's decision when the user answers in the tab, though the block is in the timeline", async () => {
    asManager();
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [plugin("start"), ask("rollout", "Ship it now?")];
    await run(taro, ...first);
    await run(taro, ...first, human("merge it"), reply);
    expect(decisions.map((decision) => decision.status)).toEqual(["answered"]);
  });

  it("keeps a decision open when the user sends a message from a Taro chat beside its card (TR-102, seen end to end)", async () => {
    asManager();
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [plugin("start"), ask("indent-style", "Tabs or spaces?")];
    await run(taro, ...first);
    const fromChat = { type: "user_message", text: "a message sent while the decision is open", clientMessageId: "chat-mv8xqzqs-1kpppuif" };
    await run(taro, ...first, fromChat, reply);
    expect(decisions.map((decision) => [decision.status, decision.answer])).toEqual([["open", null]]);
    // Words typed in the manager's own tab still answer it.
    await run(taro, ...first, fromChat, reply, human("spaces"), reply);
    expect(decisions.map((decision) => [decision.status, decision.answer?.text])).toEqual([["answered", "spaces"]]);
  });

  // TR-134: the manager's `paseo send` reaches an owner as a plain user message, like words typed in its tab.
  it("keeps an owner's open decision through later turns opened by messages, until it is withdrawn", async () => {
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [plugin("start"), ask("scope-approval", "Approve the plan for TR-9?")];
    await run(taro, ...first);
    const fromManager = human("Changes requested on TR-9: also cover the phone");
    const replied = { type: "assistant_message", text: "Noted; I will fold it into the plan.\n\nwaiting: approval of the plan" };
    await run(taro, ...first, fromManager, replied);
    expect(decisions.map((decision) => [decision.status, decision.answer])).toEqual([["open", null]]);
    await run(taro, ...first, fromManager, replied, human("New standing order from the user: keep commits small"), reply);
    expect(decisions.map((decision) => [decision.status, decision.answer])).toEqual([["open", null]]);

    const withdrawal = { type: "assistant_message", text: "```decision\nid: scope-approval\nstatus: withdrawn\n```\n\nwaiting: the user" };
    await run(taro, ...first, fromManager, replied, human("drop it"), withdrawal);
    expect(decisions.map((decision) => decision.status)).toEqual(["withdrawn"]);
  });

  it("keeps an implementer's open decision when its owner messages it", async () => {
    vi.mocked(fetchLiveAgent).mockResolvedValue({ ...owner, id: "implementer-1", labels: { "taro.project": "taro", "taro.role": "implementer", "taro.ticket": "TR-9" } } as unknown as PaseoAgent);
    const { state, decisions } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const first = [plugin("start"), ask("schema", "Add a column?")];
    await run(taro, ...first);
    await run(taro, ...first, human("Use the existing table"), reply);
    expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
  });

  // TR-200: the delivery's Accept card is the only Accept.
  describe("a question that asks to accept or merge", () => {
    const refusals = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("accept-question-refused:"));

    it("is not shown to the user, and the owner is told to deliver instead", async () => {
      vi.mocked(sendFromPlugin).mockClear();
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("start"), ask("accept-tr-9", "Accept TR-9 and merge PR #88?"));
      expect(decisions).toEqual([]);
      expect(refusals()).toHaveLength(1);
    });
  });

  // TR-235: a plan approval comes with its mockups, or says there is no UI change.
  describe("plan mockups", () => {
    const withPlan = (plan: string | null) => vi.mocked(viewTicket).mockResolvedValue({ status: "Planning", implementationPlan: plan, implementationNotes: "" } as unknown as Awaited<ReturnType<typeof viewTicket>>);
    const told = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("plan-without-mockups:"));

    beforeEach(() => {
      vi.mocked(sendFromPlugin).mockClear();
    });
    afterEach(() => {
      vi.mocked(viewTicket).mockReset();
    });

    it("holds a scope-approval whose plan has no Mockups section, and tells the owner what is missing", async () => {
      withPlan("## Goal\nG\n## Size\nS");
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(decisions.map((decision) => [decision.id, decision.status, decision.held])).toEqual([["scope-approval", "withdrawn", true]]);
      expect(told()).toHaveLength(1);
      expect(told()[0]).toContain("a Mockups section");
    });

    it("holds one that names a mockup file that is not in the evidence folder", async () => {
      withPlan("## Goal\nG\n## Mockups\n- mockup-board-phone.png — a badge\n## Size\nS");
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(decisions[0]?.status).toBe("withdrawn");
      expect(told()[0]).toContain("mockup file mockup-board-phone.png");
    });

    it("shows one whose plan says there is no UI change, and any other decision regardless", async () => {
      withPlan("## Goal\nG\n## Mockups\n- none — skill text only\n## Size\nS");
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
      expect(told()).toEqual([]);

      withPlan("## Goal\nG\n## Size\nS");
      const other = fakeState();
      await run(new Supervisor(other.state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery), human("start"), ask("naming", "naming?"));
      expect(other.decisions.map((decision) => decision.status)).toEqual(["open"]);
    });

    it("opens the approval asked again in a later turn once the plan is complete, with no second message; the held turn read again says nothing more", async () => {
      withPlan("## Goal\nG\n## Size\nS");
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("start"), ask("scope-approval", "Approve the plan for TR-9?")];
      await run(taro, ...first);
      await run(taro, ...first);
      expect(decisions.map((decision) => decision.status)).toEqual(["withdrawn"]);
      expect(told()).toHaveLength(1);

      withPlan("## Goal\nG\n## Mockups\n- none — wording only\n## Size\nS");
      await run(taro, ...first, plugin("the plan is complete now"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(decisions.map((decision) => [decision.status, decision.held])).toEqual([["open", undefined]]);
      expect(told()).toHaveLength(1);
    });

    it("shows the approval when the ticket cannot be read", async () => {
      vi.mocked(viewTicket).mockRejectedValue(new Error("tracker busy"));
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
      expect(told()).toEqual([]);
    });

    it("leaves a plan in no template shape alone", async () => {
      withPlan("Just do it, free-form.");
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
    });
  });

  // TR-263: a high plan's approval waits for its children's specs and a plan review.
  describe("plan lint", () => {
    const PLAN = "## Goal\nG\n## Mockups\n- none — text only\n## Parts\n- TR-9.01 — writer — S — depends on: none\n## Size\nHigh";
    const CHILD = "## Owns\n- `server/a.ts`\n## Interfaces\n- none — internal\n## Tests required\n- `a`: 1 → 2";
    const REVIEWED = "REVIEW 2026-11-12T10:20Z — plan review by reviewer-1: fixed one gap — verdict: clean";
    const tickets = (parent: { labels?: string[]; notes?: string; children?: string[] }) =>
      vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => {
        const children = parent.children ?? [];
        if (id === "TR-9") return { id, status: "Planning", labels: parent.labels ?? ["complexity-high"], implementationPlan: PLAN, implementationNotes: parent.notes ?? "", planUpdatedAt: "2026-11-12T10:05:00Z", subtasks: children.map((child) => ({ id: child, title: "writer", status: "Queued" })) } as unknown as Awaited<ReturnType<typeof viewTicket>>;
        if (children.includes(id)) return { id, status: "Queued", labels: [], dependencies: [], description: CHILD } as unknown as Awaited<ReturnType<typeof viewTicket>>;
        throw new Error(`no ticket ${id}`);
      });
    const told = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("plan-lint:") || text.startsWith("plan-without-mockups:"));
    const supervisor = (state: PluginState) => new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);

    beforeEach(() => {
      vi.mocked(sendFromPlugin).mockClear();
    });
    afterEach(() => {
      vi.mocked(viewTicket).mockReset();
    });

    it("holds a high plan's approval while a child is missing and no plan review was recorded, naming each gap once", async () => {
      tickets({});
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const turn = [human("start"), ask("scope-approval", "Approve the plan for TR-9?")];
      await run(taro, ...turn);
      await run(taro, ...turn);
      expect(decisions.map((decision) => [decision.id, decision.status, decision.held])).toEqual([["scope-approval", "withdrawn", true]]);
      expect(told()).toHaveLength(1);
      expect(told()[0]).toMatch(/^plan-lint:TR-9:- child ticket TR-9\.01, named in Parts .*\n- a plan review: /);
    });

    it("shows it once the child exists and a plan review is newer than the plan's last edit", async () => {
      tickets({ children: ["TR-9.01"] });
      const held = fakeState();
      await run(supervisor(held.state), human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(held.decisions.map((decision) => decision.status)).toEqual(["withdrawn"]);
      expect(told()).toEqual([expect.stringMatching(/^plan-lint:TR-9:- a plan review: [^\n]*$/)]);

      vi.mocked(sendFromPlugin).mockClear();
      tickets({ children: ["TR-9.01"], notes: REVIEWED });
      const shown = fakeState();
      await run(supervisor(shown.state), human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(shown.decisions.map((decision) => decision.status)).toEqual(["open"]);
      expect(told()).toEqual([]);
    });

    it("leaves a medium plan, and any other question of a high owner, alone", async () => {
      tickets({ labels: ["complexity-medium"] });
      const medium = fakeState();
      await run(supervisor(medium.state), human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(medium.decisions.map((decision) => decision.status)).toEqual(["open"]);

      tickets({});
      const other = fakeState();
      await run(supervisor(other.state), human("start"), ask("naming", "naming?"));
      expect(other.decisions.map((decision) => decision.status)).toEqual(["open"]);
      expect(told()).toEqual([]);
    });
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

    it("holds the next question when the user answers in words, until the owner withdraws the open one (TR-134)", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("start"), ask("naming", "naming?")];
      await run(taro, ...first);
      await run(taro, ...first, human("Call it Notes"), ask("scope-approval", "scope-approval?"));
      expect(decisions.map((decision) => [decision.id, decision.status])).toEqual([
        ["naming", "open"],
        ["scope-approval", "withdrawn"],
      ]);
      expect(held()).toHaveLength(1);

      const withdrawal = { type: "assistant_message", text: "```decision\nid: naming\nstatus: withdrawn\n```" };
      await run(taro, ...first, human("Call it Notes"), withdrawal, ask("scope-approval", "scope-approval?"));
      expect(decisions.map((decision) => [decision.id, decision.status])).toEqual([
        ["naming", "withdrawn"],
        ["scope-approval", "open"],
      ]);
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

      decisions[0]!.status = "answered";
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
      asManager();
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("start"), both("start-TR-1", "start-TR-2"));
      expect(decisions.map((decision) => decision.status)).toEqual(["open", "open"]);
      expect(held()).toEqual([]);
    });
  });

  // TR-146: every question an owner asks before its plan is approved waits for the user.
  describe("a question asked while the ticket is planning", () => {
    const lightly = (id: string, status = "waiting") => ({ type: "assistant_message", text: (ask(id, `${id}?`) as { text: string }).text.replace("blocking: true", "blocking: false").replace(/waiting: .*$/, `${status}: ${id}`) });
    const told = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("planning-question:"));
    const ticket = (status: string, implementationNotes: string | null) =>
      vi.mocked(viewTicket).mockResolvedValue({ status, implementationNotes } as unknown as Awaited<ReturnType<typeof viewTicket>>);
    const supervisor = (state: PluginState) => new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);

    beforeEach(() => {
      vi.mocked(sendFromPlugin).mockClear();
      vi.mocked(viewTicket).mockReset();
    });

    afterEach(() => {
      vi.mocked(viewTicket).mockReset();
    });

    it("stores a non-blocking question as blocking before APPROVAL, and tells an owner that went on", async () => {
      ticket("Planning", "MILESTONE 2026-10-16T02:40Z — oriented");
      const { state, decisions } = fakeState();
      await run(supervisor(state), human("start"), lightly("naming", "working"));
      expect(decisions.map((decision) => [decision.id, decision.status, decision.blocking, decision.madeBlocking])).toEqual([["naming", "open", true, true]]);
      expect(told()).toEqual(["planning-question:`naming`"]);
    });

    it("says nothing to an owner that already stopped, nor when the same turn is seen again", async () => {
      ticket("Queued", null);
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const first = [human("start"), lightly("naming")];
      await run(taro, ...first);
      await run(taro, ...first);
      expect(decisions.map((decision) => [decision.status, decision.blocking])).toEqual([["open", true]]);
      expect(told()).toEqual([]);
    });

    it("keeps the question answered when its turn is seen again after approval", async () => {
      ticket("Planning", null);
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const first = [human("start"), lightly("naming")];
      await run(taro, ...first);
      decisions[0]!.status = "answered";
      decisions[0]!.turn = null;
      ticket("In Progress", "APPROVAL 2026-10-16T02:45Z — Approve");
      await run(taro, ...first);
      expect(decisions.map((decision) => decision.status)).toEqual(["answered"]);
    });

    it("keeps an open planning question blocking when its turn is seen again and the ticket no longer reads as planning", async () => {
      ticket("Planning", null);
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const first = [human("start"), lightly("naming")];
      await run(taro, ...first);
      vi.mocked(viewTicket).mockRejectedValue(new Error("tracker locked"));
      await run(taro, ...first);
      ticket("In Progress", "APPROVAL 2026-10-16T02:45Z — Approve");
      await run(taro, ...first);
      expect(decisions.map((decision) => [decision.status, decision.blocking, decision.madeBlocking])).toEqual([["open", true, true]]);
    });

    it("leaves the flag as asked after APPROVAL, once building, or when the ticket cannot be read", async () => {
      for (const [status, notes] of [["Planning", "APPROVAL 2026-10-16T02:45Z — Approve"], ["In Progress", null]] as const) {
        ticket(status, notes);
        const { state, decisions } = fakeState();
        await run(supervisor(state), human("start"), lightly("tone", "working"));
        expect(decisions.map((decision) => [decision.blocking, decision.madeBlocking])).toEqual([[false, undefined]]);
      }
      vi.mocked(viewTicket).mockRejectedValue(new Error("tracker locked"));
      const { state, decisions } = fakeState();
      await run(supervisor(state), human("start"), lightly("tone", "working"));
      expect(decisions.map((decision) => decision.blocking)).toEqual([false]);
      expect(told()).toEqual([]);
    });

    it("leaves the manager's and a subagent's questions as asked, and reads no ticket for them", async () => {
      ticket("Planning", null);
      asManager();
      const managed = fakeState();
      await run(supervisor(managed.state), human("start"), lightly("start-TR-1", "working"));
      vi.mocked(fetchLiveAgent).mockResolvedValue({ ...owner, id: "implementer-1", labels: { "taro.project": "taro", "taro.role": "implementer", "taro.ticket": "TR-9" } } as unknown as PaseoAgent);
      const implementing = fakeState();
      await run(supervisor(implementing.state), human("start"), lightly("schema", "working"));
      expect([...managed.decisions, ...implementing.decisions].map((decision) => decision.blocking)).toEqual([false, false]);
      expect(viewTicket).not.toHaveBeenCalled();
    });
  });

  // TR-263: after the round's approval the owner decides; it asks only with a `surprise:`.
  describe("a question asked after the plan's approval", () => {
    const PLAN = "## Goal\nG\n## Mockups\n- none — wording only\n## Size\nS";
    const APPROVED = 'ANSWER 2026-01-05T10:05Z — scope-approval: "Approve the plan for TR-9?" → Approve ("Approve the plan for TR-9") (the user, from the Taro screen)';
    const withTicket = (notes: string | null, status = "In Progress") => vi.mocked(viewTicket).mockResolvedValue({ status, implementationPlan: PLAN, implementationNotes: notes } as unknown as Awaited<ReturnType<typeof viewTicket>>);
    const extra = (block: object, lines: string) => ({ ...block, text: (block as { text: string }).text.replace("\nrecommended:", `\n${lines}\nrecommended:`) });
    const lightly = (block: object) => ({ ...block, text: (block as { text: string }).text.replace("blocking: true", "blocking: false") });
    const gated = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("approval-repeated:"));
    const records = () => vi.mocked(appendTicketNote).mock.calls.map(([, , record]) => record);
    const supervisor = (state: PluginState) => new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const shown = (decisions: StoredDecision[]) => decisions.map((decision) => [decision.id, decision.status, decision.blocking, decision.madeNonBlocking]);

    beforeEach(() => {
      vi.mocked(sendFromPlugin).mockClear();
      vi.mocked(appendTicketNote).mockClear();
      vi.mocked(viewTicket).mockReset();
      // No delivery on offer: an open question is not taken back as at delivery (TR-146).
      vi.mocked(endDelivery).mockResolvedValue(false);
    });
    afterEach(() => {
      vi.mocked(viewTicket).mockReset();
      vi.mocked(endDelivery).mockResolvedValue(true);
    });

    it("does not show a second scope-approval: the answered one stays, the owner is told to build on, and the ticket and log say so", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      withTicket(null, "Planning");
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const first = [human("start"), ask("scope-approval", "Approve the plan for TR-9?")];
      await run(taro, ...first);
      decisions[0]!.status = "answered";
      withTicket(APPROVED);
      // The answered ask's own turn read again is not a second ask.
      await run(taro, ...first);
      expect(gated()).toEqual([]);

      await run(taro, ...first, plugin("go on"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(shown(decisions)).toEqual([["scope-approval", "answered", true, undefined]]);
      expect(gated()).toEqual(["approval-repeated:TR-9:- `scope-approval`: not shown; the plan stays approved"]);
      expect(records()).toHaveLength(1);
      expect(records()[0]).toMatch(/^APPROVAL-REPEATED \S+ — `scope-approval` asked again after the plan was approved, with no surprise: not shown/);
      expect(log.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("after its plan was approved"))).toEqual(["[taro] owner-2 asked `scope-approval` on TR-9 after its plan was approved, with no surprise: refused, not shown"]);
      log.mockRestore();
    });

    it("refuses one ask once, though its turn is read again (the reconcile after a start reads what the hook read)", async () => {
      withTicket(APPROVED);
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const asked = [human("start"), ask("scope-approval", "Approve the plan for TR-9?")];
      await Promise.all([run(taro, ...asked), run(taro, ...asked)]);
      await run(taro, ...asked);
      expect(decisions).toEqual([]);
      expect(gated()).toHaveLength(1);
      expect(records()).toHaveLength(1);

      // Asked again in a later turn: refused again.
      await run(taro, ...asked, plugin("build on"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(gated()).toHaveLength(2);
    });

    it("shows a scope-approval asked again with a surprise or before approval; a Request changes on a surprise re-ask keeps the round approved", async () => {
      withTicket(APPROVED);
      const surprised = fakeState();
      await run(supervisor(surprised.state), human("start"), extra(ask("scope-approval", "Approve the plan for TR-9?"), "surprise: Out of scope says no import, and the fix needs one"));
      expect(shown(surprised.decisions)).toEqual([["scope-approval", "open", true, undefined]]);
      expect(surprised.decisions[0]?.surprise).toBe("Out of scope says no import, and the fix needs one");

      withTicket(`${APPROVED}\n\nANSWER 2026-01-05T11:00Z — scope-approval: "Approve the plan for TR-9?" → Request changes ("no import") (the user, from the Taro screen)`);
      const changed = fakeState();
      await run(supervisor(changed.state), human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(changed.decisions).toEqual([]);
      expect(gated()).toEqual(["approval-repeated:TR-9:- `scope-approval`: not shown; the plan stays approved"]);

      withTicket(null, "Planning");
      const first = fakeState();
      await run(supervisor(first.state), human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(shown(first.decisions)).toEqual([["scope-approval", "open", true, undefined]]);
      expect(gated()).toHaveLength(1);
    });

    it("shows it again in a reopened round, which needs its own approval", async () => {
      withTicket(`${APPROVED}\n\nREOPENED 2026-01-06T09:00Z — user: "check the release"; round 2; past owners: none`);
      const { state, decisions } = fakeState();
      await run(supervisor(state), human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(shown(decisions)).toEqual([["scope-approval", "open", true, undefined]]);
    });

    it("refuses a child's scope-approval when its parent is approved, and shows it when the parent is not", async () => {
      vi.mocked(fetchLiveAgent).mockResolvedValue({ ...owner, labels: { ...owner.labels, "taro.ticket": "TR-9.01" } } as unknown as PaseoAgent);
      vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => ({ status: "Planning", implementationPlan: PLAN, implementationNotes: id === "TR-9" ? APPROVED : null }) as unknown as Awaited<ReturnType<typeof viewTicket>>);
      const refused = fakeState();
      await run(supervisor(refused.state), human("start"), ask("scope-approval", "Approve the plan for TR-9.01?"));
      expect(refused.decisions).toEqual([]);
      expect(gated()).toEqual(["approval-repeated:TR-9.01:- `scope-approval`: not shown; the plan stays approved"]);

      vi.mocked(viewTicket).mockImplementation(async () => ({ status: "Planning", implementationPlan: PLAN, implementationNotes: null }) as unknown as Awaited<ReturnType<typeof viewTicket>>);
      const asked = fakeState();
      await run(supervisor(asked.state), human("start"), ask("scope-approval", "Approve the plan for TR-9.01?"));
      expect(shown(asked.decisions)).toEqual([["scope-approval", "open", true, undefined]]);
      expect(gated()).toHaveLength(1);
    });

    it("shows a blocking question with a default as not blocking, says so to the owner once, and keeps it so when re-asked with the same id", async () => {
      withTicket(APPROVED);
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const first = [human("start"), extra(ask("naming", "Call it Export or Save as?"), "default: Yes")];
      await run(taro, ...first);
      expect(shown(decisions)).toEqual([["naming", "open", false, true]]);
      expect(gated()).toEqual(['approval-repeated:TR-9:- `naming`: shown not blocking; go on with its default "Yes"']);
      expect(records()).toHaveLength(1);
      expect(records()[0]).toMatch(/^BLOCKING-AFTER-APPROVAL \S+ — `naming` asked blocking after approval, with no surprise: shown not blocking, the owner going on with "Yes"$/);

      await run(taro, ...first);
      await run(taro, ...first, plugin("go on"), extra(ask("naming", "Call it Export or Save as?"), "default: Yes"));
      expect(shown(decisions)).toEqual([["naming", "open", false, true]]);
      expect(gated()).toHaveLength(1);

      // Answered, then asked again in a later turn: a new ask, told again.
      decisions[0]!.status = "answered";
      await run(taro, ...first, plugin("go on"), extra(ask("naming", "Call it Export or Save as?"), "default: Yes"), plugin("more"), extra(ask("naming", "Call it Export or Save as?"), "default: Yes"));
      expect(shown(decisions)).toEqual([["naming", "open", false, true]]);
      expect(gated()).toHaveLength(2);
    });

    it("holds a blocking question with no default, and shows one with a surprise as blocking", async () => {
      withTicket(APPROVED);
      const held = fakeState();
      await run(supervisor(held.state), human("start"), ask("naming", "Call it Export?"));
      expect(shown(held.decisions)).toEqual([["naming", "withdrawn", true, undefined]]);
      expect(held.decisions[0]?.held).toBeUndefined();
      expect(gated()).toEqual(["approval-repeated:TR-9:- `naming`: not shown, as it has no `default`"]);
      expect(records()[0]).toMatch(/^BLOCKING-AFTER-APPROVAL \S+ — `naming` asked blocking after approval, with no surprise and no default: not shown$/);

      const surprised = fakeState();
      await run(supervisor(surprised.state), human("start"), extra(ask("storage", "Store per trade?"), "surprise: criterion 2 promises hourly totals"));
      expect(shown(surprised.decisions)).toEqual([["storage", "open", true, undefined]]);
      expect(gated()).toHaveLength(1);
    });

    it("shows a surprise question blocking, not held, behind one the owner went on with by default", async () => {
      const heldMessages = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("decision-held:"));
      withTicket(APPROVED);
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const first = [human("start"), extra(ask("naming", "Call it Export or Save as?"), "default: Yes")];
      await run(taro, ...first);
      const second = [plugin("go on"), extra(ask("storage", "Store per trade?"), "surprise: criterion 2 promises hourly totals")];
      await run(taro, ...first, ...second);
      expect(shown(decisions)).toEqual([
        ["naming", "open", false, true],
        ["storage", "open", true, undefined],
      ]);
      expect(decisions[1]?.held).toBeUndefined();
      expect(heldMessages()).toEqual([]);
    });

    it("goes on with the default of a second question asked behind a defaulted one, rather than holding it", async () => {
      const heldMessages = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("decision-held:"));
      withTicket(APPROVED);
      const first = [human("start"), extra(ask("naming", "Call it Export or Save as?"), "default: Yes")];
      const third = [plugin("more"), extra(ask("tone", "Formal tone?"), "default: Yes")];
      const other = fakeState();
      const otherTaro = supervisor(other.state);
      await run(otherTaro, ...first);
      await run(otherTaro, ...first, ...third);
      expect(shown(other.decisions)).toEqual([
        ["naming", "open", false, true],
        ["tone", "open", false, true],
      ]);
      expect(other.decisions[1]?.held).toBeUndefined();
      expect(heldMessages()).toEqual([]);
    });

    it("still holds the next question behind an open one before approval (TR-124)", async () => {
      const heldMessages = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("decision-held:"));
      withTicket(null, "Planning");
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const first = [human("start"), extra(ask("naming", "Call it Export or Save as?"), "default: Yes")];
      await run(taro, ...first);
      await run(taro, ...first, plugin("go on"), extra(ask("storage", "Store per trade?"), "default: Yes"));
      expect(decisions.map((decision) => [decision.id, decision.status, decision.held])).toEqual([
        ["naming", "open", undefined],
        ["storage", "withdrawn", true],
      ]);
      expect(heldMessages()).toEqual(["decision-held:`storage`:naming"]);
    });

    it("leaves a non-blocking question and the investigation's delivery question as asked", async () => {
      withTicket(APPROVED);
      const { state, decisions } = fakeState();
      await run(supervisor(state), human("start"), lightly(extra(ask("tone", "tone?"), "default: Yes")));
      const delivering = fakeState();
      await run(supervisor(delivering.state), human("start"), ask("investigation-done", "Findings are in: what next?"));
      expect([...shown(decisions), ...shown(delivering.decisions)]).toEqual([
        ["tone", "open", false, undefined],
        ["investigation-done", "open", true, undefined],
      ]);
      expect(gated()).toEqual([]);
    });

    it("before approval changes nothing: blocking stays blocking, and a planning question is still made blocking (TR-146)", async () => {
      withTicket("MILESTONE 2026-01-05T10:00Z — oriented", "Planning");
      const { state, decisions } = fakeState();
      await run(supervisor(state), human("start"), ask("naming", "naming?"));
      const light = fakeState();
      await run(supervisor(light.state), human("start"), lightly(ask("tone", "tone?")));
      expect([...shown(decisions), ...shown(light.decisions)]).toEqual([
        ["naming", "open", true, undefined],
        ["tone", "open", true, undefined],
      ]);
      expect(light.decisions[0]?.madeBlocking).toBe(true);
      expect(gated()).toEqual([]);
    });

    it("does not make a question blocking once the plan is approved on its card, though the ticket still reads Planning", async () => {
      withTicket(APPROVED, "Planning");
      const { state, decisions } = fakeState();
      await run(supervisor(state), human("start"), lightly(extra(ask("tone", "tone?"), "default: Yes")));
      expect(shown(decisions)).toEqual([["tone", "open", false, undefined]]);
    });

    // Review blocker: a question the owner went on with by default is its call; it must not hold the delivery.
    it("closes a question gone on with by default as the owner delivers: the delivery stays, Accept is not held", async () => {
      withTicket(APPROVED);
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const first = [human("start"), extra(ask("naming", "Call it Export or Save as?"), "default: Yes")];
      await run(taro, ...first);
      expect(shown(decisions)).toEqual([["naming", "open", false, true]]);
      expect(questionHoldingAccept(decisions)).toBeNull();

      // The owner delivers in a later turn, the defaulted question still open.
      vi.mocked(endDelivery).mockClear();
      vi.mocked(endDelivery).mockResolvedValue(true);
      withTicket(APPROVED, "Awaiting acceptance");
      await run(taro, ...first, plugin("go on"), reply);
      expect(endDelivery).not.toHaveBeenCalled();
      expect(vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("delivery-open-question:"))).toEqual([]);
      expect(decisions.map((decision) => [decision.id, decision.status, decision.closedWithDefault])).toEqual([["naming", "withdrawn", true]]);
    });

    it("still takes back a delivery made with an ordinary question open after approval", async () => {
      withTicket(APPROVED);
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const first = [human("start"), lightly(extra(ask("tone", "tone?"), "default: Yes"))];
      await run(taro, ...first);
      vi.mocked(endDelivery).mockClear();
      vi.mocked(endDelivery).mockResolvedValue(true);
      withTicket(APPROVED, "Awaiting acceptance");
      await run(taro, ...first, plugin("go on"), reply);
      expect(vi.mocked(endDelivery).mock.calls.map(([, , record]) => record.replace(/^DELIVERY-ENDED \S+/, "DELIVERY-ENDED <at>"))).toEqual([
        "DELIVERY-ENDED <at> — the owner delivered with `tone` still open: back to In Progress until it is answered and the owner delivers again",
      ]);
      expect(decisions.map((decision) => [decision.id, decision.status, decision.closedWithDefault])).toEqual([["tone", "open", undefined]]);
    });

    it("keeps a defaulted question open while the delivery is not on offer", async () => {
      withTicket(APPROVED);
      const { state, decisions } = fakeState();
      const taro = supervisor(state);
      const first = [human("start"), extra(ask("naming", "Call it Export or Save as?"), "default: Yes")];
      await run(taro, ...first);
      await run(taro, ...first, plugin("go on"), reply);
      expect(decisions.map((decision) => [decision.id, decision.status, decision.closedWithDefault])).toEqual([["naming", "open", undefined]]);
    });

    it("leaves every question as asked when the ticket cannot be read", async () => {
      vi.mocked(viewTicket).mockRejectedValue(new Error("tracker locked"));
      const { state, decisions } = fakeState();
      await run(supervisor(state), human("start"), ask("scope-approval", "Approve the plan for TR-9?"));
      expect(shown(decisions)).toEqual([["scope-approval", "open", true, undefined]]);
      expect(gated()).toEqual([]);
    });
  });

  // TR-130: an owner asking back while awaiting acceptance went back to work; the delivery ends.
  describe("a question asked while awaiting acceptance", () => {
    const lightly = (id: string) => ({ type: "assistant_message", text: (ask(id, `${id}?`) as { text: string }).text.replace("blocking: true", "blocking: false") });
    const takenBack = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("delivery-open-question:"));
    // The tracker writes only while the delivery is on offer, as endDelivery checks under its lock.
    let onOffer = true;
    let endings: string[][] = [];
    const ended = () => endings;

    beforeEach(() => {
      onOffer = true;
      endings = [];
      vi.mocked(sendFromPlugin).mockClear();
      vi.mocked(endDelivery).mockReset();
      vi.mocked(endDelivery).mockImplementation(async (tracker, ticket, record) => {
        if (!onOffer) return false;
        onOffer = false;
        endings.push([tracker, ticket, record.replace(/^DELIVERY-ENDED \S+/, "DELIVERY-ENDED <at>")]);
        return true;
      });
    });

    afterEach(() => {
      vi.mocked(endDelivery).mockReset();
      vi.mocked(endDelivery).mockImplementation(async () => true);
    });

    it("ends the owner's delivery when it opens a blocking question", async () => {
      const { state } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("why the rename?"), ask("rename-scope", "Rename the settings too?"));
      expect(ended()).toEqual([["/tracker", "TR-9", "DELIVERY-ENDED <at> — the owner asked `rename-scope` while awaiting acceptance: back to In Progress until it delivers again"]]);
    });

    it("ends it once: the same turn seen again, or the question still open, asks nothing new", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("why?"), ask("rename-scope", "Rename?")];
      await run(taro, ...first);
      await run(taro, ...first);
      await run(taro, ...first, plugin("carry on"), ask("rename-scope", "Rename?"));
      expect(ended()).toHaveLength(1);

      // Asked again after its answer: open anew, so it ends the delivery the owner made since.
      decisions[0]!.status = "answered";
      onOffer = true;
      await run(taro, ...first, plugin("carry on"), ask("rename-scope", "Rename?"), plugin("more"), ask("rename-scope", "Rename?"));
      expect(ended()).toHaveLength(2);
    });

    // TR-146: the user answers every question before Accept.
    it("takes back a delivery made with a non-blocking question still open, shows it blocking, and tells the owner once", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("start"), lightly("tone")];
      await run(taro, ...first);
      expect(ended()).toEqual([["/tracker", "TR-9", "DELIVERY-ENDED <at> — the owner delivered with `tone` still open: back to In Progress until it is answered and the owner delivers again"]]);
      expect(takenBack()).toEqual(["delivery-open-question:TR-9:`tone`"]);
      expect(decisions.map((decision) => [decision.status, decision.blocking, decision.madeBlocking])).toEqual([["open", true, true]]);
      // The same turn seen again keeps it blocking; back in In Progress, nothing is written or said again.
      await run(taro, ...first);
      await run(taro, ...first, plugin("carry on"), reply);
      expect(decisions.map((decision) => [decision.status, decision.blocking, decision.madeBlocking])).toEqual([["open", true, true]]);
      expect(ended()).toHaveLength(1);
      expect(takenBack()).toHaveLength(1);
    });

    it("takes back a delivery made while an earlier turn's question is still open, but not once it is answered", async () => {
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      onOffer = false;
      const first = [human("start"), lightly("tone")];
      await run(taro, ...first);
      // The owner delivers in a later turn, the question still open.
      onOffer = true;
      await run(taro, ...first, plugin("carry on"), reply);
      expect(ended()).toHaveLength(1);
      expect(takenBack()).toHaveLength(1);

      decisions[0]!.status = "answered";
      onOffer = true;
      await run(taro, ...first, plugin("Use the warm tone"), reply);
      expect(ended()).toHaveLength(1);
    });

    it("leaves the delivery for investigation-done or a held-back question", async () => {
      const other = fakeState();
      const investigating = new Supervisor(other.state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      const first = [human("start"), ask("investigation-done", "Build the recommendation?")];
      await run(investigating, ...first);
      expect(ended()).toEqual([]);
      // Held back behind the open one (TR-124): not shown, so nothing ends.
      await run(investigating, ...first, plugin("carry on"), ask("follow-up", "File a follow-up?"));
      expect(other.decisions.map((decision) => [decision.id, decision.status])).toEqual([
        ["investigation-done", "open"],
        ["follow-up", "withdrawn"],
      ]);
      expect(ended()).toEqual([]);
    });

    it("never ends a delivery for the manager's questions", async () => {
      asManager();
      const { state } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("start"), ask("start-TR-1", "Start TR-1?"));
      expect(ended()).toEqual([]);
    });

    it("keeps the turn going when the write fails", async () => {
      vi.mocked(endDelivery).mockRejectedValueOnce(new Error("tracker locked"));
      const { state, decisions } = fakeState();
      const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
      await run(taro, human("why?"), ask("rename-scope", "Rename?"));
      expect(decisions.map((decision) => decision.status)).toEqual(["open"]);
    });
  });

  it("takes the status line from this turn only, not an earlier turn's closing message", async () => {
    const { state, agents } = fakeState();
    const taro = new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
    const failed = { kind: "failed" } as unknown as TurnOutcome;
    await taro.onTurnEnded(withTimeline(items(human("go"), reply, human("again"), { type: "tool_call", callId: "c2", name: "shell", status: "failed" })), hookAgent, failed, null, undefined);
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
    await taro.onTurnEnded(withTimeline(items(userTurn, reply)), hookAgent, failed(crash), null, undefined);
    expect(vi.mocked(recovery.onCrash).mock.calls.map(([, agent, identity, error]) => [agent.id, identity.role, error])).toEqual([[manager.id, "manager", crash]]);
    expect(sendFromPlugin).not.toHaveBeenCalled();
  });

  it("leaves other failures to the existing handling", async () => {
    const taro = new Supervisor(fakeState(), stats, recovery);
    await taro.onTurnEnded(withTimeline(items(userTurn, reply)), hookAgent, failed("API Error: 529 overloaded"), null, undefined);
    await taro.onTurnEnded(withTimeline(items(userTurn, reply)), hookAgent, { kind: "completed" } as unknown as TurnOutcome, null, undefined);
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
    await supervisor().onTurnEnded(withTimeline(items(userTurn, reply)), { id: agent.id, parentAgentId: owner.id } as unknown as HookAgent, { kind: "completed" } as unknown as TurnOutcome, null, undefined);
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
    await taro.onTurnEnded(withTimeline(waiting), hookAgent, completed, null, undefined);
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

  it("asks a trivial or low owner for its missing plan at delivery, and not once the plan is written (TR-241)", async () => {
    const delivered = (plan: string | null) =>
      vi.mocked(viewTicket).mockResolvedValue({ status: "Awaiting acceptance", labels: ["investigation", "complexity-low"], implementationPlan: plan, acceptanceCriteria: [], implementationNotes: recordWith("check: grep foo — 2 hits") } as unknown as Awaited<ReturnType<typeof viewTicket>>);
    delivered(null);
    await turn();
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]).toContain("the plan: write it with `taro ticket edit --plan`");
    delivered("## Goal\nFix it");
    await turn();
    expect(reminders()).toHaveLength(1);
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
    await taro.onTurnEnded(withTimeline(items(userTurn, reply)), { id: subagent.id, parentAgentId: null } as unknown as HookAgent, { kind: "completed" } as unknown as TurnOutcome, null, 4_000);
    return turnEnded.mock.calls[0] ?? [];
  }

  it("passes Paseo's usage at the turn end, so a subagent archived before Done keeps its cost", async () => {
    const call = await endTurn({ ...subagent, lastUsage: { totalCostUsd: 1.2, contextWindowUsedTokens: 9, contextWindowMaxTokens: 200_000 } });
    expect(call).toEqual(["taro", "TR-9.1", { id: subagent.id, role: "implementer", model: "claude/sonnet", title: subagent.title }, 4_000, { costUsd: 1.2, contextTokens: 9, contextMaxTokens: 200_000 }]);
  });

  it("passes an empty reading when Paseo has no usage (after a daemon restart)", async () => {
    const call = await endTurn(subagent);
    expect(call[4]).toEqual({ costUsd: null, contextTokens: null, contextMaxTokens: null });
  });
});

// TR-205's owner built and committed with no plan on its ticket; the plugin flags it and stops the owner (TR-206).
describe("Supervisor.onTurnEnded with commits and no plan", () => {
  const owner = {
    id: "owner-np",
    provider: "claude",
    model: "sonnet",
    title: "TR-9 · x",
    status: "idle",
    cwd: "/work/tr-9",
    labels: { "taro.project": "taro", "taro.role": "owner", "taro.ticket": "TR-9" },
  };
  const hookAgent = { id: owner.id, parentAgentId: null } as unknown as HookAgent;
  const completed = { kind: "completed" } as unknown as TurnOutcome;
  const reply = items({ type: "user_message", text: "go" }, { type: "assistant_message", text: "Built it.\n\ndone: built" });
  let commits = 0;

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
  const ticket = (status: string, implementationPlan: string | null, labels: string[] = [], implementationNotes: string | null = null) =>
    vi.mocked(viewTicket).mockResolvedValue({ status, implementationPlan, acceptanceCriteria: [], implementationNotes, labels } as unknown as Awaited<ReturnType<typeof viewTicket>>);
  const told = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("no-plan:"));
  const records = () => vi.mocked(appendTicketNote).mock.calls.map(([, , record]) => record);
  const end = (taro: Supervisor) => taro.onTurnEnded(withTimeline(reply), hookAgent, completed, null, undefined);

  beforeEach(() => {
    commits = 0;
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner as unknown as PaseoAgent);
    vi.mocked(sendFromPlugin).mockClear();
    vi.mocked(appendTicketNote).mockClear();
    vi.mocked(commitsPast).mockReset();
    vi.mocked(commitsPast).mockImplementation(async () => commits);
    vi.mocked(readProjectConfig).mockResolvedValue({ baseBranch: "main" } as unknown as Awaited<ReturnType<typeof readProjectConfig>>);
  });

  afterEach(() => {
    vi.mocked(viewTicket).mockReset();
    vi.mocked(readProjectConfig).mockReset();
    vi.mocked(readProjectConfig).mockResolvedValue(null);
  });

  it("records NO-PLAN on the ticket and tells the owner to stop, once while the plan is missing", async () => {
    ticket("In Progress", null);
    commits = 2;
    const taro = supervisor();
    await end(taro);
    expect(vi.mocked(commitsPast).mock.calls[0]).toEqual(["/work/tr-9", "main"]);
    expect(vi.mocked(branchName).mock.calls[0]).toEqual(["/work/tr-9"]);
    expect(told()).toEqual(["no-plan:TR-9:taro/tr-9:2 commits:main"]);
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatch(/^NO-PLAN \S+ — 2 commits on taro\/tr-9 past main with no plan on the ticket/);

    commits = 3;
    await end(taro);
    expect(told()).toHaveLength(1);
    expect(records()).toHaveLength(1);
  });

  it("flags again after a plan was written and later emptied", async () => {
    commits = 1;
    const taro = supervisor();
    ticket("In Progress", null);
    await end(taro);
    ticket("In Progress", "## Goal\nFix it");
    await end(taro);
    ticket("In Progress", "");
    await end(taro);
    expect(told()).toEqual(["no-plan:TR-9:taro/tr-9:1 commit:main", "no-plan:TR-9:taro/tr-9:1 commit:main"]);
  });

  it("never stops a trivial or low owner that committed before its plan (TR-241)", async () => {
    commits = 2;
    for (const label of ["complexity-trivial", "complexity-low"]) {
      ticket("In Progress", null, [label]);
      await end(supervisor());
    }
    expect(told()).toEqual([]);
    expect(records()).toEqual([]);
  });

  it("still stops a medium owner that committed before its plan", async () => {
    commits = 2;
    ticket("In Progress", null, ["complexity-medium"]);
    await end(supervisor());
    expect(told()).toHaveLength(1);
  });

  it("leaves an older ticket alone whose criteria checklist stands for its plan", async () => {
    commits = 2;
    vi.mocked(viewTicket).mockResolvedValue({ status: "In Progress", implementationPlan: null, acceptanceCriteria: [{ index: 1, text: "works", checked: false }], implementationNotes: null, labels: [] } as unknown as Awaited<ReturnType<typeof viewTicket>>);
    await end(supervisor());
    expect(told()).toEqual([]);
  });

  it("says nothing with an approved plan, with no commits, on a closed ticket, or when the ticket or git cannot be read", async () => {
    commits = 4;
    ticket("In Progress", "## Goal\nFix the typo", [], "APPROVAL 2026-01-05T10:00Z — the user: \"Approve\"");
    await end(supervisor());
    expect(vi.mocked(commitsPast)).not.toHaveBeenCalled();
    ticket("Done", null);
    await end(supervisor());
    commits = 0;
    ticket("In Progress", null);
    await end(supervisor());
    vi.mocked(commitsPast).mockRejectedValue(new Error("git stopped"));
    await end(supervisor());
    vi.mocked(viewTicket).mockRejectedValue(new Error("no ticket"));
    await end(supervisor());
    expect(told()).toEqual([]);
    expect(records()).toEqual([]);
  });

  // TR-263: with a plan, the round's approval of it comes before any commit.
  describe("and a plan this round has not approved", () => {
    const PLAN = "## Goal\nExport notes";
    const answer = (at: string, rest: string) => `ANSWER ${at} — scope-approval: "Approve the plan for TR-9?" → ${rest} (the user, from the Taro screen)`;
    const stops = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("no-approval:"));

    it("records NO-APPROVAL and tells the owner to stop and ask, once while the plan is unapproved", async () => {
      commits = 2;
      ticket("In Progress", PLAN, ["complexity-medium"], "MILESTONE 2026-01-05T10:00Z — plan written");
      const taro = supervisor();
      await end(taro);
      await end(taro);
      expect(stops()).toEqual(["no-approval:TR-9:taro/tr-9:2 commits:main"]);
      expect(told()).toEqual([]);
      expect(records()).toHaveLength(1);
      expect(records()[0]).toMatch(/^NO-APPROVAL \S+ — 2 commits on taro\/tr-9 past main with the plan not approved this round: the owner was told to stop and ask scope-approval$/);
    });

    it("counts Request changes as no approval, and Approve or an APPROVAL record as approval", async () => {
      commits = 1;
      ticket("In Progress", PLAN, ["complexity-high"], answer("2026-01-05T10:01Z", 'Request changes ("drop tags")'));
      await end(supervisor());
      expect(stops()).toHaveLength(1);
      ticket("In Progress", PLAN, ["complexity-high"], `${answer("2026-01-05T10:01Z", 'Request changes ("drop tags")')}\n\n${answer("2026-01-05T10:05Z", 'Approve ("Approve the plan for TR-9")')}`);
      await end(supervisor());
      ticket("In Progress", PLAN, ["complexity-high"], 'APPROVAL 2026-01-05T10:05Z — the user: "go"');
      await end(supervisor());
      expect(stops()).toHaveLength(1);
    });

    it("does not tell once approved and then asked to change (a surprise re-ask), nor in a reopened round, worked as low", async () => {
      commits = 1;
      const taro = supervisor();
      const approved = answer("2026-01-05T10:05Z", 'Approve ("Approve")');
      ticket("In Progress", PLAN, [], approved);
      await end(taro);
      ticket("In Progress", PLAN, [], `${approved}\n\n${answer("2026-01-05T12:00Z", 'Request changes ("rename it")')}`);
      await end(taro);
      expect(stops()).toHaveLength(0);
      ticket("In Progress", PLAN, [], `${approved}\n\nREOPENED 2026-01-06T09:00Z — user: "check it"; round 2; past owners: none`);
      await end(supervisor());
      ticket("In Progress", null, [], `${approved}\n\nREOPENED 2026-01-06T09:00Z — user: "check it"; round 2; past owners: none`);
      await end(supervisor());
      // Neither NO-APPROVAL nor NO-PLAN.
      expect(vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => /^no-(plan|approval):/.test(text))).toEqual([]);
    });

    it("never stops a trivial or low owner, nor one with no commits", async () => {
      commits = 3;
      for (const label of ["complexity-trivial", "complexity-low"]) {
        ticket("In Progress", PLAN, [label]);
        await end(supervisor());
      }
      commits = 0;
      ticket("In Progress", PLAN, ["complexity-medium"]);
      await end(supervisor());
      expect(stops()).toEqual([]);
      expect(records()).toEqual([]);
    });

    it("counts a child's work approved with its parent's plan, and reads the parent only when the child's round is not approved", async () => {
      commits = 2;
      vi.mocked(fetchLiveAgent).mockResolvedValue({ ...owner, labels: { ...owner.labels, "taro.ticket": "TR-9.02" } } as unknown as PaseoAgent);
      const child = { status: "In Progress", implementationPlan: PLAN, acceptanceCriteria: [], implementationNotes: null, labels: [] };
      vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => (id === "TR-9" ? { ...child, implementationNotes: answer("2026-01-05T10:05Z", 'Approve ("Approve")') } : child) as unknown as Awaited<ReturnType<typeof viewTicket>>);
      await end(supervisor());
      expect(stops()).toEqual([]);
      expect(vi.mocked(viewTicket).mock.calls.slice(0, 2).map(([, id]) => id)).toEqual(["TR-9.02", "TR-9"]);

      vi.mocked(viewTicket).mockImplementation(async () => child as unknown as Awaited<ReturnType<typeof viewTicket>>);
      await end(supervisor());
      expect(stops()).toEqual(["no-approval:TR-9.02:taro/tr-9:2 commits:main"]);
    });
  });
});

describe("Supervisor.onTurnEnded on Paseo 0.13.0, whose hook timeline is always empty (TR-233)", () => {
  const owner = {
    id: "owner-7",
    provider: "claude",
    model: "haiku",
    title: "TR-1 · owner",
    status: "idle",
    labels: { "taro.project": "notes", "taro.role": "owner", "taro.ticket": "TR-1" },
  };
  const hookAgent = { id: owner.id, parentAgentId: null } as unknown as HookAgent;
  const completed = { kind: "completed" } as unknown as TurnOutcome;
  const ask =
    "Which colour scheme should the notes app use?\n\n```decision\nid: colour-scheme\nquestion: Which colour scheme should the notes app use?\nwhy: The palette sets every screen's look\nblocking: true\noptions:\n  - label: Light\n    prompt: Use the light scheme\n  - label: Dark\n    prompt: Use the dark scheme\nrecommended: Light\nreason: Most notes are read in daylight\n```\n\nwaiting: the user's choice of colour scheme";
  const entry = (seq: number, turnId: string, item: object, collapsed: string[] = []) => ({
    provider: "claude",
    item: item as TimelineItem,
    timestamp: `2026-10-25T14:28:${String(30 + seq).padStart(2, "0")}.000Z`,
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    turnId,
    collapsed,
  });
  // Paseo 0.13.0's projected page for an owner's first two turns, as `timeline.refetch` returned it on a
  // throwaway daemon: the reply's streamed pieces merged into one message, the nudge keeping its plugin id.
  const firstTurn = [
    entry(1, "foreground-turn-1", { type: "user_message", text: "Ask which colour scheme to use.", messageId: "a1b2c3d4-0001" }),
    entry(2, "foreground-turn-1", { type: "assistant_message", text: ask, messageId: "msg_0001" }, ["assistant_merge"]),
  ];
  const secondTurn = [
    entry(9, "foreground-turn-2", { type: "user_message", text: "Carry on.", clientMessageId: "taro-0002", messageId: "taro-0002" }),
    entry(10, "foreground-turn-2", { type: "assistant_message", text: "Still yours to choose.\n\nwaiting: the user's choice of colour scheme", messageId: "msg_0002" }, ["assistant_merge"]),
  ];

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
  const supervisor = (state: PluginState) => new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
  const paged = (...pages: readonly (readonly object[])[]) => {
    const refetch = vi.fn(async (options: { direction: string; cursor?: number }) => {
      const index = options.direction === "tail" ? pages.length - 1 : (options.cursor ?? 0) - 1;
      return { entries: pages[index] ?? [], hasOlder: index > 0, startCursor: index };
    });
    return { paseo: { agents: { ref: () => ({ timeline: { refetch } }) } } as unknown as PaseoApi, refetch };
  };
  const nudges = () => vi.mocked(sendFromPlugin).mock.calls.filter(([, , text]) => text.startsWith("nudge"));
  const logged = () => vi.mocked(console.log).mock.calls.map(([line]) => String(line)).filter((line) => line.includes("turn ended"));

  beforeEach(() => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner as unknown as PaseoAgent);
    vi.mocked(viewTicket).mockResolvedValue({ status: "Planning", labels: [], implementationNotes: null } as unknown as Awaited<ReturnType<typeof viewTicket>>);
    vi.mocked(sendFromPlugin).mockClear();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(viewTicket).mockReset();
  });

  it("reads a correct waiting turn from the agent's timeline: its card is stored, no nudge, never Stalled", async () => {
    const { state, decisions, agents } = fakeState();
    const taro = supervisor(state);
    await taro.onTurnEnded(paged(firstTurn).paseo, hookAgent, completed, "foreground-turn-1", undefined);
    expect(nudges()).toEqual([]);
    expect(decisions.map((decision) => [decision.id, decision.status, decision.blocking])).toEqual([["colour-scheme", "open", true]]);
    expect(agents[owner.id]?.lastStatus).toMatchObject({ state: "waiting", text: "the user's choice of colour scheme" });

    await taro.onTurnEnded(paged([...firstTurn, ...secondTurn]).paseo, hookAgent, completed, "foreground-turn-2", undefined);
    expect(nudges()).toEqual([]);
    expect(agents[owner.id]).toMatchObject({ stallCount: 0, stalled: false });
    expect(logged()).toEqual([
      "[taro] owner-7 turn ended (completed, foreground-turn-1): read 2 items, 2 in this turn; status waiting; decisions colour-scheme",
      "[taro] owner-7 turn ended (completed, foreground-turn-2): read 4 items, 2 in this turn; status waiting; decisions none",
    ]);
  });

  it("stops at the turn the hook names when the next one has already started", async () => {
    const { state, decisions, agents } = fakeState();
    // The user's queued message went at once: the page already holds the next turn's opening.
    await supervisor(state).onTurnEnded(paged([...firstTurn, secondTurn[0]!]).paseo, hookAgent, completed, "foreground-turn-1", undefined);
    expect(nudges()).toEqual([]);
    expect(decisions.map((decision) => decision.id)).toEqual(["colour-scheme"]);
    expect(agents[owner.id]?.lastStatus?.state).toBe("waiting");
  });

  it("pages back for the turn's opening when a newer turn fills the tail", async () => {
    const { state, decisions } = fakeState();
    const { paseo, refetch } = paged([firstTurn[0]!], [firstTurn[1]!, secondTurn[0]!]);
    await supervisor(state).onTurnEnded(paseo, hookAgent, completed, "foreground-turn-1", undefined);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(decisions[0]?.turn).not.toBeNull();
    expect(nudges()).toEqual([]);
  });

  it("reads a turn again a moment later when the first read fails", async () => {
    const { state, decisions } = fakeState();
    const refetch = vi.fn().mockRejectedValueOnce(new Error("socket closed")).mockResolvedValue({ entries: firstTurn, hasOlder: false, startCursor: null });
    await supervisor(state).onTurnEnded({ agents: { ref: () => ({ timeline: { refetch } }) } } as unknown as PaseoApi, hookAgent, completed, "foreground-turn-1", undefined);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(decisions.map((decision) => decision.id)).toEqual(["colour-scheme"]);
    expect(nudges()).toEqual([]);
  });

  it("neither nudges nor counts a stall for a turn whose timeline could not be read twice, logs it, and leaves it for the reconcile", async () => {
    const { state, agents } = fakeState();
    const taro = supervisor(state);
    const silent = [firstTurn[0]!, entry(2, "foreground-turn-1", { type: "assistant_message", text: "Looked around." })];
    await taro.onTurnEnded(paged(silent).paseo, hookAgent, completed, "foreground-turn-1", undefined);
    expect(nudges()).toHaveLength(1);
    const seen = agents[owner.id]?.lastTurnEndedAt;
    const refetch = vi.fn(async () => Promise.reject(new Error("socket closed")));
    await taro.onTurnEnded({ agents: { ref: () => ({ timeline: { refetch } }) } } as unknown as PaseoApi, hookAgent, completed, "foreground-turn-2", undefined);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(nudges()).toHaveLength(1);
    expect(agents[owner.id]).toMatchObject({ stallCount: 1, stalled: false, lastTurnEndedAt: seen });
    expect(logged()[1]).toBe("[taro] owner-7 turn ended (completed, foreground-turn-2): its timeline could not be read, so no status line or decision was looked for and no nudge is sent");
  });

  it("delivers a subagent's report its unread turn end missed at the reconcile after a restart", async () => {
    const { state } = fakeState();
    const taro = supervisor(state);
    const implementer = { id: "implementer-7", title: "TR-1 · implementer: building the palette", status: "idle", updatedAt: new Date().toISOString(), labels: { "taro.project": "notes", "taro.role": "implementer", "taro.ticket": "TR-1", "paseo.parent-agent-id": owner.id } };
    vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (id === implementer.id ? implementer : owner) as unknown as PaseoAgent);
    const report = [entry(1, "foreground-turn-1", { type: "user_message", text: "Build the palette.", clientMessageId: "taro-0003" }), entry(2, "foreground-turn-1", { type: "assistant_message", text: "Built it.\n\ndone: the palette" })];
    const failing = { agents: { ref: () => ({ timeline: { refetch: async () => Promise.reject(new Error("socket closed")) } }) } } as unknown as PaseoApi;
    await taro.onTurnEnded(failing, { id: implementer.id, parentAgentId: owner.id } as unknown as HookAgent, completed, "foreground-turn-1", undefined);
    expect(vi.mocked(sendFromPlugin).mock.calls).toEqual([]);
    vi.mocked(listTaroAgents).mockResolvedValueOnce([implementer as unknown as PaseoAgent]);
    await taro.reconcile(paged(report).paseo, ["notes"]);
    expect(vi.mocked(sendFromPlugin).mock.calls.map(([, id, text]) => [id, text])).toEqual([[owner.id, "report:implementer:Built it.\n\ndone: the palette"]]);
  });

  it("still nudges a turn that really ended without a status line", async () => {
    const { state, agents } = fakeState();
    const silent = [firstTurn[0]!, entry(2, "foreground-turn-1", { type: "assistant_message", text: "Looked around." })];
    await supervisor(state).onTurnEnded(paged(silent).paseo, hookAgent, completed, "foreground-turn-1", undefined);
    expect(nudges()).toHaveLength(1);
    expect(agents[owner.id]?.stallCount).toBe(1);
  });
});

describe("throughTurn", () => {
  const entry = (turnId: string | undefined, text: string) => ({ item: { type: "assistant_message", text } as TimelineItem, ...(turnId === undefined ? {} : { turnId }) }) as unknown as TimelinePage["entries"][number];
  const texts = (read: readonly TimelineItem[]) => read.map((item) => (item.type === "assistant_message" ? item.text : ""));
  const page = [entry("t-1", "a"), entry("t-1", "b"), entry("t-2", "c"), entry(undefined, "d")];

  it("keeps the entries up to the named turn's last one", () => {
    expect(texts(throughTurn(page, "t-1"))).toEqual(["a", "b"]);
    expect(texts(throughTurn(page, "t-2"))).toEqual(["a", "b", "c"]);
  });

  it("keeps them all with no turn id, an id no entry carries, or an empty page", () => {
    expect(texts(throughTurn(page, null))).toEqual(["a", "b", "c", "d"]);
    expect(texts(throughTurn(page, "t-9"))).toEqual(["a", "b", "c", "d"]);
    expect(throughTurn([], "t-1")).toEqual([]);
  });

  it("takes the latest run of a turn id Paseo reused after a restart", () => {
    expect(texts(throughTurn([entry("t-1", "old"), entry("t-2", "x"), entry("t-1", "new"), entry("t-2", "next")], "t-1"))).toEqual(["old", "x", "new"]);
  });
});

describe("turnEndLine", () => {
  const decision = (id: string) => ({ id }) as unknown as Parameters<typeof turnEndLine>[5][number];

  it("names the outcome, the turn, what was read, the status and every decision", () => {
    expect(turnEndLine("a-1", "completed", "foreground-turn-3", { items: 12, turn: 5 }, { state: "waiting", text: "approval" }, [decision("scope"), decision("colour")])).toBe(
      "[taro] a-1 turn ended (completed, foreground-turn-3): read 12 items, 5 in this turn; status waiting; decisions scope, colour",
    );
  });

  it("says none for a missing status or decisions, and when there was no turn id or no read", () => {
    expect(turnEndLine("a-1", "canceled", null, { items: 0, turn: 0 }, null, [])).toBe("[taro] a-1 turn ended (canceled, no turn id): read 0 items, 0 in this turn; status none; decisions none");
    expect(turnEndLine("a-1", "failed", "t", null, null, [])).toMatch(/^\[taro\] a-1 turn ended \(failed, t\): its timeline could not be read/);
  });
});

// PSA-022's owner opened a pull request and ended "waiting: user's accept" with its ticket still Planning (TR-252).
describe("Supervisor.onTurnEnded waiting for acceptance too early", () => {
  const owner = { id: "owner-pw", provider: "claude", model: "sonnet", title: "TR-9 · x", status: "idle", cwd: "/work/tr-9", labels: { "taro.project": "taro", "taro.role": "owner", "taro.ticket": "TR-9" } };
  const hookAgent = { id: owner.id, parentAgentId: null } as unknown as HookAgent;
  const completed = { kind: "completed" } as unknown as TurnOutcome;
  const ending = (line: string) => withTimeline([{ type: "user_message", text: "go" }, { type: "assistant_message", text: `Opened PR #11.\n\n${line}` }] as unknown as TimelineItem[]);
  const ticket = (status: string) =>
    vi.mocked(viewTicket).mockResolvedValue({ status, implementationPlan: null, acceptanceCriteria: [], implementationNotes: null, labels: [], finalSummary: null } as unknown as Awaited<ReturnType<typeof viewTicket>>);
  const told = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("accepting-too-early:"));

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
    return new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, {} as unknown as Recovery);
  }

  beforeEach(() => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner as unknown as PaseoAgent);
    vi.mocked(sendFromPlugin).mockClear();
  });
  afterEach(() => vi.mocked(viewTicket).mockReset());

  it("tells the owner what is missing, then backs off while it repeats", async () => {
    ticket("Planning");
    const taro = supervisor();
    const end = () => taro.onTurnEnded(ending("waiting: user's accept"), hookAgent, completed, null, undefined);
    await end();
    expect(told()).toHaveLength(1);
    expect(told()[0]).toMatch(/^accepting-too-early:TR-9:Planning:- the plan.*EVIDENCE record.*FINAL summary.*status step/s);
    await end();
    await end();
    await end();
    expect(told()).toHaveLength(3);
  });

  it("stays quiet when delivered, and starts over after another ending", async () => {
    const taro = supervisor();
    ticket("Awaiting acceptance");
    await taro.onTurnEnded(ending("waiting: user's accept"), hookAgent, completed, null, undefined);
    expect(told()).toEqual([]);
    ticket("Planning");
    await taro.onTurnEnded(ending("waiting: user's accept"), hookAgent, completed, null, undefined);
    await taro.onTurnEnded(ending("done: nothing"), hookAgent, completed, null, undefined);
    await taro.onTurnEnded(ending("waiting: user's accept"), hookAgent, completed, null, undefined);
    expect(told()).toHaveLength(2);
  });
});

// TR-254: the Accept card is held while the delivery record is incomplete, so the plugin asks the owner for it.
describe("Supervisor.onTurnEnded with an incomplete delivery record", () => {
  const owner = { id: "owner-dm", provider: "claude", model: "sonnet", title: "TR-8 · x", status: "idle", cwd: "/work/tr-8", labels: { "taro.project": "taro", "taro.role": "owner", "taro.ticket": "TR-8" } };
  const hookAgent = { id: owner.id, parentAgentId: null } as unknown as HookAgent;
  const completed = { kind: "completed" } as unknown as TurnOutcome;
  const head = "a".repeat(40);
  const ended = () => withTimeline([{ type: "user_message", text: "go" }, { type: "assistant_message", text: "Delivered.\n\ndone: delivered" }] as unknown as TimelineItem[]);
  const ticket = (notes: string | null, labels: string[] = []) =>
    vi.mocked(viewTicket).mockResolvedValue({ status: "Awaiting acceptance", implementationPlan: "p", acceptanceCriteria: [], implementationNotes: notes, labels, finalSummary: null } as unknown as Awaited<ReturnType<typeof viewTicket>>);
  const config = (acceptAlsoMerges: boolean) => vi.mocked(readProjectConfig).mockResolvedValue({ acceptAlsoMerges, delivery: "pull-request" } as unknown as Awaited<ReturnType<typeof readProjectConfig>>);
  const told = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("delivery-missing:"));

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
    return new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, {} as unknown as Recovery);
  }

  beforeEach(() => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner as unknown as PaseoAgent);
    vi.mocked(sendFromPlugin).mockClear();
  });
  afterEach(() => {
    vi.mocked(viewTicket).mockReset();
    vi.mocked(readProjectConfig).mockResolvedValue(null);
  });

  it("tells the owner once per gap and again when the gap changes or comes back", async () => {
    const taro = supervisor();
    config(true);
    ticket(null);
    const end = () => taro.onTurnEnded(ended(), hookAgent, completed, null, undefined);
    await end();
    await end();
    expect(told()).toHaveLength(1);
    expect(told()[0]).toContain("no review-head");
    ticket(`review-head: ${head}`);
    await end();
    expect(told()).toHaveLength(2);
    expect(told()[1]).toContain("no PR URL");
    ticket(`review-head: ${head}\npr: https://example.com/o/r/pull/3`);
    await end();
    ticket(null);
    await end();
    expect(told()).toHaveLength(3);
  });

  it("says nothing for an investigation or a project that does not merge on Accept", async () => {
    const taro = supervisor();
    config(true);
    ticket(null, ["investigation"]);
    await taro.onTurnEnded(ended(), hookAgent, completed, null, undefined);
    config(false);
    ticket(null);
    await taro.onTurnEnded(ended(), hookAgent, completed, null, undefined);
    expect(told()).toEqual([]);
  });
});

// PSA-045's hand-off owner pushed its conflict fix, then ended with the pull request open and nothing retried (TR-256).
describe("Supervisor.onTurnEnded with an Accept hand-off unfinished", () => {
  const owner = { id: "owner-ah", provider: "claude", model: "sonnet", title: "TR-9 · x", status: "idle", cwd: "/work/tr-9", labels: { "taro.project": "taro", "taro.role": "owner", "taro.ticket": "TR-9" } };
  const hookAgent = { id: owner.id, parentAgentId: null } as unknown as HookAgent;
  const completed = { kind: "completed" } as unknown as TurnOutcome;
  const ending = () => withTimeline([{ type: "user_message", text: "go" }, { type: "assistant_message", text: "Pushed the fix.\n\nworking: waiting for GitHub" }] as unknown as TimelineItem[]);
  const notes = "ACCEPTED 2026-11-04T01:05Z — merging: yes\n\nACCEPT-HANDOFF 2026-11-04T01:05Z — Same owner: gh pr merge failed";
  const ticket = (implementationNotes: string) =>
    vi.mocked(viewTicket).mockResolvedValue({ status: "Awaiting acceptance", implementationPlan: null, acceptanceCriteria: [], implementationNotes: `${implementationNotes}\n\nEXECUTION 2026-11-04T01:00Z — PR https://github.com/example/notes-app/pull/32`, labels: [], finalSummary: null } as unknown as Awaited<ReturnType<typeof viewTicket>>);
  const told = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("accept-unfinished:"));
  const notMerged = () => vi.mocked(appendTicketNote).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("NOT-MERGED"));

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
    return new Supervisor(state, { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, {} as unknown as Recovery);
  }

  beforeEach(() => {
    vi.mocked(fetchLiveAgent).mockResolvedValue(owner as unknown as PaseoAgent);
    vi.mocked(sendFromPlugin).mockClear();
    vi.mocked(appendTicketNote).mockClear();
  });
  afterEach(() => vi.mocked(viewTicket).mockReset());

  it("tells the owner to finish, with the pull request's state, then asks the user at the limit", async () => {
    ticket(notes);
    const taro = supervisor();
    await taro.onTurnEnded(ending(), hookAgent, completed, null, undefined);
    await taro.onTurnEnded(ending(), hookAgent, completed, null, undefined);
    expect(told()).toHaveLength(2);
    expect(told()[0]).toContain("CONFLICTING");
    expect(notMerged()).toEqual([]);
    await taro.onTurnEnded(ending(), hookAgent, completed, null, undefined);
    expect(told()).toHaveLength(2);
    expect(vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("nudge"))).toEqual([]);
    expect(notMerged()).toHaveLength(1);
    expect(notMerged()[0]).toMatch(/ended 3 turns without finishing.*CONFLICTING/);
  });

  it("tells the owner again after the user was asked, and copes with a gh failure and a local delivery", async () => {
    ticket(notes);
    const taro = supervisor();
    for (let turn = 0; turn < 4; turn++) await taro.onTurnEnded(ending(), hookAgent, completed, null, undefined);
    expect(notMerged()).toHaveLength(1);
    expect(told()).toHaveLength(3);
    vi.mocked(runCommand).mockResolvedValueOnce({ code: 1, stdout: "", stderr: "no" });
    await taro.onTurnEnded(ending(), hookAgent, completed, null, undefined);
    expect(told()[3]).toContain("could not be read");
    vi.mocked(viewTicket).mockResolvedValue({ status: "Awaiting acceptance", implementationPlan: null, acceptanceCriteria: [], implementationNotes: notes, labels: [], finalSummary: null } as unknown as Awaited<ReturnType<typeof viewTicket>>);
    await supervisor().onTurnEnded(ending(), hookAgent, completed, null, undefined);
    expect(told()[4]).toContain("local-branch");
  });

  it("stays quiet once the hand-off is closed", async () => {
    ticket(`${notes}\n\nACCEPTANCE 2026-11-04T01:09Z — merged`);
    await supervisor().onTurnEnded(ending(), hookAgent, completed, null, undefined);
    expect(told()).toEqual([]);
    expect(notMerged()).toEqual([]);
  });
});

describe("Supervisor.onTurnEnded sends each step's page once", () => {
  const owner = { id: "owner-step", provider: "claude", model: "sonnet", title: "TR-9 · x", status: "idle", cwd: "/work/tr-9", labels: { "taro.project": "taro", "taro.role": "owner", "taro.ticket": "TR-9" } };
  const completed = { kind: "completed" } as unknown as TurnOutcome;
  const reply = items({ type: "user_message", text: "go" }, { type: "assistant_message", text: "Rated it.\n\nwaiting: the medium page" });
  const APPROVAL = 'APPROVAL 2026-11-01T10:30Z — user: "Approve the plan for TR-9"';
  const CLEAN = "REVIEW 2026-11-01T12:30Z — reviewer r1 over main..taro/tr-9: no findings — verdict: clean";
  let home = "";
  let facts: StepTicket;
  const previousHome = process.env.PASEO_HOME;

  // The plugin's own state on disk, so a reload (a new state and supervisor over the same files) is real.
  const supervisor = () => new Supervisor(new StoredPluginState(), { turnEnded: async () => undefined, count: async () => undefined } as unknown as Stats, recovery);
  const end = (taro: Supervisor, agentId = owner.id) => taro.onTurnEnded(withTimeline(reply), { id: agentId, parentAgentId: null } as unknown as HookAgent, completed, null, undefined);
  const sent = () => vi.mocked(sendFromPlugin).mock.calls.map(([, , text]) => text).filter((text) => text.startsWith("step:"));
  const at = (change: Partial<StepTicket>) => {
    facts = { ...facts, ...change };
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "taro-steps-"));
    process.env.PASEO_HOME = home;
    facts = { id: "TR-9", status: "Planning", labels: [], notes: null, children: [], baseBranch: "main", deliveryGaps: [] };
    vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => ({ ...owner, id }) as unknown as PaseoAgent);
    vi.mocked(viewTicket).mockResolvedValue({ status: "Planning", implementationPlan: "## Goal\nx", acceptanceCriteria: [], implementationNotes: null, labels: [] } as unknown as Awaited<ReturnType<typeof viewTicket>>);
    vi.mocked(stepTicket).mockImplementation(async () => facts);
    vi.mocked(sendFromPlugin).mockClear();
  });

  afterEach(() => {
    vi.mocked(stepTicket).mockReset();
    vi.mocked(stepTicket).mockResolvedValue(UNRATED);
    vi.mocked(viewTicket).mockReset();
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("sends nothing while the ticket has no level label", async () => {
    await end(supervisor());
    expect(sent()).toEqual([]);
  });

  it("sends each phase's page as the ticket reaches it, once each", async () => {
    const taro = supervisor();
    at({ labels: ["complexity-high"] });
    await end(taro);
    await end(taro);
    at({ status: "In Progress", notes: APPROVAL, children: [{ id: "TR-9.01", title: "a", status: "Queued", dependencies: [] }] });
    await end(taro);
    await end(taro);
    at({ children: [{ id: "TR-9.01", title: "a", status: "Done", dependencies: [] }] });
    await end(taro);
    await end(taro);
    at({ notes: `${APPROVAL}\n\n${CLEAN}`, status: "Reviewing" });
    await end(taro);
    await end(taro);
    expect(sent()).toEqual(["step:levels/high.md:round 1", "step:phases/build.md:round 1", "step:phases/review.md:round 1", "step:phases/delivery.md:round 1"]);
  });

  it("remembers what it sent across a plugin reload", async () => {
    at({ labels: ["complexity-medium"] });
    await end(supervisor());
    await end(supervisor());
    at({ notes: APPROVAL, status: "In Progress" });
    await end(supervisor());
    await end(supervisor());
    expect(sent()).toEqual(["step:levels/medium.md:round 1", "step:phases/build.md:round 1"]);
  });

  it("sends a reopened round's pages again, once", async () => {
    const taro = supervisor();
    at({ labels: ["complexity-low"] });
    await end(taro);
    at({ notes: `${CLEAN}\n\nREOPENED 2026-11-02T09:00Z — user: "check it on staging"; round 2; past owners: owner-step` });
    await end(taro);
    await end(supervisor());
    expect(sent()).toEqual(["step:levels/light.md:round 1", "step:levels/light.md:round 2"]);
  });

  it("sends the current page to a new owner of the ticket, which has not read it", async () => {
    at({ labels: ["complexity-medium"], notes: APPROVAL, status: "In Progress" });
    await end(supervisor());
    await end(supervisor(), "owner-relaunched");
    expect(sent()).toEqual(["step:phases/build.md:round 1", "step:phases/build.md:round 1"]);
  });

  it("leaves Awaiting acceptance and an Accept hand-off to their own messages", async () => {
    at({ labels: ["complexity-medium"], status: "Awaiting acceptance", notes: `${APPROVAL}\n\n${CLEAN}`, deliveryGaps: ["the ticket records no review-head"] });
    await end(supervisor());
    at({ notes: `${APPROVAL}\n\n${CLEAN}\n\nACCEPT-HANDOFF 2026-11-01T13:00Z — owner: the head moved` });
    await end(supervisor());
    expect(sent()).toEqual([]);
  });

  it("sends a page lost to a reload: the reconcile finds the idle owner whose turn end the hook missed, and sends it once", async () => {
    at({ labels: ["complexity-medium"] });
    const idle = () => vi.mocked(listTaroAgents).mockResolvedValueOnce([{ ...owner, updatedAt: new Date().toISOString() } as unknown as PaseoAgent]);
    idle();
    await supervisor().reconcile(withTimeline(reply), ["taro"]);
    expect(sent()).toEqual(["step:levels/medium.md:round 1"]);
    // Another reload, and the turn end after: the page stays sent.
    idle();
    await supervisor().reconcile(withTimeline(reply), ["taro"]);
    await end(supervisor());
    expect(sent()).toEqual(["step:levels/medium.md:round 1"]);
  });

  it("reads the ticket again at the minute's sweep when the turn end could not, and sends the page once", async () => {
    at({ labels: ["complexity-low"] });
    vi.mocked(stepTicket).mockRejectedValueOnce(new Error("tracker locked"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await end(supervisor());
    warn.mockRestore();
    expect(sent()).toEqual([]);
    vi.mocked(listTaroAgents).mockResolvedValue([{ ...owner, updatedAt: new Date().toISOString() } as unknown as PaseoAgent]);
    try {
      expect(await supervisor().retryUnreadSteps(withTimeline(reply), ["taro"])).toBe(1);
      expect(await supervisor().retryUnreadSteps(withTimeline(reply), ["taro"])).toBe(0);
    } finally {
      vi.mocked(listTaroAgents).mockReset();
      vi.mocked(listTaroAgents).mockResolvedValue([]);
    }
    await end(supervisor());
    expect(sent()).toEqual(["step:levels/light.md:round 1"]);
  });

  it("holds the page while the owner waits on a blocking question, and sends it at the turn end after the answer", async () => {
    at({ labels: ["complexity-medium"] });
    const taro = supervisor();
    const question = items(
      { type: "user_message", text: "go" },
      { type: "assistant_message", text: "One call first.\n\n```decision\nid: storage\nquestion: Store notes as files or rows?\nwhy: it shapes the export\nblocking: true\noptions:\n  - label: Files\n    prompt: Files\n  - label: Rows\n    prompt: Rows\nrecommended: Files\nreason: simpler\n```\n\nwaiting: storage" },
    );
    await taro.onTurnEnded(withTimeline(question), { id: owner.id, parentAgentId: null } as unknown as HookAgent, completed, null, undefined);
    expect(sent()).toEqual([]);
    const stored = new StoredPluginState();
    expect((await stored.allDecisions()).filter((decision) => decision.status === "open" && decision.blocking).map((decision) => decision.id)).toEqual(["storage"]);
    // The minute's sweep and a reload hold it too.
    vi.mocked(listTaroAgents).mockResolvedValueOnce([{ ...owner, updatedAt: new Date().toISOString() } as unknown as PaseoAgent]);
    await supervisor().reconcile(withTimeline(question), ["taro"]);
    expect(sent()).toEqual([]);
    await stored.updateDecisions((decisions) => {
      for (const decision of decisions) decision.status = "answered";
    });
    await end(supervisor());
    expect(sent()).toEqual(["step:levels/medium.md:round 1"]);
  });

  // Review finding: the reconcile sent the current page to every idle owner, a Stalled one included.
  it("sends nothing at a reload to an idle owner whose turn end was seen, though its ticket moved on since", async () => {
    at({ labels: ["complexity-medium"] });
    await end(supervisor());
    // The user approves on the card; the plugin reloads before the owner's next turn ends.
    at({ notes: APPROVAL, status: "In Progress" });
    vi.mocked(listTaroAgents).mockResolvedValueOnce([{ ...owner, updatedAt: new Date().toISOString() } as unknown as PaseoAgent]);
    await supervisor().reconcile(withTimeline(reply), ["taro"]);
    expect(sent()).toEqual(["step:levels/medium.md:round 1"]);
    // Its next turn end sends it.
    await end(supervisor());
    expect(sent()).toEqual(["step:levels/medium.md:round 1", "step:phases/build.md:round 1"]);
  });

  it("sends nothing at a reload to a Stalled owner, even for a turn end the hook missed", async () => {
    at({ labels: ["complexity-medium"] });
    await new StoredPluginState().updateAgent(owner.id, () => AgentStateSchema.parse({ project: "taro", role: "owner", ticket: "TR-9", stepPages: "tracked" }), (record) => {
      record.stalled = true;
    });
    vi.mocked(listTaroAgents).mockResolvedValueOnce([{ ...owner, updatedAt: new Date().toISOString() } as unknown as PaseoAgent]);
    await supervisor().reconcile(withTimeline(reply), ["taro"]);
    expect(sent()).toEqual([]);
  });

  describe("an owner already at work when step pages began", () => {
    // A record written before step pages: parsed with their fields' defaults, as a reload reads it.
    const keptRecord = (lastTurnEndedAt: string | null) =>
      new StoredPluginState().updateAgent(owner.id, () => AgentStateSchema.parse({ project: "taro", role: "owner", ticket: "TR-9", lastTurnEndedAt }), () => undefined);

    it("is not sent the page of the step it is already in, at its turn end or across reloads, but gets the next one", async () => {
      at({ labels: ["complexity-medium"], notes: APPROVAL, status: "In Progress" });
      await keptRecord("2026-11-01T10:00:00.000Z");
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      await end(supervisor());
      await end(supervisor());
      expect(sent()).toEqual([]);
      expect(log.mock.calls.some(([line]) => String(line).includes("already at phases/build.md on TR-9 when step pages began"))).toBe(true);
      log.mockRestore();
      at({ status: "Reviewing" });
      await end(supervisor());
      expect(sent()).toEqual(["step:phases/review.md:round 1"]);
    });

    it("is not sent it by the reconcile either, for a turn end the hook missed", async () => {
      at({ labels: ["complexity-low"] });
      await keptRecord("2026-11-01T10:00:00.000Z");
      vi.mocked(listTaroAgents).mockResolvedValueOnce([{ ...owner, updatedAt: new Date().toISOString() } as unknown as PaseoAgent]);
      await supervisor().reconcile(withTimeline(reply), ["taro"]);
      await end(supervisor());
      expect(sent()).toEqual([]);
    });

    it("still gets its pages when it had taken no turn yet", async () => {
      at({ labels: ["complexity-low"] });
      await keptRecord(null);
      await end(supervisor());
      expect(sent()).toEqual(["step:levels/light.md:round 1"]);
    });

    it("gets the level page it rates after the reload, having had no step before", async () => {
      await keptRecord("2026-11-01T10:00:00.000Z");
      await end(supervisor());
      at({ labels: ["complexity-low"] });
      await end(supervisor());
      expect(sent()).toEqual(["step:levels/light.md:round 1"]);
    });
  });

  it("sends nothing, and says why in the log, when the ticket cannot be read", async () => {
    vi.mocked(stepTicket).mockRejectedValue(new Error("tracker locked"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await end(supervisor());
    expect(sent()).toEqual([]);
    expect(warn.mock.calls.some(([line]) => String(line).includes("reading TR-9's step: tracker locked"))).toBe(true);
    warn.mockRestore();
  });
});
