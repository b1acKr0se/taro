// A ticket made or worked outside Paseo carries the `external-host` label, and Paseo's automation leaves it alone:
// no owner or manager is messaged or started for it, while the user's own Accept, reopen and changes still record.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXTERNAL_HOST_LABEL, isExternalHostTicket } from "../shared/external-host";
import { Actions } from "./actions";
import { fetchLiveAgent, listTaroAgents, projectAgents, projectArchivedAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { restartManager, tellManager } from "./manager";
import type { Recovery } from "./recovery";
import { sendFromPlugin, sendWithoutInterrupting } from "./send";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { appendTicketNote, listTickets, recordChangesRequested, reopenTicket as reopenTicketRecord, viewTicket } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", async (original) => ({
  ...(await original<typeof import("./agents")>()),
  fetchLiveAgent: vi.fn(),
  projectAgents: vi.fn(),
  projectArchivedAgents: vi.fn(async () => []),
  listTaroAgents: vi.fn(async () => []),
}));
vi.mock("./projects", () => ({
  listProjectConfigs: async () => [{ project: "demo" }],
  projectPaths: async () => ({ tracker: "/tracker", home: "/home/user/taro/demo" }),
  requireProjectConfig: async () => ({ project: "demo", managerAgentId: "manager", managerWorkspaceId: "ws-manager", maxParallelOwners: 3, delivery: "pull-request", acceptAlsoMerges: true, mergeMethod: "merge", baseBranch: "main", repoPath: "/repo" }),
}));
vi.mock("./tickets", () => ({
  listTickets: vi.fn(),
  viewTicket: vi.fn(),
  appendTicketNote: vi.fn(async () => undefined),
  recordChangesRequested: vi.fn(async () => undefined),
  reopenTicket: vi.fn(async () => ({ title: "t", round: 1, pastOwners: [] })),
  closeTicket: vi.fn(async () => undefined),
}));
vi.mock("./headroom", () => ({ readHeadroom: vi.fn(async () => null) }));
vi.mock("./manager", () => ({ restartManager: vi.fn(async () => ({ agentId: "manager-2", workspaceId: "ws-manager" })), tellManager: vi.fn(async () => undefined) }));
vi.mock("./send", () => ({ sendFromPlugin: vi.fn(async () => undefined), sendUserAnswer: vi.fn(async () => undefined), sendWithoutInterrupting: vi.fn(async () => undefined), sendCommand: vi.fn() }));
vi.mock("./evidence", () => ({ requireCompleteEvidence: vi.fn(async () => undefined) }));
vi.mock("./package-files", async (original) => ({
  ...(await original<typeof import("./package-files")>()),
  message: async (path: string, values: Record<string, string>) => JSON.stringify({ path, ...values }),
}));

const MINUTE = 60_000;
const T0 = Date.parse("2026-11-22T10:00:00Z");
const BIN = resolve(import.meta.dirname, "..", "bin", "taro");

const ticket = (id: string, status: string, labels: string[] = []) => ({
  id,
  title: id,
  status,
  labels,
  parentTaskId: null,
  acceptanceCriteriaCompleted: 0,
  acceptanceCriteriaCount: 0,
  createdAt: null,
  updatedAt: "2026-11-22 10:00",
  priority: null,
  dependencies: [] as string[],
});
const owner = (ticketId: string, status = "idle", updatedAt = new Date(T0).toISOString()) =>
  ({ id: `owner-${ticketId}`, status, updatedAt, workspaceId: `ws-${ticketId}`, labels: { "taro.project": "demo", "taro.role": "owner", "taro.ticket": ticketId }, lastUsage: null }) as unknown as PaseoAgent;

const LABELLED = [EXTERNAL_HOST_LABEL];

let tickets: ReturnType<typeof ticket>[];
let owners: PaseoAgent[];
let notes: Record<string, string>;
let told: Record<string, string>[];
let actions: Actions;
let relaunched: string[];
const paseo = {
  agents: { ref: () => ({ timeline: { refetch: async () => ({ entries: [] }) }, archive: async () => undefined }) },
  workspaces: { archive: async () => undefined },
} as unknown as PaseoApi;

function at(minutes: number): number {
  return T0 + minutes * MINUTE;
}

function start(): Actions {
  const state = {
    forgetAgent: async () => undefined,
    updateDecisions: async () => undefined,
    allDecisions: async () => [],
    ticketStatuses: async () => null,
    saveTicketStatuses: async () => undefined,
    agent: async (id: string) => (id === "manager" ? { lastTurnEndedAt: new Date(at(-10)).toISOString(), stalled: false } : null),
    queueLadder: async () => null,
    saveQueueLadder: async () => undefined,
  } as unknown as PluginState;
  const stats = { transition: async () => undefined, agentUsage: async () => undefined, recordedStatuses: async () => null } as unknown as Stats;
  const recovery = {
    tellManagerWhenHeadroom: async (_paseo: PaseoApi, _project: string, _manager: string, text: string, onSent?: () => void) => {
      told.push(JSON.parse(text) as Record<string, string>);
      onSent?.();
    },
  } as unknown as Recovery;
  const created = new Actions(state, { withdrawDecisionsOf: async () => undefined } as unknown as Supervisor, {} as TrackerWatch, stats, recovery);
  vi.spyOn(created, "relaunchOwner").mockImplementation(async (_paseo, _project, id) => {
    relaunched.push(id);
    return `fresh-${id}`;
  });
  return created;
}

