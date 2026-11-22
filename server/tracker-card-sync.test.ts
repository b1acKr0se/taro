// Cards and agents kept in the ticket file (asked outside Paseo) show on Paseo's board and Inbox, and answering one in
// either app closes it in both: one locked write through the ticket store, no agent looked up or messaged.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROLES, roleFromLabel, RoleSchema } from "../shared/project";
import { decisionsOfLiveAgents, isStaleRecordedAgent, isStaleTrackerDecision, parseTrackerKey, questionsToCarry, StoredDecisionSchema, trackerDecision, type StoredDecision } from "../shared/state";
import type { TrackerAgent, TrackerCard } from "../shared/tracker-cards";
import { recordedAgentRows } from "../client/pane-agents";
import { Actions } from "./actions";
import { fetchLiveAgent, isAgentGone, projectAgents } from "./agents";
import { findDecision, invalidateBoards, liveOpenDecisions, loadBoard, loadTicketDetail } from "./board";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import { sendFromPlugin, sendUserAnswer } from "./send";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { identityFromLabels, type Supervisor } from "./supervision";
import { createTicketStore } from "./ticket-store";
import { answerCard, askCard, recordAgent } from "./tracker-cards";
import { forgetTicketFile, viewTicket } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

let tracker = "";

// The board writes the live list into the plugin state folder: never the real home's from a test.
vi.mock("./live-list", () => ({ liveListEntry: () => ({}), recordLiveList: async () => false }));
vi.mock("./agents", async (original) => ({
  ...(await original<typeof import("./agents")>()),
  fetchLiveAgent: vi.fn(async () => null),
  isAgentGone: vi.fn(async () => false),
  projectAgents: vi.fn(async () => []),
  projectArchivedAgents: vi.fn(async () => []),
  listTaroAgents: vi.fn(async () => []),
  isMidTurn: () => false,
}));
vi.mock("./send", () => ({ sendFromPlugin: vi.fn(async () => undefined), sendUserAnswer: vi.fn(async () => undefined), sendWithoutInterrupting: vi.fn(async () => undefined), sendCommand: vi.fn() }));
vi.mock("./package-files", () => ({ TEMPLATES: { answer: "answer", questionDismissed: "question-dismissed", planChanges: "plan-changes" }, skillDirectory: async () => "/skill", message: async (path: string) => path }));
vi.mock("./projects", () => ({
  projectPaths: async () => ({ tracker, suggestions: "/nonexistent/taro-suggestions.md" }),
  readProjectConfig: async () => null,
  requireProjectConfig: async () => ({}),
  listProjectConfigs: async () => [{ project: "notes" }],
}));
vi.mock("./headroom", () => ({ readHeadroom: async () => null }));
vi.mock("./process", () => ({ runCommand: vi.fn(async () => ({ code: 1, stdout: "", stderr: "" })), runChecked: vi.fn() }));
vi.mock("./tickets", async (original) => {
  const actual = await original<typeof import("./tickets")>();
  return { ...actual, viewTicket: vi.fn(actual.viewTicket) };
});

const PROJECT = "notes";
const KEY = `tracker:${PROJECT}/NO-001:pick-db`;

function stateOver(decisions: StoredDecision[]) {
  return {
    allDecisions: vi.fn(async () => [...decisions]),
    allAgents: async () => ({}),
    decision: vi.fn(async (key: string) => decisions.find((decision) => decision.key === key) ?? null),
    updateDecisions: vi.fn(async <T>(change: (stored: StoredDecision[]) => T) => change(decisions)),
  };
}

