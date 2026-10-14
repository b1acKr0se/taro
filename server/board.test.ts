// TR-016: the board draws owners and decisions from live agents only, and a ticket's archived agents beside them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredDecision } from "../shared/state";
import type { TrackerProtection } from "../shared/tracker-guard";
import { projectAgents, projectArchivedAgents } from "./agents";
import { invalidateBoards, loadBoard } from "./board";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { PluginState } from "./state";
import { listTickets, viewTicket } from "./tickets";

vi.mock("./agents", () => ({ projectAgents: vi.fn(), projectArchivedAgents: vi.fn() }));
vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: "/tracker", suggestions: "/nonexistent/taro-suggestions.md" }) }));
vi.mock("./headroom", () => ({ readHeadroom: async () => null }));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn() }));

const ticket = (id: string, status: string, updatedAt: string | null = "2026-10-13 15:00") => ({
  id,
  title: id,
  status,
  labels: [],
  parentTaskId: null,
  acceptanceCriteriaCompleted: 0,
  acceptanceCriteriaCount: 0,
  updatedAt,
});

function agent(id: string, role: string, ticketId: string, updatedAt: string, archivedAt: string | null = null): PaseoAgent {
  return {
    id,
    title: `${ticketId} · ${role}`,
    status: "idle",
    provider: "claude",
    pendingPermissions: [],
    updatedAt,
    archivedAt,
    labels: { "taro.role": role, "taro.ticket": ticketId, "taro.project": "taro" },
  } as unknown as PaseoAgent;
}

function stored(agentId: string, ticketId: string): StoredDecision {
  return { key: `${agentId}:scope-approval`, id: "scope-approval", agentId, project: "taro", ticket: ticketId, status: "open", blocking: true } as unknown as StoredDecision;
}

const state = (decisions: StoredDecision[], protection: TrackerProtection | null = null) =>
  ({ allDecisions: async () => decisions, allAgents: async () => ({}), trackerProtection: async () => protection }) as unknown as PluginState;
const notes = "EXECUTION 2026-10-13T14:00Z — owner o\n\nMILESTONE 2026-10-13T14:30Z — tests green";

let now = Date.parse("2026-10-13T15:00:00Z");

