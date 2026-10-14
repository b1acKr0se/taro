// TR-062: a ticket sat in Backlog while only 1 of 3 owners counted, because the Manager counted from
// memory and nothing woke it. The plugin now owns the count: a ticket filed while a slot is free, or
// an idle Manager with a startable ticket, wakes it with the plugin's recount; a HOLD record exempts a
// ticket; and when the Manager still does not dispatch, an alert at ten minutes and a fresh Manager at
// twenty, at most once an hour.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actions } from "./actions";
import { fetchLiveAgent, listTaroAgents, projectAgents, projectArchivedAgents } from "./agents";
import { readHeadroom } from "./headroom";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { restartManager } from "./manager";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { appendTicketNote, listTickets, viewTicket } from "./tickets";
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
  requireProjectConfig: async () => ({ project: "demo", managerAgentId: "manager", managerWorkspaceId: "ws-manager", maxParallelOwners: 3 }),
}));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn(), appendTicketNote: vi.fn(async () => undefined) }));
vi.mock("./headroom", () => ({ readHeadroom: vi.fn(async () => null) }));
vi.mock("./manager", () => ({ restartManager: vi.fn(async () => ({ agentId: "manager-2", workspaceId: "ws-manager" })) }));
vi.mock("./package-files", async (original) => ({
  ...(await original<typeof import("./package-files")>()),
  message: async (path: string, values: Record<string, string>) => JSON.stringify({ path, ...values }),
}));

const MINUTE = 60_000;
const T0 = Date.parse("2026-10-14T10:00:00Z");

const ticket = (id: string, status: string, updatedAt = "2026-10-14 10:00") => ({
  id,
  title: id,
  status,
  labels: [],
  parentTaskId: null,
  acceptanceCriteriaCompleted: 0,
  acceptanceCriteriaCount: 0,
  createdAt: null,
  updatedAt,
  isReady: true,
});
const owner = (ticketId: string) =>
  ({ id: `owner-${ticketId}`, status: "idle", workspaceId: `ws-${ticketId}`, labels: { "taro.project": "demo", "taro.role": "owner", "taro.ticket": ticketId }, lastUsage: null }) as unknown as PaseoAgent;

let tickets: ReturnType<typeof ticket>[];
let owners: PaseoAgent[];
let notes: Record<string, string>;
let dependencies: Record<string, string[]>;
let manager: { id: string; status: string; updatedAt: string; labels: Record<string, string> } | null;
let managerState: { lastTurnEndedAt: string | null; stalled: boolean };
let told: Record<string, string>[];
let actions: Actions;
/** The plugin state's stored ladders, kept across the `Actions` of one test as a disk would be. */
let ladders: Map<string, { restarts: string[]; dismissed: string[] }>;
/** The Manager's timeline as Paseo returns it; null stands for a fetch that fails. */
let timeline: { item: { type: string; text: string; messageId?: string }; timestamp: string }[] | null;
const paseo = {
  agents: {
    ref: () => ({
      timeline: { refetch: async () => (timeline === null ? Promise.reject(new Error("offline")) : { entries: timeline }) },
    }),
  },
} as unknown as PaseoApi;

function at(minutes: number): number {
  return T0 + minutes * MINUTE;
}

function iso(minutes: number): string {
  return new Date(at(minutes)).toISOString();
}

/** The Manager's turn ended at that minute and it is idle since. */
function idleSince(minutes: number): void {
  manager = { id: "manager", status: "idle", updatedAt: iso(minutes), labels: {} };
  managerState = { lastTurnEndedAt: iso(minutes), stalled: false };
}

function told_(): string[] {
  return told.map((entry) => `${entry.path}: ${entry.tickets ?? entry.ticket}`);
}