function notesWritten(): string[] {
  return vi.mocked(appendTicketNote).mock.calls.map(([, id, record]) => `${id} ${record}`);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  tickets = [ticket("DM-1", "In Progress")];
  owners = [owner("DM-1")];
  notes = {};
  told = [];
  relaunched = [];
  vi.mocked(listTickets).mockImplementation(async () => tickets as never);
  vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => {
    const summary = tickets.find((each) => each.id === id);
    return { ...summary, parentTaskId: null, dependencies: [], implementationNotes: notes[id] ?? null, finalSummary: null } as unknown as Awaited<ReturnType<typeof viewTicket>>;
  });
  vi.mocked(projectAgents).mockImplementation(async () => owners);
  vi.mocked(listTaroAgents).mockImplementation(async () => owners);
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (id === "manager" ? ({ id: "manager", status: "idle", updatedAt: new Date(at(-10)).toISOString(), labels: {} } as unknown as PaseoAgent) : null));
  vi.mocked(projectArchivedAgents).mockImplementation(async () => []);
  for (const mock of [appendTicketNote, recordChangesRequested, reopenTicketRecord, restartManager, tellManager, sendFromPlugin, sendWithoutInterrupting]) vi.mocked(mock).mockClear();
  actions = start();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the external-host label", () => {
  it("names a ticket worked outside Paseo", () => {
    expect(isExternalHostTicket({ labels: ["external-host"] })).toBe(true);
    expect(isExternalHostTicket({ labels: ["complexity-low"] })).toBe(false);
    expect(isExternalHostTicket({ labels: [] })).toBe(false);
    expect(isExternalHostTicket({})).toBe(false);
  });

  describe("on create", () => {
    let tracker = "";
    beforeEach(() => {
      tracker = mkdtempSync(join(tmpdir(), "taro-external-host-"));
    });
    afterEach(() => {
      rmSync(tracker, { recursive: true, force: true });
    });
    const create = (args: string[], agent: string | null) => {
      const env = { ...process.env };
      delete env.PASEO_AGENT_ID;
      delete env.TARO_TRACKER;
      delete env.TARO_PROJECT;
      if (agent !== null) env.PASEO_AGENT_ID = agent;
      const result = spawnSync(BIN, ["ticket", "create", ...args, "--tracker", tracker, "--json"], { encoding: "utf8", env, timeout: 60_000 });
      expect(result.stderr).toBe("");
      return (JSON.parse(result.stdout) as { ticket: { labels: string[] } }).ticket.labels;
    };

    it("label by host", () => {
      expect(create(["Outside", "-l", "a"], null)).toEqual(["a", "external-host"]);
      expect(create(["Inside", "-l", "a"], "agent-1")).toEqual(["a"]);
    });

    it("ticket created by a Paseo agent has no label", () => {
      expect(create(["Inside"], "agent-1")).toEqual([]);
    });

    it("paseo flag leaves no label", () => {
      expect(create(["For Paseo", "--paseo"], null)).toEqual([]);
    });

    it("help names the flag", () => {
      const result = spawnSync(BIN, ["ticket", "create"], { encoding: "utf8", env: { ...process.env, TARO_TRACKER: tracker }, timeout: 60_000 });
      expect(result.stderr).toMatch(/--paseo/);
      expect(result.stderr).toMatch(/external-host/);
    });
  });
});

