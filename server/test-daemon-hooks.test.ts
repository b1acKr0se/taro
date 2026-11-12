// TR-263: the plugin stops a ticket's test daemons when the ticket closes or its owner is archived.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actions } from "./actions";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { stopOwnerDaemons, stopTicketDaemons } from "./test-daemon-cleanup";
import { daemonRecordPath } from "./test-daemons";
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
vi.mock("./test-daemon-cleanup", () => ({ stopTicketDaemons: vi.fn(async () => undefined), stopOwnerDaemons: vi.fn(async () => undefined) }));

const ticket = (id: string, status: string) => ({ id, title: id, status, labels: [], parentTaskId: null, acceptanceCriteriaCompleted: 0, acceptanceCriteriaCount: 0, createdAt: null, updatedAt: null, priority: null, dependencies: [] });

let actions: Actions;
let paseo: PaseoApi;

beforeEach(() => {
  vi.mocked(stopTicketDaemons).mockClear();
  vi.mocked(stopOwnerDaemons).mockClear();
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
    expect(stopOwnerDaemons).not.toHaveBeenCalled();
    await actions.onOwnerArchived(paseo, "owner");
    expect(vi.mocked(stopOwnerDaemons).mock.calls).toEqual([["demo", "DM-1", "its owner was archived"]]);
  });

  it("of an archived owner's child tickets are stopped with its own, not those of a ticket whose id only starts the same", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "taro-owner-daemons-"));
    const previous = { PASEO_HOME: process.env.PASEO_HOME, PASEO_CLI: process.env.PASEO_CLI };
    try {
      process.env.PASEO_HOME = join(scratch, "paseo-home");
      // A stub paseo that only logs: these records have no pid, so it is never asked to stop anything.
      process.env.PASEO_CLI = join(scratch, "no-paseo");
      const recordOf = (id: string) => daemonRecordPath(join(scratch, "paseo-home", "plugin-data", "taro"), "demo", id);
      const homes = new Map<string, string>();
      for (const id of ["DM-1", "DM-1.02", "DM-1.02.01", "DM-12", "DM-2"]) {
        const home = join(scratch, `home-${id}`);
        homes.set(id, home);
        mkdirSync(join(recordOf(id), ".."), { recursive: true });
        writeFileSync(recordOf(id), JSON.stringify([{ home, port: 6851, pid: null, startedAt: "2026-11-12T07:00:00.000Z", startedBy: null }]));
      }
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const actual = await vi.importActual<typeof import("./test-daemon-cleanup")>("./test-daemon-cleanup");
      await actual.stopOwnerDaemons("demo", "dm-1", "its owner was archived");
      expect(["DM-1", "DM-1.02", "DM-1.02.01", "DM-12", "DM-2"].map((id) => existsSync(recordOf(id)))).toEqual([false, false, false, true, true]);
      expect(log.mock.calls.map((call) => String(call[0]))).toEqual([
        `[taro] stopped DM-1's test daemon ${homes.get("DM-1")} (port 6851) because its owner was archived: nothing left to kill`,
        `[taro] stopped DM-1.02's test daemon ${homes.get("DM-1.02")} (port 6851) because the owner of its parent DM-1 was archived: nothing left to kill`,
        `[taro] stopped DM-1.02.01's test daemon ${homes.get("DM-1.02.01")} (port 6851) because the owner of its parent DM-1 was archived: nothing left to kill`,
      ]);
      log.mockRestore();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
