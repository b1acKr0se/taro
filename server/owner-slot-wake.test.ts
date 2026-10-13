// TR-029: a ticket reaching Awaiting acceptance frees its owner's slot and wakes the manager; a
// child reaching Done never claims a slot, since children have no owner of their own.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actions } from "./actions";
import { fetchLiveAgent, listTaroAgents, projectAgents, projectArchivedAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { listTickets, viewTicket } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", async (original) => ({
  ...(await original<typeof import("./agents")>()),
  fetchLiveAgent: vi.fn(),
  projectAgents: vi.fn(),
  projectArchivedAgents: vi.fn(async () => []),
  listTaroAgents: vi.fn(),
}));
vi.mock("./projects", () => ({
  listProjectConfigs: async () => [{ project: "demo" }],
  projectPaths: async () => ({ tracker: "/tracker" }),
  requireProjectConfig: async () => ({ project: "demo", managerAgentId: "manager", managerWorkspaceId: "ws-manager", maxParallelOwners: 2 }),
}));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn(), appendTicketNote: vi.fn() }));
vi.mock("./package-files", async (original) => ({
  ...(await original<typeof import("./package-files")>()),
  message: async (path: string, values: Record<string, string>) => JSON.stringify({ path, ...values }),
}));

const ticket = (id: string, status: string, parentTaskId: string | null = null) => ({
  id,
  title: id,
  status,
  labels: [],
  parentTaskId,
  acceptanceCriteriaCompleted: 0,
  acceptanceCriteriaCount: 0,
  createdAt: null,
  updatedAt: null,
  isReady: true,
});
const agent = (id: string, ticketId: string, role: string, status = "running") =>
  ({ id, status, workspaceId: `ws-${id}`, labels: { "taro.project": "demo", "taro.role": role, "taro.ticket": ticketId }, lastUsage: null }) as unknown as PaseoAgent;
const manager = { id: "manager", status: "idle", labels: {}, workspaceId: "ws-manager" } as unknown as PaseoAgent;

let live: PaseoAgent[];
let told: Record<string, string>[];
let dependencies: Record<string, string[]>;
let actions: Actions;
const paseo = { agents: { ref: () => ({ archive: async () => undefined }) }, workspaces: { archive: async () => undefined } } as unknown as PaseoApi;

async function move(before: ReturnType<typeof ticket>[], after: ReturnType<typeof ticket>[]): Promise<void> {
  vi.mocked(listTickets).mockResolvedValue(before);
  await actions.primeStatuses();
  vi.mocked(listTickets).mockResolvedValue(after);
  await actions.onTrackerChanged(paseo, "demo");
}

beforeEach(() => {
  live = [];
  told = [];
  dependencies = {};
  vi.mocked(projectAgents).mockImplementation(async () => [...live]);
  vi.mocked(projectArchivedAgents).mockImplementation(async () => []);
  vi.mocked(listTaroAgents).mockImplementation(async () => [...live]);
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (id === "manager" ? manager : live.find((candidate) => candidate.id === id) ?? null));
  vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => ({ dependencies: dependencies[id] ?? [] }) as unknown as Awaited<ReturnType<typeof viewTicket>>);
  const state = { forgetAgent: async () => undefined, updateDecisions: async () => undefined } as unknown as PluginState;
  const stats = { transition: async () => undefined, agentFinal: async () => undefined } as unknown as Stats;
  const recovery = { tellManagerWhenHeadroom: async (_paseo: PaseoApi, _project: string, _manager: string, text: string) => void told.push(JSON.parse(text) as Record<string, string>) } as unknown as Recovery;
  actions = new Actions(state, {} as Supervisor, {} as TrackerWatch, stats, recovery);
});

describe("a freed owner slot wakes the manager", () => {
  it("wakes it when a ticket reaches Awaiting acceptance, with the count leaving that owner out", async () => {
    live = [agent("one", "DM-1", "owner", "idle"), agent("two", "DM-2", "owner")];
    await move(
      [ticket("DM-1", "Reviewing"), ticket("DM-2", "In Progress"), ticket("DM-3", "Backlog")],
      [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "In Progress"), ticket("DM-3", "Backlog")],
    );
    expect(told).toEqual([
      { path: "messages/dependency-cleared.md", ticket: "DM-1", status: "Awaiting acceptance", dependents: "none", queued: "DM-3", counting: "1", cap: "2", countingTickets: "DM-2" },
    ]);
  });

  it("stays quiet when no ticket is queued", async () => {
    live = [agent("one", "DM-1", "owner", "idle")];
    await move([ticket("DM-1", "Reviewing")], [ticket("DM-1", "Awaiting acceptance")]);
    expect(told).toEqual([]);
  });

  it("stays quiet when the owners still counting fill the cap", async () => {
    live = [agent("one", "DM-1", "owner", "idle"), agent("two", "DM-2", "owner"), agent("three", "DM-3", "owner")];
    await move(
      [ticket("DM-1", "Reviewing"), ticket("DM-2", "In Progress"), ticket("DM-3", "Planning"), ticket("DM-4", "Backlog")],
      [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "In Progress"), ticket("DM-3", "Planning"), ticket("DM-4", "Backlog")],
    );
    expect(told).toEqual([]);
  });

  it("does not wake again for a slot when an accepted ticket goes from Awaiting acceptance to Done", async () => {
    await move([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Backlog")], [ticket("DM-1", "Done"), ticket("DM-2", "Backlog")]);
    expect(told).toEqual([]);
  });

  it("still wakes it for tickets that depended on the accepted one", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    await move([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Backlog")], [ticket("DM-1", "Done"), ticket("DM-2", "Backlog")]);
    expect(told.map((entry) => [entry.ticket, entry.status, entry.dependents])).toEqual([["DM-1", "Done", "DM-2"]]);
  });

  const childBefore = [ticket("DM-1", "In Progress"), ticket("DM-1.1", "In Progress", "DM-1"), ticket("DM-2", "Backlog")];
  const childAfter = [ticket("DM-1", "In Progress"), ticket("DM-1.1", "Done", "DM-1"), ticket("DM-2", "Backlog")];

  it("never says a slot is free when a child reaches Done: children have no owner", async () => {
    live = [agent("one", "DM-1", "owner")];
    await move(childBefore, childAfter);
    expect(told).toEqual([]);
  });

  it("wakes it for a child reaching Done when a ticket depended on the child", async () => {
    live = [agent("one", "DM-1", "owner")];
    dependencies = { "DM-2": ["DM-1.1"] };
    await move(childBefore, childAfter);
    expect(told.map((entry) => [entry.ticket, entry.dependents, entry.countingTickets])).toEqual([["DM-1.1", "DM-2", "DM-1"]]);
  });
});