function actionsOver(state: ReturnType<typeof stateOver>, supervisor = { withdrawDecisionsOf: vi.fn(async () => undefined) }) {
  return new Actions(state as unknown as PluginState, supervisor as unknown as Supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
}

/** A second store over the same tracker: what the `taro` command opens, in another process. */
function cliStore() {
  return createTicketStore(tracker, { prefix: "NO" });
}

async function seed(status = "In Progress"): Promise<void> {
  const store = cliStore();
  const ticket = await store.create({ title: "Pick the database", status: status as "In Progress" });
  expect(ticket.id).toBe("NO-001");
  await askCard(
    store,
    "NO-001",
    {
      card: {
        id: "pick-db",
        question: "Which database?",
        why: "Storage shapes the schema.",
        options: [
          { label: "SQLite", prompt: "Use SQLite", consequence: "One file" },
          { label: "Postgres", prompt: "Use Postgres", consequence: "A server" },
        ],
        recommended: "SQLite",
        reason: "Simplest",
      },
      host: "claude-code",
    },
    { now: () => new Date("2026-11-22T10:00:00Z") },
  );
}

function ticketText(): string {
  return readFileSync(join(tracker, "tickets", "NO-001.md"), "utf8");
}

async function storedCard(): Promise<TrackerCard> {
  const card = (await viewTicket(tracker, "NO-001")).trackerCards.find((each) => each.id === "pick-db");
  if (card === undefined) throw new Error("no card");
  return card;
}

function paseoDecision(agentId: string, id: string, ticket = "NO-001"): StoredDecision {
  return StoredDecisionSchema.parse({ key: `${agentId}:${id}`, id, question: `Paseo asks ${id}?`, project: PROJECT, ticket, agentId, agentRole: "owner", agentTitle: `${ticket} · owner`, askedAt: "2026-11-22T09:00:00Z", status: "open", blocking: true });
}

const paseo = {} as PaseoApi;

beforeEach(() => {
  tracker = mkdtempSync(join(tmpdir(), "taro-tracker-sync-"));
  invalidateBoards();
  vi.mocked(sendUserAnswer).mockClear();
  vi.mocked(sendFromPlugin).mockClear();
  vi.mocked(isAgentGone).mockClear();
  vi.mocked(fetchLiveAgent).mockClear();
  vi.mocked(viewTicket).mockClear();
  vi.mocked(projectAgents).mockReset().mockResolvedValue([]);
});

afterEach(() => {
  forgetTicketFile(tracker, undefined);
  rmSync(tracker, { recursive: true, force: true });
});

describe("tracker cards as Paseo decisions", () => {
  it("maps a tracker card", async () => {
    await seed();
    const card = await storedCard();
    const decision = trackerDecision(PROJECT, "NO-001", card);
    expect(decision.key).toBe(KEY);
    expect(decision.agentId).toBe(`tracker:${PROJECT}/NO-001`);
    expect(decision.agentRole).toBe("external");
    expect(decision.askedAt).toBe("2026-11-22T10:00:00.000Z");
    expect(decision.ticket).toBe("NO-001");
    expect(decision.project).toBe(PROJECT);
    expect(decision.status).toBe("open");
    expect(decision.options.map((option) => [option.label, option.prompt])).toEqual([
      ["SQLite", "Use SQLite"],
      ["Postgres", "Use Postgres"],
    ]);
    expect(decision.recommended).toBe("SQLite");
    // The key still reads `<agentId>:<id>`, and the stored shape accepts it.
    expect(decision.key).toBe(`${decision.agentId}:${decision.id}`);
    expect(StoredDecisionSchema.parse(decision).agentRole).toBe("external");
    expect(parseTrackerKey(KEY)).toEqual({ project: PROJECT, ticket: "NO-001", cardId: "pick-db" });
    expect(parseTrackerKey("owner-1:pick-db")).toBeNull();
    // Derived on every build, never stored.
    const state = stateOver([]);
    await loadBoard(paseo, state as unknown as PluginState, PROJECT);
    expect(state.updateDecisions).not.toHaveBeenCalled();
  });

  it("getDecision and questionsToCarry accept the key", async () => {
    await seed();
    const state = stateOver([]);
    const found = await findDecision(state as unknown as PluginState, KEY);
    expect(found?.key).toBe(KEY);
    expect(found?.status).toBe("open");
    expect(await findDecision(state as unknown as PluginState, `tracker:${PROJECT}/NO-001:nothing`)).toBeNull();
    const withdrawn = { ...(found as StoredDecision), status: "withdrawn" as const, withdrawnWithAgent: true };
    expect(questionsToCarry([withdrawn, paseoDecision("owner-1", "other")], PROJECT, "NO-001")).toEqual([]);
  });

  it("external is not a role label", () => {
    expect(roleFromLabel("external")).toBeNull();
    expect((ROLES as readonly string[]).includes("external")).toBe(false);
    expect(RoleSchema.safeParse("external").success).toBe(false);
    expect(identityFromLabels({ "taro.project": PROJECT, "taro.role": "external", "taro.ticket": "NO-001" }, "NO-001 · external")).toBeNull();
  });

  it("shows on board and inbox", async () => {
    await seed();
    const state = stateOver([]) as unknown as PluginState;
    const board = await loadBoard(paseo, state, PROJECT);
    const card = board.cards.find((each) => each.id === "NO-001");
    expect(card?.decisions.map((decision) => decision.key)).toEqual([KEY]);
    expect(card?.column).toBe("needs-you");
    expect(board.ticketQuestions).toBe(1);
    expect((await liveOpenDecisions(paseo, state, PROJECT)).map((decision) => decision.key)).toEqual([KEY]);
    expect((await liveOpenDecisions(paseo, state, null)).map((decision) => decision.key)).toEqual([KEY]);
    // The live-agent filter lets a tracker card through with no Paseo agent behind it.
    expect(decisionsOfLiveAgents([trackerDecision(PROJECT, "NO-001", await storedCard())], new Set()).length).toBe(1);
  });

  it("tracker card wins a clash", async () => {
    await seed();
    vi.mocked(projectAgents).mockResolvedValue([{ id: "owner-1", status: "idle", labels: { "taro.project": PROJECT, "taro.role": "owner", "taro.ticket": "NO-001" }, pendingPermissions: [], updatedAt: "2026-11-22T09:00:00Z" } as unknown as PaseoAgent]);
    const state = stateOver([paseoDecision("owner-1", "pick-db"), paseoDecision("owner-1", "other")]) as unknown as PluginState;
    const board = await loadBoard(paseo, state, PROJECT);
    expect(board.cards.find((each) => each.id === "NO-001")?.decisions.map((decision) => decision.key).sort()).toEqual([KEY, "owner-1:other"].sort());
    expect(board.ticketQuestions).toBe(2);
    expect((await liveOpenDecisions(paseo, state, PROJECT)).map((decision) => decision.key).sort()).toEqual([KEY, "owner-1:other"].sort());
  });

  it("withdrawn tracker card not shown", async () => {
    await seed();
    const actions = actionsOver(stateOver([]));
    await actions.dismissDecision(paseo, KEY);
    invalidateBoards();
    const state = stateOver([]) as unknown as PluginState;
    expect((await loadBoard(paseo, state, PROJECT)).cards.find((each) => each.id === "NO-001")?.decisions).toEqual([]);
    expect(await liveOpenDecisions(paseo, state, PROJECT)).toEqual([]);
  });

  it("a Done ticket's card is not shown", async () => {
    await seed("Done");
    const state = stateOver([]) as unknown as PluginState;
    expect((await loadBoard(paseo, state, PROJECT)).cards.find((each) => each.id === "NO-001")?.decisions).toEqual([]);
    expect(await liveOpenDecisions(paseo, state, PROJECT)).toEqual([]);
  });
});

describe("answering a tracker card from Paseo", () => {
  it("button writes the ticket", async () => {
    await seed();
    await actionsOver(stateOver([])).answerDecision(paseo, KEY, "SQLite", "with WAL", "screen");
    const card = await storedCard();
    expect(card.status).toBe("answered");
    expect(card.answer).toMatchObject({ label: "SQLite", text: "with WAL", by: "the user, from the Taro screen" });
  });

  it("no agent is messaged", async () => {
    await seed();
    const state = stateOver([]);
    const supervisor = { withdrawDecisionsOf: vi.fn(async () => undefined) };
    const actions = actionsOver(state, supervisor);
    await actions.answerDecision(paseo, KEY, "Postgres", "", "screen");
    expect(sendUserAnswer).not.toHaveBeenCalled();
    expect(sendFromPlugin).not.toHaveBeenCalled();
    expect(isAgentGone).not.toHaveBeenCalled();
    expect(fetchLiveAgent).not.toHaveBeenCalled();
    expect(supervisor.withdrawDecisionsOf).not.toHaveBeenCalled();
    expect(state.decision).not.toHaveBeenCalled();
    expect(state.updateDecisions).not.toHaveBeenCalled();
  });

  it("dismiss withdraws", async () => {
    await seed();
    const state = stateOver([]);
    await actionsOver(state).dismissDecision(paseo, KEY);
    expect((await storedCard()).status).toBe("withdrawn");
    expect(sendFromPlugin).not.toHaveBeenCalled();
    expect(state.updateDecisions).not.toHaveBeenCalled();
    await expect(actionsOver(state).dismissDecision(paseo, KEY)).rejects.toThrow(/no longer open/);
  });

  it("answer note written", async () => {
    await seed();
    await actionsOver(stateOver([])).answerDecision(paseo, KEY, "SQLite", "", "tab");
    const answers = ticketText()
      .split("\n")
      .filter((line) => line.startsWith("ANSWER "));
    expect(answers).toHaveLength(1);
    expect(answers[0]).toContain('pick-db: "Which database?" → SQLite ("Use SQLite") (the user, from the agent\'s tab)');
  });

  it("several answers refused", async () => {
    await seed();
    await expect(actionsOver(stateOver([])).answerDecision(paseo, KEY, null, "", "screen", [{ header: "a", label: "SQLite", text: "" }])).rejects.toThrow(/one answer/);
    expect((await storedCard()).status).toBe("open");
  });

  it("cli answer closes paseo card", async () => {
    await seed();
    const state = stateOver([]) as unknown as PluginState;
    expect((await loadBoard(paseo, state, PROJECT)).cards.find((each) => each.id === "NO-001")?.decisions).toHaveLength(1);
    await answerCard(cliStore(), "NO-001", "pick-db", { label: "SQLite", text: "", by: "the command line" });
    // What the tracker watch does on the file's change event.
    forgetTicketFile(tracker, "NO-001.md");
    invalidateBoards();
    expect((await loadBoard(paseo, state, PROJECT)).cards.find((each) => each.id === "NO-001")?.decisions).toEqual([]);
    expect(await liveOpenDecisions(paseo, state, PROJECT)).toEqual([]);
  });

  it.each([
    ["button first", true],
    ["command line first", false],
  ])("double answer keeps the first across both paths (%s)", async (_name, buttonFirst) => {
    await seed();
    const button = () => actionsOver(stateOver([])).answerDecision(paseo, KEY, "SQLite", "", "screen");
    const cli = () => answerCard(cliStore(), "NO-001", "pick-db", { label: "Postgres", text: "", by: "the command line" });
    const [first, second] = buttonFirst ? [button, cli] : [cli, button];
    const results = await Promise.allSettled([first(), second()]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason)).toMatch(/no longer open/);
    const winner = results[0]?.status === "fulfilled" ? (buttonFirst ? "SQLite" : "Postgres") : buttonFirst ? "Postgres" : "SQLite";
    expect((await storedCard()).answer?.label).toBe(winner);
    expect(ticketText().split("\n").filter((line) => line.startsWith("ANSWER "))).toHaveLength(1);
  });
});