function notesWritten(): string[] {
  return vi.mocked(appendTicketNote).mock.calls.map(([, id, record]) => `${id} ${record.split(" ")[0]}`);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  tickets = [ticket("DM-1", "In Progress"), ticket("DM-2", "Awaiting acceptance")];
  owners = [owner("DM-1"), owner("DM-2")];
  notes = {};
  dependencies = {};
  told = [];
  ladders = new Map();
  timeline = [];
  idleSince(-10);
  vi.mocked(listTickets).mockImplementation(async () => tickets);
  vi.mocked(viewTicket).mockImplementation(
    async (_tracker, id) => ({ dependencies: dependencies[id] ?? [], implementationNotes: notes[id] ?? null }) as unknown as Awaited<ReturnType<typeof viewTicket>>,
  );
  vi.mocked(projectAgents).mockImplementation(async () => owners);
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (id === "manager" && manager !== null ? (manager as unknown as PaseoAgent) : null));
  vi.mocked(listTaroAgents).mockImplementation(async () => []);
  vi.mocked(projectArchivedAgents).mockImplementation(async () => []);
  vi.mocked(readHeadroom).mockReset().mockResolvedValue(null);
  vi.mocked(restartManager).mockClear();
  vi.mocked(appendTicketNote).mockClear();
  actions = start();
});

function start(): Actions {
  const state = {
    forgetAgent: async () => undefined,
    updateDecisions: async () => undefined,
    ticketStatuses: async () => null,
    saveTicketStatuses: async () => undefined,
    agent: async (id: string) => (id === "manager" ? { ...managerState } : null),
    queueLadder: async (project: string) => ladders.get(project) ?? null,
    saveQueueLadder: async (project: string, ladder: { restarts: string[]; dismissed: string[] }) => void ladders.set(project, structuredClone(ladder)),
  } as unknown as PluginState;
  const stats = { transition: async () => undefined, agentFinal: async () => undefined } as unknown as Stats;
  const recovery = {
    tellManagerWhenHeadroom: async (_paseo: PaseoApi, _project: string, _manager: string, text: string, onSent?: () => void) => {
      told.push(JSON.parse(text) as Record<string, string>);
      onSent?.();
    },
  } as unknown as Recovery;
  return new Actions(state, {} as Supervisor, {} as TrackerWatch, stats, recovery);
}

/** A ticket is filed into Backlog: the tracker pass after its commit. */
async function file(id: string): Promise<void> {
  await actions.primeStatuses();
  tickets = [...tickets, ticket(id, "Backlog")];
  await actions.onTrackerChanged(paseo, "demo");
}

describe("a ticket filed while a slot is free", () => {
  it("wakes an idle Manager with the plugin's recount (slots freed before the ticket existed)", async () => {
    await file("DM-3");
    expect(told).toHaveLength(1);
    const message = told[0]!;
    expect(message.path).toBe("messages/ticket-queued.md");
    expect(message.tickets).toBe("DM-3");
    expect(JSON.parse(message.recount!)).toMatchObject({ path: "messages/recount.md", counting: "1", cap: "3", countingTickets: "DM-1", freeSlots: "2", startable: "DM-3" });
    expect(notesWritten()).toEqual(["DM-3 QUEUE-WAKE"]);
  });

  it("leaves a Manager mid-turn alone: it is most likely dispatching the ticket it just filed", async () => {
    manager = { id: "manager", status: "running", updatedAt: iso(0), labels: {} };
    await file("DM-3");
    expect(told).toEqual([]);
  });

  it("does not wake for a ticket paused back to Backlog with its owner alive, and counts that owner", async () => {
    owners = [owner("DM-1"), owner("DM-3"), owner("DM-4")];
    await file("DM-3");
    expect(told).toEqual([]);
    await actions.checkQueues(paseo, at(5));
    expect(told).toEqual([]);
  });

  it("does not wake for a ticket held, waiting on a dependency, or with every slot taken", async () => {
    notes = { "DM-3": "HOLD 2026-10-14T09:59Z — exclusive rewrite DM-1 first" };
    dependencies = { "DM-4": ["DM-1"] };
    await file("DM-3");
    await file("DM-4");
    owners = [owner("DM-1"), owner("DM-5"), owner("DM-6")];
    tickets = [...tickets, ticket("DM-5", "In Progress"), ticket("DM-6", "Planning")];
    await file("DM-7");
    expect(told).toEqual([]);
  });

  it("does not wake while threads are near the limit", async () => {
    vi.mocked(readHeadroom).mockResolvedValue({ current: 1800, max: 2048, high: true, highSince: iso(0) });
    await file("DM-3");
    expect(told).toEqual([]);
  });
});

