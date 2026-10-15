// TR-024: a Done ticket releases its owner even when the owner is mid-turn as Done lands, or the
// transition to Done was missed (a reload, a commit that arrives with the status already Done).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actions } from "./actions";
import { fetchLiveAgent, listTaroAgents, projectAgents, projectArchivedAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { listTickets } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", async (original) => ({
  ...(await original<typeof import("./agents")>()),
  fetchLiveAgent: vi.fn(async () => null),
  projectAgents: vi.fn(),
  projectArchivedAgents: vi.fn(async () => []),
  listTaroAgents: vi.fn(),
}));
vi.mock("./projects", () => ({
  listProjectConfigs: async () => [{ project: "demo" }],
  projectPaths: async () => ({ tracker: "/tracker" }),
  requireProjectConfig: async () => ({ project: "demo", managerAgentId: "manager", managerWorkspaceId: "ws-manager" }),
}));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: async () => ({ dependencies: [] }), appendTicketNote: vi.fn() }));

const ticket = (id: string, status: string) => ({ id, title: id, status, labels: [], parentTaskId: null, acceptanceCriteriaCompleted: 0, acceptanceCriteriaCount: 0, createdAt: null, updatedAt: null, priority: null, dependencies: [] });
const agent = (id: string, ticketId: string, role: string, workspaceId: string, status = "idle") =>
  ({ id, status, workspaceId, labels: { "taro.project": "demo", "taro.role": role, "taro.ticket": ticketId }, lastUsage: null }) as unknown as PaseoAgent;

let live: PaseoAgent[];
/** Agents in Paseo without Taro's labels, such as the user's own. */
let others: PaseoAgent[];
let archivedAgents: string[];
let archivedWorkspaces: string[];
let paseo: PaseoApi;
let actions: Actions;

beforeEach(() => {
  live = [];
  others = [];
  archivedAgents = [];
  archivedWorkspaces = [];
  vi.mocked(projectAgents).mockImplementation(async () => [...live]);
  vi.mocked(projectArchivedAgents).mockImplementation(async () => []);
  vi.mocked(listTaroAgents).mockImplementation(async () => [...live, ...others]);
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => live.find((candidate) => candidate.id === id) ?? null);
  paseo = {
    agents: {
      ref: (id: string) => ({
        archive: async () => {
          archivedAgents.push(id);
          live = live.filter((candidate) => candidate.id !== id);
        },
      }),
    },
    workspaces: { archive: async (id: string) => void archivedWorkspaces.push(id) },
  } as unknown as PaseoApi;
  const state = { forgetAgent: async () => undefined, updateDecisions: async () => undefined, ticketStatuses: async () => null, saveTicketStatuses: async () => undefined } as unknown as PluginState;
  const stats = { transition: async () => undefined, agentUsage: async () => undefined } as unknown as Stats;
  actions = new Actions(state, {} as Supervisor, {} as TrackerWatch, stats, { tellManagerWhenHeadroom: async () => undefined } as unknown as Recovery);
});

describe("Done releases the ticket's agents", () => {
  it("archives an owner that was mid-turn when Done landed, once its turn ends", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "In Progress")]);
    await actions.primeStatuses();
    live = [agent("owner", "DM-1", "owner", "ws-1", "running")];
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done")]);
    await actions.onTrackerChanged(paseo, "demo");
    expect(archivedAgents).toEqual([]);

    live = [agent("owner", "DM-1", "owner", "ws-1", "idle")];
    await actions.onAgentTurnEnded(paseo, "owner");
    expect(archivedAgents).toEqual(["owner"]);
    expect(archivedWorkspaces).toEqual(["ws-1"]);
  });

  it("archives an idle owner of a ticket that was already Done when first seen", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done"), ticket("DM-2", "In Progress")]);
    await actions.primeStatuses();
    live = [agent("owner", "DM-1", "owner", "ws-1"), agent("other", "DM-2", "owner", "ws-2")];
    await actions.onTrackerChanged(paseo, "demo");
    expect(archivedAgents).toEqual(["owner"]);
    expect(archivedWorkspaces).toEqual(["ws-1"]);
  });

  it("releases leftovers once after a start", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done")]);
    live = [agent("owner", "DM-1", "owner", "ws-1")];
    await actions.catchUpAfterStart(paseo);
    expect(archivedAgents).toEqual(["owner"]);
  });

  it("archives an agent once although Paseo still lists it for a moment after archiving", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done")]);
    await actions.primeStatuses();
    const owner = agent("owner", "DM-1", "owner", "ws-1");
    vi.mocked(projectAgents).mockImplementation(async () => [owner]);
    vi.mocked(fetchLiveAgent).mockImplementation(async () => owner);
    await Promise.all([actions.onTrackerChanged(paseo, "demo"), actions.onAgentTurnEnded(paseo, "owner")]);
    expect(archivedAgents).toEqual(["owner"]);
    expect(archivedWorkspaces).toEqual(["ws-1"]);
  });

  it("counts only real archives, keeps the workspace of a failed one and tries again on the next release", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done")]);
    await actions.primeStatuses();
    live = [agent("owner", "DM-1", "owner", "ws-1")];
    let failures = 1;
    const archive = paseo.agents.ref("owner").archive;
    paseo.agents.ref = (() => ({ archive: async () => (failures-- > 0 ? Promise.reject(new Error("busy")) : archive()) })) as unknown as PaseoApi["agents"]["ref"];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await actions.onTrackerChanged(paseo, "demo");
    expect(archivedAgents).toEqual([]);
    expect(archivedWorkspaces).toEqual([]);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining("archived 0 agents and 0 workspaces; 1 failed to archive, retried on the next release; kept 1 workspaces"));
    await actions.onAgentTurnEnded(paseo, "owner");
    expect(archivedAgents).toEqual(["owner"]);
    expect(archivedWorkspaces).toEqual(["ws-1"]);
    expect(log).toHaveBeenLastCalledWith("[taro] demo: DM-1: archived 1 agents and 1 workspaces; 0 mid-turn, archived when their turn ends");
    log.mockRestore();
  });

  it("keeps a workspace where an agent without Taro's labels still lives", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done")]);
    await actions.primeStatuses();
    live = [agent("owner", "DM-1", "owner", "ws-1")];
    others = [{ id: "mine", status: "idle", workspaceId: "ws-1", labels: {} } as unknown as PaseoAgent];
    await actions.onTrackerChanged(paseo, "demo");
    expect(archivedAgents).toEqual(["owner"]);
    expect(archivedWorkspaces).toEqual([]);
  });

  it("keeps the workspaces when Paseo cannot list its agents", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done")]);
    await actions.primeStatuses();
    live = [agent("owner", "DM-1", "owner", "ws-1")];
    vi.mocked(listTaroAgents).mockRejectedValue(new Error("offline"));
    await actions.onTrackerChanged(paseo, "demo");
    expect(archivedAgents).toEqual(["owner"]);
    expect(archivedWorkspaces).toEqual([]);
  });

  it("leaves an agent alone at its turn end while its ticket is open", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "In Progress")]);
    await actions.primeStatuses();
    live = [agent("owner", "DM-1", "owner", "ws-1")];
    await actions.onAgentTurnEnded(paseo, "owner");
    expect(archivedAgents).toEqual([]);
  });
});