describe("recorded agents and reads", () => {
  it("recorded agent listed", async () => {
    await seed();
    await recordAgent(cliStore(), "NO-001", { name: "scout", job: "other", task: "Read the schema", host: "claude-code" }, { now: () => new Date("2026-11-22T10:05:00Z") });
    await recordAgent(cliStore(), "NO-001", { name: "builder", job: "implementer", task: "Build the table" });
    const detail = await loadTicketDetail(paseo, PROJECT, "NO-001");
    expect(detail.trackerAgents?.map((agent) => [agent.name, agent.job, agent.task, agent.host])).toEqual([
      ["scout", "other", "Read the schema", "claude-code"],
      ["builder", "implementer", "Build the table", "external"],
    ]);
    expect(detail.trackerCards?.map((card) => card.id)).toEqual(["pick-db"]);
    const rows = recordedAgentRows(detail.trackerAgents ?? [], Date.parse("2026-11-22T10:10:00Z"));
    expect(rows.map((row) => [row.label, row.detail])).toEqual([
      ["Agent read the schema", "running · claude-code"],
      ["Implementer build the table", "running · external"],
    ]);
    // Paseo's own agents are drawn as before: no recorded agent among them.
    const card = (await loadBoard(paseo, stateOver([]) as unknown as PluginState, PROJECT)).cards.find((each) => each.id === "NO-001");
    expect(card?.subagents).toEqual([]);
    expect(card?.owner).toBeNull();
  });

  it("no extra ticket reads", async () => {
    await seed();
    const store = cliStore();
    await store.create({ title: "Without cards", status: "In Progress" });
    const state = stateOver([]) as unknown as PluginState;
    vi.mocked(viewTicket).mockClear();
    await loadBoard(paseo, state, PROJECT);
    // One read a ticket, cards or none: the cards come from the parse the board already does.
    expect(vi.mocked(viewTicket).mock.calls.map((call) => call[1]).sort()).toEqual(["NO-001", "NO-002"]);
    vi.mocked(viewTicket).mockClear();
    await liveOpenDecisions(paseo, state, PROJECT);
    expect(viewTicket).not.toHaveBeenCalled();
  });
});