describe("the minute check", () => {
  beforeEach(() => {
    tickets = [...tickets, ticket("DM-3", "Backlog")];
  });

  it("wakes the Manager once it has been idle for two minutes, and only once for the same situation", async () => {
    idleSince(0);
    await actions.checkQueues(paseo, at(1));
    expect(told).toEqual([]);
    await actions.checkQueues(paseo, at(2));
    expect(told_()).toEqual(["messages/queue-idle.md: DM-3"]);
    await actions.checkQueues(paseo, at(3));
    await actions.checkQueues(paseo, at(4));
    expect(told).toHaveLength(1);
  });

  it("wakes it again when the situation changes", async () => {
    await actions.checkQueues(paseo, at(0));
    tickets = [...tickets, ticket("DM-4", "Backlog")];
    await actions.checkQueues(paseo, at(1));
    expect(told_()).toEqual(["messages/queue-idle.md: DM-3", "messages/queue-idle.md: DM-3, DM-4"]);
  });

  it("never wakes for a ticket under a HOLD, and wakes once a RELEASE lifts it", async () => {
    notes = { "DM-3": "HOLD 2026-10-14T09:59Z — exclusive rewrite DM-1 first" };
    for (let minute = 0; minute < 30; minute += 1) await actions.checkQueues(paseo, at(minute));
    expect(told).toEqual([]);
    expect(actions.queueAlerts("demo", at(30))).toEqual([]);
    expect(restartManager).not.toHaveBeenCalled();

    notes = { "DM-3": `${notes["DM-3"]}\nRELEASE 2026-10-14T10:30Z — rewrite merged` };
    tickets = tickets.map((entry) => (entry.id === "DM-3" ? { ...entry, updatedAt: "2026-10-14 10:30" } : entry));
    await actions.checkQueues(paseo, at(31));
    expect(told_()).toEqual(["messages/queue-idle.md: DM-3"]);
  });

  it("does not wake a Manager mid-turn", async () => {
    manager = { id: "manager", status: "running", updatedAt: iso(0), labels: {} };
    await actions.checkQueues(paseo, at(5));
    expect(told).toEqual([]);
  });
});

