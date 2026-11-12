// TR-263: the plugin stops a ticket's test daemons when the ticket closes or its owner is archived.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actions } from "./actions";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { stopTicketDaemons } from "./test-daemon-cleanup";
import { listTickets } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", async (original) => ({
  ...(await original<typeof import("./agents")>()),
  fetchLiveAgent: vi.fn(async () => null),
  projectAgents: vi.fn(async () => []),
  projectArchivedAgents: vi.fn(async () => []),
  listTaroAgents: vi.fn(async () => []),
}));
vi.mock("./projects", () => ({
  listProjectConfigs: async () => [{ project: "demo" }],
  projectPaths: async () => ({ tracker: "/tracker" }),
  requireProjectConfig: async () => ({ project: "demo", managerAgentId: "manager", managerWorkspaceId: "ws-manager", maxParallelOwners: 2 }),
}));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: async () => ({ dependencies: [] }), appendTicketNote: vi.fn() }));
vi.mock("./test-daemon-cleanup", () => ({ stopTicketDaemons: vi.fn(async () => undefined) }));

const ticket = (id: string, status: string) => ({ id, title: id, status, labels: [], parentTaskId: null, acceptanceCriteriaCompleted: 0, acceptanceCriteriaCount: 0, createdAt: null, updatedAt: null, priority: null, dependencies: [] });

let actions: Actions;
let paseo: PaseoApi;

beforeEach(() => {
  vi.mocked(stopTicketDaemons).mockClear();
  paseo = {
    agents: {
      ref: (id: string) => ({
        refresh: async () => ({ agent: { id, labels: { "taro.project": "demo", "taro.role": id === "owner" ? "owner" : "implementer", "taro.ticket": "DM-1" } } as unknown as PaseoAgent }),
        archive: async () => undefined,
      }),
    },
    workspaces: { archive: async () => undefined },
  } as unknown as PaseoApi;
  const state = { forgetAgent: async () => undefined, updateDecisions: async () => undefined, ticketStatuses: async () => null, saveTicketStatuses: async () => undefined } as unknown as PluginState;
  const stats = { transition: async () => undefined, agentUsage: async () => undefined, recordedStatuses: async () => null } as unknown as Stats;
  actions = new Actions(state, {} as Supervisor, {} as TrackerWatch, stats, { tellManagerWhenHeadroom: async () => undefined } as unknown as Recovery);
});

describe("test daemons", () => {
  it("are stopped when their ticket becomes Done or Cancelled", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "In Progress"), ticket("DM-2", "In Progress"), ticket("DM-3", "In Progress")]);
    await actions.primeStatuses();
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done"), ticket("DM-2", "Cancelled"), ticket("DM-3", "Awaiting acceptance")]);
    await actions.onTrackerChanged(paseo, "demo");
    expect(vi.mocked(stopTicketDaemons).mock.calls).toEqual([
      ["demo", "DM-1", "DM-1 is Done"],
      ["demo", "DM-2", "DM-2 is Cancelled"],
    ]);
  });

  it("are stopped when the ticket's owner is archived, not when a subagent is", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "In Progress")]);
    await actions.onOwnerArchived(paseo, "implementer-1");
    expect(stopTicketDaemons).not.toHaveBeenCalled();
    await actions.onOwnerArchived(paseo, "owner");
    expect(vi.mocked(stopTicketDaemons).mock.calls).toEqual([["demo", "DM-1", "its owner was archived"]]);
  });
});