describe("stale marks", () => {
  const card = (askedAt: string, status: TrackerCard["status"] = "open"): TrackerCard => ({ id: "c", host: "x", question: "q", why: "", options: [], recommended: null, reason: "", askedAt, status, answer: null });
  const agent = (startedAt: string, state: TrackerAgent["state"] = "running"): TrackerAgent => ({ name: "a", host: "x", job: "other", task: "", state, startedAt, finishedAt: null });
  const now = Date.parse("2026-11-22T12:00:00Z");

  it("stale card", () => {
    expect(isStaleTrackerDecision(trackerDecision(PROJECT, "NO-001", card("2026-11-21T11:00:00Z")), now)).toBe(true);
    expect(isStaleTrackerDecision(trackerDecision(PROJECT, "NO-001", card("2026-11-21T13:00:00Z")), now)).toBe(false);
    expect(isStaleTrackerDecision(trackerDecision(PROJECT, "NO-001", card("2026-11-21T11:00:00Z", "answered")), now)).toBe(false);
    // A Paseo question is never marked: the plugin knows whether its agent lives.
    expect(isStaleTrackerDecision(paseoDecision("owner-1", "old"), now + 1e10)).toBe(false);
  });

  it("stale agent", () => {
    expect(isStaleRecordedAgent(agent("2026-11-21T11:00:00Z"), now)).toBe(true);
    expect(isStaleRecordedAgent(agent("2026-11-21T13:00:00Z"), now)).toBe(false);
    expect(isStaleRecordedAgent(agent("2026-11-21T11:00:00Z", "done"), now)).toBe(false);
    expect(recordedAgentRows([agent("2026-11-21T11:00:00Z")], now)[0]?.detail).toBe("running · x · stale");
  });
});