describe("Paseo's automation skips a labelled ticket", () => {
  it("ladder skips", async () => {
    tickets = [ticket("DM-1", "In Progress"), ticket("DM-3", "Queued", LABELLED)];
    await actions.primeStatuses();
    await actions.onTrackerChanged(paseo, "demo");
    for (const minute of [5, 15, 25]) await actions.checkQueues(paseo, at(minute));
    expect(told).toEqual([]);
    expect(restartManager).not.toHaveBeenCalled();
    expect(notesWritten()).toEqual([]);
    expect(actions.queueAlerts("demo", at(25))).toEqual([]);
    // The same ticket unlabelled is woken for, so the label is what kept it out.
    tickets = [ticket("DM-1", "In Progress"), ticket("DM-3", "Queued")];
    await actions.checkQueues(paseo, at(30));
    expect(told.map((entry) => entry.tickets)).toEqual(["DM-3"]);
  });

  it("relaunch skips", async () => {
    tickets = [ticket("DM-1", "In Progress", LABELLED), ticket("DM-2", "In Progress")];
    owners = [owner("DM-1", "closed"), owner("DM-2", "closed")];
    await actions.checkQueues(paseo, at(1));
    expect(relaunched).toEqual(["DM-2"]);
  });

  it("relaunch refuses a labelled ticket", async () => {
    tickets = [ticket("DM-1", "In Progress", LABELLED)];
    owners = [owner("DM-1", "closed")];
    vi.mocked(actions.relaunchOwner).mockRestore();
    await expect(actions.relaunchOwner(paseo, "demo", "DM-1")).rejects.toThrow(
      "DM-1 is worked outside Paseo (external-host): to hand it back, write a HANDOFF note, remove the label, then resume it.",
    );
    expect(sendFromPlugin).not.toHaveBeenCalled();
  });

  it("done wake skips", async () => {
    tickets = [ticket("DM-1", "In Progress", LABELLED), ticket("DM-2", "In Progress")];
    await actions.primeStatuses();
    tickets = [ticket("DM-1", "Done", LABELLED), ticket("DM-2", "In Progress")];
    await actions.onTrackerChanged(paseo, "demo");
    expect(told).toEqual([]);
    tickets = [ticket("DM-1", "Done", LABELLED), ticket("DM-2", "Done")];
    await actions.onTrackerChanged(paseo, "demo");
    expect(told.map((entry) => `${entry.path}: ${entry.ticket}`)).toEqual(["messages/ticket-done.md: DM-2"]);
  });

  it("accept handoff skips", async () => {
    // Delivered outside Paseo with no review-head recorded: Accept cannot merge, and no Paseo owner takes it over.
    tickets = [ticket("DM-1", "Awaiting acceptance", LABELLED)];
    owners = [];
    await actions.accept(paseo, "demo", "DM-1");
    expect(relaunched).toEqual([]);
    expect(sendWithoutInterrupting).not.toHaveBeenCalled();
    expect(notesWritten()).toHaveLength(1);
    expect(notesWritten()[0]).toMatch(/^DM-1 NOT-MERGED .*review-head.*outside Paseo/);
  });

  it("request changes skips, records, does not throw", async () => {
    tickets = [ticket("DM-1", "Awaiting acceptance", LABELLED)];
    owners = [];
    await actions.requestChanges(paseo, "demo", "DM-1", "  Add a test  ");
    expect(sendWithoutInterrupting).not.toHaveBeenCalled();
    expect(vi.mocked(recordChangesRequested).mock.calls.map((call) => [call[1], call[2]])).toEqual([["DM-1", expect.stringMatching(/^CHANGES-REQUESTED .* — the user: "Add a test"$/)]]);
  });

  it("change spec skips", async () => {
    tickets = [ticket("DM-1", "Queued", LABELLED)];
    owners = [];
    await actions.changeQueuedSpec(paseo, "demo", "DM-1", "Only CSV");
    expect(tellManager).not.toHaveBeenCalled();
    expect(notesWritten()).toEqual([expect.stringMatching(/^DM-1 CHANGES-REQUESTED .* — the user: "Only CSV"/)]);
  });

  it("reopen records only", async () => {
    tickets = [ticket("DM-1", "Done", LABELLED)];
    owners = [];
    const said = await actions.reopenTicket(paseo, "demo", "DM-1", "Broke on Safari");
    expect(reopenTicketRecord).toHaveBeenCalledTimes(1);
    expect(tellManager).not.toHaveBeenCalled();
    expect(said).toMatch(/outside Paseo/);
  });
});

describe("taking a ticket over and handing it back", () => {
  const parked = "PAUSE-REQUESTED 2026-11-22T09:00:00.000Z — the user pressed Park\n\nHANDOFF 2026-11-22T09:01Z — where I stopped\n\nHOLD 2026-11-22T09:02Z — parked by the user; resume from the latest HANDOFF";

  it("paused owner of a labelled ticket stays paused", async () => {
    tickets = [ticket("DM-1", "In Progress", LABELLED)];
    owners = [owner("DM-1", "closed")];
    notes = { "DM-1": parked };
    await actions.checkQueues(paseo, at(1));
    await expect(actions.resume(paseo, "demo", "DM-1")).rejects.toThrow(/external-host/);
    // Queued to resume before it was labelled: the minute check does not start it either.
    notes = { "DM-1": `${parked}\n\nRELEASE 2026-11-22T09:30Z — resumed by the user; queued to resume: no free slot (owners 3 of 3)` };
    await actions.checkQueues(paseo, at(2));
    expect(relaunched).toEqual([]);
  });

  it("removing the label keeps the pause", async () => {
    tickets = [ticket("DM-1", "In Progress")];
    owners = [owner("DM-1", "closed")];
    notes = { "DM-1": parked };
    await actions.checkQueues(paseo, at(1));
    expect(relaunched).toEqual([]);
  });

  it("resume relaunches from the handoff", async () => {
    tickets = [ticket("DM-1", "In Progress")];
    owners = [];
    notes = { "DM-1": `${parked}\n\nHANDOFF 2026-11-22T11:00Z — worked outside Paseo: tests added, review next` };
    const result = await actions.resume(paseo, "demo", "DM-1");
    expect(relaunched).toEqual(["DM-1"]);
    expect(result.agentId).toBe("fresh-DM-1");
  });
});

describe("the manager's dispatch rule", () => {
  it("manager.md names the label", () => {
    const page = readFileSync(resolve(import.meta.dirname, "..", "skill", "roles", "manager.md"), "utf8");
    expect(page).toMatch(/external-host/);
  });
});
