// TR-128: a wake-up sent while the manager is being replaced waits for the replacement and reaches
// the new manager; with no live manager it is retried at the next pass instead of being dropped.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actions } from "./actions";
import { fetchLiveAgent, listTaroAgents, projectAgents, projectArchivedAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import { serialized } from "./serialize";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { listTickets, viewTicket } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

const config = { project: "demo", managerAgentId: "manager-old", managerWorkspaceId: "ws-manager", maxParallelOwners: 2 };

vi.mock("./agents", async (original) => ({
  ...(await original<typeof import("./agents")>()),
  fetchLiveAgent: vi.fn(),
  projectAgents: vi.fn(async () => []),
  projectArchivedAgents: vi.fn(async () => []),
  listTaroAgents: vi.fn(async () => []),
}));
vi.mock("./projects", () => ({
  listProjectConfigs: async () => [{ project: "demo" }],
  projectPaths: async () => ({ tracker: "/tracker" }),
  requireProjectConfig: async () => ({ ...config }),
}));
vi.mock("./headroom", () => ({ readHeadroom: async () => null }));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn(), appendTicketNote: vi.fn(async () => undefined) }));
vi.mock("./package-files", async (original) => ({
  ...(await original<typeof import("./package-files")>()),
  message: async (path: string, values: Record<string, string>) => JSON.stringify({ path, ...values }),
}));

const ticket = (id: string, status: string) => ({
  id,
  title: id,
  status,
  labels: [],
  parentTaskId: null,
  acceptanceCriteriaCompleted: 0,
  acceptanceCriteriaCount: 0,
  createdAt: null,
  updatedAt: null,
  priority: null,
  dependencies: [],
});
const managerAgent = (id: string) => ({ id, status: "idle", labels: {}, workspaceId: "ws-manager" }) as unknown as PaseoAgent;
const before = [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")];
const after = [ticket("DM-1", "Done"), ticket("DM-2", "Queued")];
const paseo = { agents: { ref: () => ({ archive: async () => undefined }) }, workspaces: { archive: async () => undefined } } as unknown as PaseoApi;

/** The managers Paseo has live, by id; a replacement archives one and adds another. */
let liveManagers: Set<string>;
/** Each wake-up as the manager id it went to and the ticket it was about. */
let told: { manager: string; ticket: string }[];
let actions: Actions;

function start(): Actions {
  const stored = new Map<string, ReadonlyMap<string, string>>();
  const state = {
    forgetAgent: async () => undefined,
    updateDecisions: async () => undefined,
    ticketStatuses: async (project: string) => stored.get(project) ?? null,
    saveTicketStatuses: async (project: string, statuses: ReadonlyMap<string, string>) => void stored.set(project, new Map(statuses)),
  } as unknown as PluginState;
  const stats = { transition: async () => undefined, agentUsage: async () => undefined, recordedStatuses: async () => null } as unknown as Stats;
  const recovery = {
    tellManagerWhenHeadroom: async (_paseo: PaseoApi, _project: string, manager: string, text: string, onSent?: () => void) => {
      if (!liveManagers.has(manager)) throw new Error(`${manager} is archived`);
      told.push({ manager, ticket: (JSON.parse(text) as { ticket: string }).ticket });
      onSent?.();
    },
  } as unknown as Recovery;
  return new Actions(state, {} as Supervisor, {} as TrackerWatch, stats, recovery);
}

beforeEach(() => {
  config.managerAgentId = "manager-old";
  liveManagers = new Set(["manager-old"]);
  told = [];
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (id !== null && liveManagers.has(id) ? managerAgent(id) : null));
  vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => ({ dependencies: id === "DM-2" ? ["DM-1"] : [] }) as unknown as Awaited<ReturnType<typeof viewTicket>>);
  actions = start();
});

describe("a wake-up during a manager replacement", () => {
  it("waits for the replacement and reaches the new manager", async () => {
    vi.mocked(listTickets).mockResolvedValue(before);
    await actions.primeStatuses();
    // A replacement in progress holds the manager lock, as restartManager does, while it archives and starts.
    let finish: () => void = () => undefined;
    const replacing = serialized("manager:demo", async () => {
      liveManagers.delete("manager-old");
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      liveManagers.add("manager-new");
      config.managerAgentId = "manager-new";
    });
    vi.mocked(listTickets).mockResolvedValue(after);
    const pass = actions.onTrackerChanged(paseo, "demo");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(told).toEqual([]);
    finish();
    await replacing;
    await pass;
    expect(told).toEqual([{ manager: "manager-new", ticket: "DM-1" }]);
  });

  it("is retried at the next pass when no manager is live, not dropped", async () => {
    vi.mocked(listTickets).mockResolvedValue(before);
    await actions.primeStatuses();
    liveManagers.clear();
    vi.mocked(listTickets).mockResolvedValue(after);
    await actions.onTrackerChanged(paseo, "demo");
    expect(told).toEqual([]);

    liveManagers.add("manager-new");
    config.managerAgentId = "manager-new";
    await actions.onTrackerChanged(paseo, "demo");
    expect(told).toEqual([{ manager: "manager-new", ticket: "DM-1" }]);
  });

  it("is sent once, not again at a later pass, once a manager took it", async () => {
    vi.mocked(listTickets).mockResolvedValue(before);
    await actions.primeStatuses();
    vi.mocked(listTickets).mockResolvedValue(after);
    await actions.onTrackerChanged(paseo, "demo");
    await actions.onTrackerChanged(paseo, "demo");
    expect(told).toEqual([{ manager: "manager-old", ticket: "DM-1" }]);
  });
});
