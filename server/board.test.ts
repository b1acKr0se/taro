// TR-016: the board draws owners and decisions from live agents only, and a ticket's archived agents beside them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredDecision } from "../shared/state";
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

const state = (decisions: StoredDecision[]) => ({ allDecisions: async () => decisions, allAgents: async () => ({}) }) as unknown as PluginState;
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