beforeEach(() => {
  invalidateBoards();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.mocked(viewTicket).mockReset().mockResolvedValue({ implementationNotes: notes, finalSummary: "" } as unknown as Awaited<ReturnType<typeof viewTicket>>);
  vi.mocked(listTickets).mockReset().mockResolvedValue([ticket("TR-1", "In Progress"), ticket("TR-2", "Done")] as unknown as Awaited<ReturnType<typeof listTickets>>);
  vi.mocked(projectAgents).mockReset().mockResolvedValue([agent("owner-live", "owner", "TR-1", "2026-10-13T14:50:00Z"), agent("reviewer-live", "reviewer", "TR-1", "2026-10-13T14:55:00Z"), agent("legacy-live", "helper", "TR-1", "2026-10-13T14:56:00Z"), agent("researcher-live", "researcher", "TR-1", "2026-10-13T14:57:00Z")]);
  vi.mocked(projectArchivedAgents)
    .mockReset()
    .mockResolvedValue([
      agent("owner-old", "owner", "TR-1", "2026-10-13T13:00:00Z", "2026-10-13T13:05:00Z"),
      agent("owner-done", "owner", "TR-2", "2026-10-13T12:00:00Z", "2026-10-13T12:10:00Z"),
      agent("reviewer-done", "reviewer", "TR-2", "2026-10-13T12:30:00Z", "2026-10-13T12:40:00Z"),
      agent("legacy-done", "helper", "TR-2", "2026-10-13T12:20:00Z", "2026-10-13T12:25:00Z"),
      agent("manager-old", "manager", "TR-2", "2026-10-13T12:50:00Z", "2026-10-13T12:55:00Z"),
    ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadBoard", () => {
  it("takes the owner, subagents (by job, the legacy helper label as implementer) and decisions from live agents and lists archived ones apart", async () => {
    const board = await loadBoard({} as PaseoApi, state([stored("owner-old", "TR-1"), stored("owner-live", "TR-1")]), "taro");
    const [working, done] = board.cards;
    expect(working?.owner?.id).toBe("owner-live");
    expect(working?.decisions.map((decision) => decision.agentId)).toEqual(["owner-live"]);
    expect(working?.subagents.map((subagent) => [subagent.id, subagent.role])).toEqual([
      ["reviewer-live", "reviewer"],
      ["legacy-live", "implementer"],
      ["researcher-live", "researcher"],
    ]);
    expect(working?.pastAgents.map((past) => [past.id, past.role, past.archivedAt])).toEqual([["owner-old", "owner", "2026-10-13T13:05:00Z"]]);
    expect(done?.owner).toBeNull();
    expect(done?.pastAgents.map((past) => [past.id, past.role])).toEqual([
      ["reviewer-done", "reviewer"],
      ["legacy-done", "implementer"],
      ["owner-done", "owner"],
    ]);
  });

  it("draws a child under way from the parent owner's implementer titled with the child (TR-025)", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("TR-1", "In Progress"), { ...ticket("TR-1.01", "In Progress"), parentTaskId: "TR-1" }] as unknown as Awaited<ReturnType<typeof listTickets>>);
    const implementer = { ...agent("builder", "implementer", "TR-1", "2026-10-13T14:58:00Z"), title: "TR-1.01 · implementer: building the list", status: "running" } as PaseoAgent;
    vi.mocked(projectAgents).mockResolvedValue([agent("owner-live", "owner", "TR-1", "2026-10-13T14:50:00Z"), implementer]);
    const board = await loadBoard({} as PaseoApi, state([]), "taro");
    const child = board.cards.find((card) => card.id === "TR-1.01");
    expect(child?.column).toBe("working");
    expect(child?.owner?.id).toBe("owner-live");
    expect(child?.subagents.map((subagent) => subagent.id)).toEqual(["builder"]);
    vi.mocked(projectAgents).mockResolvedValue([]);
    invalidateBoards();
    expect((await loadBoard({} as PaseoApi, state([]), "taro")).cards.find((card) => card.id === "TR-1.01")?.column).toBe("stalled");
  });

  // TR-080: children not started stayed in Working with the parent's status line while the parent's owner ran.
  it("keeps a child not started in Queued with no status line, whatever the parent's owner is doing", async () => {
    const child = (id: string, status: string) => ({ ...ticket(id, status), parentTaskId: "TR-1" });
    vi.mocked(listTickets).mockResolvedValue([ticket("TR-1", "In Progress"), child("TR-1.01", "In Progress"), child("TR-1.02", "Backlog"), child("TR-1.03", "Ready")] as unknown as Awaited<
      ReturnType<typeof listTickets>
    >);
    const lastStatus = { state: "blocked", text: "reviewer on TR-1.01 and implementer building TR-1.02", at: "2026-10-13T14:40:00Z" };
    const states = { allDecisions: async () => [], trackerProtection: async () => null, allAgents: async () => ({ "owner-live": { lastStatus, stalled: true, stalledReason: "crashed" } }) } as unknown as PluginState;
    const columns = async (owner: Partial<PaseoAgent>) => {
      vi.mocked(projectAgents).mockResolvedValue([{ ...agent("owner-live", "owner", "TR-1", "2026-10-13T14:50:00Z"), ...owner } as PaseoAgent]);
      invalidateBoards();
      const board = await loadBoard({ agents: { ref: () => ({ timeline: { refetch: async () => ({ entries: [] }) } }) } } as unknown as PaseoApi, states, "taro");
      return Object.fromEntries(board.cards.map((card) => [card.id, [card.column, card.lastStatus?.text ?? null]]));
    };
    for (const owner of [{ status: "running" }, { status: "idle" }, { status: "running", pendingPermissions: [{ id: "p1", name: "Bash", kind: "tool", input: null }] }]) {
      const placed = await columns(owner as Partial<PaseoAgent>);
      expect(placed["TR-1.02"]).toEqual(["queued", null]);
      expect(placed["TR-1.03"]).toEqual(["queued", null]);
      expect(placed["TR-1.01"]?.[1]).toBe(lastStatus.text);
    }
    expect((await columns({ status: "running" }))["TR-1.01"]?.[0]).toBe("working");
  });

  it("reads a running owner's latest tool call as its activity, and none for an idle one", async () => {
    const refetch = vi.fn(async () => ({
      entries: [
        { item: { type: "tool_call", name: "Bash", detail: { type: "shell", command: "npm test" } }, timestamp: "2026-10-13T14:59:00Z" },
        { item: { type: "assistant_message", text: "Tests are running." }, timestamp: "2026-10-13T14:59:30Z" },
      ],
    }));
    const paseo = { agents: { ref: () => ({ timeline: { refetch } }) } } as unknown as PaseoApi;
    vi.mocked(projectAgents).mockResolvedValue([{ ...agent("owner-live", "owner", "TR-1", "2026-10-13T14:50:00Z"), status: "running" } as PaseoAgent]);
    expect((await loadBoard(paseo, state([]), "taro")).cards[0]?.activity).toEqual({ text: "running tests", at: "2026-10-13T14:59:00Z" });
    vi.mocked(projectAgents).mockResolvedValue([agent("owner-live", "owner", "TR-1", "2026-10-13T14:50:00Z")]);
    invalidateBoards();
    expect((await loadBoard(paseo, state([]), "taro")).cards[0]?.activity).toBeNull();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("judges evidence for Awaiting acceptance cards only", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("TR-1", "Awaiting acceptance"), ticket("TR-3", "In Progress")] as unknown as Awaited<ReturnType<typeof listTickets>>);
    vi.mocked(viewTicket).mockResolvedValue({
      implementationNotes: "EVIDENCE 2026-10-13T14:00Z — x\ncheck: npm test — ok\nreview: self\nscreenshots: none — no visible change",
      finalSummary: "",
    } as unknown as Awaited<ReturnType<typeof viewTicket>>);
    const board = await loadBoard({} as PaseoApi, state([]), "taro");
    expect(board.cards[0]?.evidence).toMatchObject({ complete: true, missing: [], screenshotsNone: "no visible change" });
    expect(board.cards[1]?.evidence).toBeNull();
  });

  // TR-051: what the tracker guard restored is an alert, kept in the plugin's state, for a day.
  it("alerts on a tracker refusal from the last day only", async () => {
    vi.mocked(listTickets).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof listTickets>>);
    const recent = { at: new Date().toISOString(), restored: ['backlog/config.yml (project_name "taro" → "scratch")'] };
    const alerts = (await loadBoard({} as PaseoApi, state([], recent), "taro")).alerts;
    expect(alerts.map((alert) => alert.id)).toEqual(["tracker-protected"]);
    expect(alerts[0]?.text).toContain('project_name "taro" → "scratch"');
    invalidateBoards();
    const old = { ...recent, at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() };
    expect((await loadBoard({} as PaseoApi, state([], old), "taro")).alerts).toEqual([]);
  });

  // TR-045: a card shows what the owner's permission asks and, awaiting acceptance, the delivery in a line.
  it("carries the owner's first pending permission as what it asks, with its request id", async () => {
    const owner = {
      ...agent("owner-live", "owner", "TR-1", "2026-10-13T14:50:00Z"),
      pendingPermissions: [
        { id: "p1", name: "Bash", kind: "tool", input: { command: "npm install\nnpm test" } },
        { id: "p2", name: "Edit", kind: "tool", input: { file_path: "/repo/a.ts" } },
      ],
    } as unknown as PaseoAgent;
    const quiet = { ...agent("owner-3", "owner", "TR-3", "2026-10-13T14:50:00Z"), pendingPermissions: [{ id: "p3", name: "Custom", kind: "tool", input: null }] } as unknown as PaseoAgent;
    vi.mocked(listTickets).mockResolvedValue([ticket("TR-1", "In Progress"), ticket("TR-2", "Done"), ticket("TR-3", "In Progress")] as unknown as Awaited<ReturnType<typeof listTickets>>);
    vi.mocked(projectAgents).mockResolvedValue([owner, quiet]);
    const board = await loadBoard({} as PaseoApi, state([]), "taro");
    expect(board.cards.find((card) => card.id === "TR-1")?.permission).toEqual({ title: "Allow Bash?", detail: "npm install", id: "p1" });
    expect(board.cards.find((card) => card.id === "TR-3")?.permission).toEqual({ title: "Allow Custom?", detail: null, id: "p3" });
    expect(board.cards.find((card) => card.id === "TR-2")?.permission).toBeNull();
  });

  it("fills the delivered line for Awaiting acceptance cards only", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("TR-1", "Awaiting acceptance"), ticket("TR-3", "In Progress")] as unknown as Awaited<ReturnType<typeof listTickets>>);
    vi.mocked(viewTicket).mockResolvedValue({
      implementationNotes: notes,
      finalSummary: "FINAL 2026-10-13T14:40Z — Cards show the question. Tests pass.",
    } as unknown as Awaited<ReturnType<typeof viewTicket>>);
    const board = await loadBoard({} as PaseoApi, state([]), "taro");
    expect(board.cards.find((card) => card.id === "TR-1")?.delivered).toBe("Cards show the question.");
    expect(board.cards.find((card) => card.id === "TR-3")?.delivered).toBeNull();
  });

  it("reads the latest milestone of under-way tickets only", async () => {
    const board = await loadBoard({} as PaseoApi, state([]), "taro");
    expect(board.cards[0]?.latestMilestone).toEqual({ kind: "MILESTONE", time: "2026-10-13T14:30Z", text: "tests green" });
    expect(board.cards[1]?.latestMilestone).toBeNull();
    expect(vi.mocked(viewTicket).mock.calls.map((call) => call[1])).toEqual(["TR-1"]);
  });

  it("reads a ticket's records again only when the ticket changed or a minute passed", async () => {
    await loadBoard({} as PaseoApi, state([]), "taro");
    now += 3_000;
    await loadBoard({} as PaseoApi, state([]), "taro");
    expect(viewTicket).toHaveBeenCalledTimes(1);
    vi.mocked(listTickets).mockResolvedValue([ticket("TR-1", "In Progress", "2026-10-13 15:01")] as unknown as Awaited<ReturnType<typeof listTickets>>);
    now += 3_000;
    await loadBoard({} as PaseoApi, state([]), "taro");
    expect(viewTicket).toHaveBeenCalledTimes(2);
    now += 61_000;
    await loadBoard({} as PaseoApi, state([]), "taro");
    expect(viewTicket).toHaveBeenCalledTimes(3);
  });

  it("lists archived agents at most every half minute, and still draws live owners when that list fails", async () => {
    await loadBoard({} as PaseoApi, state([]), "taro");
    now += 3_000;
    await loadBoard({} as PaseoApi, state([]), "taro");
    expect(projectArchivedAgents).toHaveBeenCalledTimes(1);
    expect(projectAgents).toHaveBeenCalledTimes(2);
    invalidateBoards();
    vi.mocked(projectArchivedAgents).mockRejectedValue(new Error("timeout"));
    const board = await loadBoard({} as PaseoApi, state([]), "taro");
    expect(board.cards[0]?.owner?.id).toBe("owner-live");
    expect(board.cards[0]?.pastAgents).toEqual([]);
  });
});