describe("the escalation ladder", () => {
  beforeEach(() => {
    tickets = [...tickets, ticket("DM-3", "Backlog")];
  });

  /** Minute checks from `from` to `to`, as the timer runs them. */
  async function minutes(from: number, to: number): Promise<void> {
    for (let minute = from; minute <= to; minute += 1) {
      vi.setSystemTime(at(minute));
      await actions.checkQueues(paseo, at(minute));
    }
  }

  it("raises the alert ten minutes after the wake-up and restarts the Manager at twenty, logging each step", async () => {
    await minutes(0, 9);
    expect(actions.queueAlerts("demo", at(9))).toEqual([]);
    await minutes(10, 10);
    expect(actions.queueAlerts("demo", at(10)).map((alert) => alert.id)).toEqual(["queued-free-slot:DM-3"]);
    await minutes(11, 19);
    expect(restartManager).not.toHaveBeenCalled();
    await minutes(20, 20);
    expect(restartManager).toHaveBeenCalledTimes(1);
    const [, project, options] = vi.mocked(restartManager).mock.calls[0]!;
    expect(project).toBe("demo");
    expect(options?.evenMidTurn).toBe(false);
    expect(JSON.parse(options?.why ?? "{}")).toMatchObject({ path: "messages/manager-queue-restart.md", tickets: "DM-3", minutes: "20", handoff: "/home/user/taro/demo/manager-handoff.md" });
    expect(notesWritten()).toEqual(["DM-3 QUEUE-WAKE", "DM-3 QUEUE-ALERT", "DM-3 QUEUE-RESTART"]);
  });

  it("restarts at most once an hour, and leaves the alert up past that", async () => {
    await minutes(0, 79);
    expect(restartManager).toHaveBeenCalledTimes(1);
    // The fresh Manager was told at 20, so its own alert came up at 30, and it stays up.
    expect(actions.queueAlerts("demo", at(79))[0]?.text).toContain("already restarted the Manager within the hour");
    await minutes(80, 80);
    expect(restartManager).toHaveBeenCalledTimes(2);
  });

  it("never restarts a Manager that is actively working", async () => {
    await minutes(0, 5);
    manager = { id: "manager", status: "running", updatedAt: iso(5), labels: {} };
    for (let minute = 6; minute <= 30; minute += 1) {
      vi.setSystemTime(at(minute));
      manager.updatedAt = iso(minute);
      await actions.checkQueues(paseo, at(minute));
    }
    expect(restartManager).not.toHaveBeenCalled();
    expect(actions.queueAlerts("demo", at(30))).toHaveLength(1);
  });

  it("restarts a Manager whose turn shows no activity for half an hour, even mid-turn", async () => {
    await minutes(0, 1);
    manager = { id: "manager", status: "running", updatedAt: iso(1), labels: {} };
    await minutes(2, 30);
    expect(restartManager).not.toHaveBeenCalled();
    await minutes(31, 31);
    expect(restartManager).toHaveBeenCalledTimes(1);
    expect(vi.mocked(restartManager).mock.calls[0]![2]?.evenMidTurn).toBe(true);
  });

  it("restarts a Manager crash recovery gave up on, not one it is still recovering", async () => {
    await minutes(0, 1);
    manager = { id: "manager", status: "error", updatedAt: iso(1), labels: {} };
    await minutes(2, 25);
    expect(restartManager).not.toHaveBeenCalled();
    managerState.stalled = true;
    await minutes(26, 26);
    expect(restartManager).toHaveBeenCalledTimes(1);
  });

  it("never restarts a Manager that was busy until after twenty minutes: it is woken first, and restarted twenty minutes after that", async () => {
    manager = { id: "manager", status: "running", updatedAt: iso(0), labels: {} };
    for (let minute = 0; minute <= 24; minute += 1) {
      vi.setSystemTime(at(minute));
      manager.updatedAt = iso(minute);
      await actions.checkQueues(paseo, at(minute));
    }
    expect(actions.queueAlerts("demo", at(24))[0]?.text).toContain("could not tell it yet");
    idleSince(25);
    await minutes(25, 26);
    expect(told).toEqual([]);
    expect(restartManager).not.toHaveBeenCalled();
    await minutes(27, 27);
    expect(told_()).toEqual(["messages/queue-idle.md: DM-3"]);
    await minutes(28, 46);
    expect(restartManager).not.toHaveBeenCalled();
    await minutes(47, 47);
    expect(restartManager).toHaveBeenCalledTimes(1);
  });

  it("does not restart once the user dismissed the alert, even after a reload", async () => {
    await minutes(0, 12);
    await actions.dismissQueueAlert("demo", "DM-3");
    actions = start();
    expect(actions.queueAlerts("demo", at(12))).toEqual([]);
    await minutes(13, 40);
    expect(restartManager).not.toHaveBeenCalled();
  });

  it("does not restart once the user told the Manager something after the alert went up", async () => {
    await minutes(0, 12);
    actions.userToldManager("demo");
    await minutes(13, 40);
    expect(restartManager).not.toHaveBeenCalled();
  });

  it("still restarts a Manager that answered later wake-ups for a changed queue without dispatching", async () => {
    await minutes(0, 12);
    tickets = [...tickets, ticket("DM-4", "Backlog")];
    await minutes(13, 14);
    managerState.lastTurnEndedAt = iso(14);
    await minutes(15, 20);
    expect(told_()).toEqual(["messages/queue-idle.md: DM-3", "messages/queue-idle.md: DM-3, DM-4"]);
    expect(restartManager).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(restartManager).mock.calls[0]![2]?.why ?? "{}")).toMatchObject({ tickets: "DM-3" });
  });

  it("keeps a dismissal and the hourly limit when another path touches the ladder before the first minute check after a reload", async () => {
    await minutes(0, 20);
    expect(restartManager).toHaveBeenCalledTimes(1);
    tickets = [...tickets, ticket("DM-4", "Backlog")];
    await minutes(21, 32);
    await actions.dismissQueueAlert("demo", "DM-4");
    actions = start();
    actions.userToldManager("demo");
    vi.setSystemTime(at(33));
    await file("DM-5");
    expect(told_().at(-1)).toBe("messages/ticket-queued.md: DM-5");
    await minutes(33, 79);
    expect(actions.queueAlerts("demo", at(79)).map((alert) => alert.id)).not.toContain("queued-free-slot:DM-4");
    expect(restartManager).toHaveBeenCalledTimes(1);
    expect(ladders.get("demo")?.dismissed).toEqual(["DM-4"]);
    expect(ladders.get("demo")?.restarts).toEqual([iso(20)]);
  });

  it("does not restart once the user typed to the Manager in its own tab after the alert, but does for a message before it", async () => {
    timeline = [{ item: { type: "user_message", text: "hold on, I am checking DM-3", messageId: "user-1" }, timestamp: iso(9) }];
    await minutes(0, 20);
    expect(restartManager).toHaveBeenCalledTimes(1);

    vi.mocked(restartManager).mockClear();
    actions = start();
    ladders.clear();
    timeline = [
      { item: { type: "user_message", text: "status?", messageId: "user-1" }, timestamp: iso(100) },
      { item: { type: "user_message", text: "DM-3 could start now", messageId: "taro-0001" }, timestamp: iso(115) },
      { item: { type: "user_message", text: "leave DM-3 for now", messageId: "user-2" }, timestamp: iso(112) },
    ];
    await minutes(100, 130);
    expect(restartManager).not.toHaveBeenCalled();
  });

  it("does not restart on a guess when the Manager's timeline cannot be read", async () => {
    timeline = null;
    await minutes(0, 30);
    expect(restartManager).not.toHaveBeenCalled();
  });

  it("keeps the hourly limit across a reload, and logs a withheld restart once", async () => {
    await minutes(0, 20);
    expect(restartManager).toHaveBeenCalledTimes(1);
    actions = start();
    await minutes(21, 79);
    expect(restartManager).toHaveBeenCalledTimes(1);
    expect(notesWritten().filter((note) => note === "DM-3 QUEUE-RESTART")).toHaveLength(2);
    expect(vi.mocked(appendTicketNote).mock.calls.at(-1)?.[2]).toContain("already restarted the Manager within the hour");
  });

  it("does not wake a Manager it just replaced for what its first prompt said", async () => {
    await minutes(0, 20);
    expect(restartManager).toHaveBeenCalledTimes(1);
    idleSince(21);
    await minutes(21, 29);
    expect(told_()).toEqual(["messages/queue-idle.md: DM-3"]);
  });

  it("does not restart while threads are near the limit", async () => {
    await minutes(0, 15);
    vi.mocked(readHeadroom).mockResolvedValue({ current: 1800, max: 2048, high: true, highSince: iso(15) });
    await minutes(16, 40);
    expect(restartManager).not.toHaveBeenCalled();
  });

  it("drops the ticket from the ladder once it is dispatched", async () => {
    await minutes(0, 12);
    tickets = tickets.map((entry) => (entry.id === "DM-3" ? { ...entry, status: "Planning" } : entry));
    owners = [...owners, owner("DM-3")];
    await minutes(13, 40);
    expect(actions.queueAlerts("demo", at(40))).toEqual([]);
    expect(restartManager).not.toHaveBeenCalled();
  });

  it("keeps the restart counted when it fails, and logs the failure on the ticket", async () => {
    vi.mocked(restartManager).mockRejectedValueOnce(new Error("The demo Manager is in the middle of a turn. Restart it once it is idle."));
    await minutes(0, 40);
    expect(restartManager).toHaveBeenCalledTimes(1);
    const restartNotes = vi.mocked(appendTicketNote).mock.calls.map(([, , record]) => record).filter((record) => record.startsWith("QUEUE-RESTART"));
    expect(restartNotes[0]).toContain("failed (The demo Manager is in the middle of a turn");
    expect(restartNotes[1]).toContain("already restarted the Manager within the hour");
    expect(actions.queueAlerts("demo", at(40))).toHaveLength(1);
  });
});
