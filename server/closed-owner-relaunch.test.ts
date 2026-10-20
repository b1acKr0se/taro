// TR-217: owners Paseo closed (a daemon update or restart) are replaced by the minute check while
// their tickets are worked, within the cap, and noted on the ticket.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actions } from "./actions";
import { fetchLiveAgent, listTaroAgents, projectAgents, projectArchivedAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
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
  listTaroAgents: vi.fn(),
}));
vi.mock("./projects", () => ({
  listProjectConfigs: async () => [{ project: "demo" }],
  projectPaths: async () => ({ tracker: "/tracker" }),
  requireProjectConfig: async () => ({ project: "demo", managerAgentId: "manager", managerWorkspaceId: "ws-manager", maxParallelOwners: 2 }),
}));
vi.mock("./headroom", () => ({ readHeadroom: async () => null }));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn(), appendTicketNote: vi.fn(async () => undefined) }));

const ticket = (id: string, status: string) => ({ id, title: id, status, labels: [], parentTaskId: null, updatedAt: null, dependencies: [] });
const agent = (id: string, ticketId: string, status: string, updatedAt = new Date().toISOString()) =>
  ({ id, status, updatedAt, workspaceId: `ws-${id}`, labels: { "taro.project": "demo", "taro.role": "owner", "taro.ticket": ticketId } }) as unknown as PaseoAgent;
const paseo = {} as unknown as PaseoApi;

let live: PaseoAgent[];
let notes: Record<string, string>;
let actions: Actions;
let relaunched: string[];
let failing: Set<string>;

beforeEach(() => {
  live = [];
  notes = {};
  relaunched = [];
  failing = new Set();
  vi.mocked(appendTicketNote).mockClear();
  vi.mocked(projectAgents).mockImplementation(async () => [...live]);
  vi.mocked(listTaroAgents).mockImplementation(async () => [...live]);
  vi.mocked(fetchLiveAgent).mockImplementation(async () => null);
  vi.mocked(projectArchivedAgents).mockImplementation(async () => []);
  vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => ({ dependencies: [], implementationNotes: notes[id] ?? null }) as unknown as Awaited<ReturnType<typeof viewTicket>>);
  const state = { forgetAgent: async () => undefined, queueLadder: async () => null, saveQueueLadder: async () => undefined } as unknown as PluginState;
  actions = new Actions(state, {} as Supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
  vi.spyOn(actions, "relaunchOwner").mockImplementation(async (_paseo, _project, id) => {
    if (failing.has(id)) throw new Error("provider not ready");
    relaunched.push(id);
    live.push(agent(`fresh-${id}`, id, "running"));
    return `fresh-${id}`;
  });
});

describe("closed owners are replaced", () => {
  it("starts a fresh owner for each worked ticket whose owner closed, and notes it", async () => {
    live = [agent("a", "DM-1", "closed"), agent("b", "DM-2", "closed")];
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "In Progress"), ticket("DM-2", "Planning")] as never);
    await actions.checkQueues(paseo);
    expect(relaunched).toEqual(["DM-1", "DM-2"]);
    expect(vi.mocked(appendTicketNote).mock.calls.map((call) => call[2]).join("\n")).toMatch(/OWNER-RELAUNCHED .*closed the owner a.*fresh owner fresh-DM-1/);
  });

  it("waits for a slot: with the cap of 2 taken by live owners none starts", async () => {
    live = [agent("a", "DM-1", "closed"), agent("x", "DM-8", "running"), agent("y", "DM-9", "idle")];
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "In Progress"), ticket("DM-8", "In Progress"), ticket("DM-9", "Reviewing")] as never);
    await actions.checkQueues(paseo);
    expect(relaunched).toEqual([]);
  });

  it("leaves an Awaiting acceptance ticket and a parked one alone", async () => {
    live = [agent("a", "DM-1", "closed"), agent("b", "DM-2", "closed")];
    notes["DM-2"] = "HOLD 2026-01-05T10:04Z — parked by the user";
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "In Progress")] as never);
    await actions.checkQueues(paseo);
    expect(relaunched).toEqual([]);
  });

  it("recounts between relaunches: with one live owner and a cap of 2 only one of two starts, with one note", async () => {
    live = [agent("x", "DM-9", "running"), agent("a", "DM-1", "closed"), agent("b", "DM-2", "closed")];
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-9", "In Progress"), ticket("DM-1", "In Progress"), ticket("DM-2", "In Progress")] as never);
    await actions.checkQueues(paseo);
    expect(relaunched).toEqual(["DM-1"]);
    expect(vi.mocked(appendTicketNote)).toHaveBeenCalledTimes(1);
  });

  it("notes a failed relaunch and goes on to the next ticket", async () => {
    live = [agent("a", "DM-1", "closed"), agent("b", "DM-2", "closed")];
    failing.add("DM-1");
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "In Progress"), ticket("DM-2", "In Progress")] as never);
    await actions.checkQueues(paseo);
    expect(relaunched).toEqual(["DM-2"]);
    const written = vi.mocked(appendTicketNote).mock.calls.map((call) => `${call[1]} ${call[2]}`);
    expect(written.some((line) => /^DM-1 OWNER-RELAUNCH-FAILED .*provider not ready/.test(line))).toBe(true);
  });

  it("leaves an owner that closed a day ago", async () => {
    live = [agent("a", "DM-1", "closed", new Date(Date.now() - 24 * 60 * 60_000).toISOString())];
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "In Progress")] as never);
    await actions.checkQueues(paseo);
    expect(relaunched).toEqual([]);
  });
});
