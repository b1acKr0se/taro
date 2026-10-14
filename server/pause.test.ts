// TR-088: Pause asks the owner for a HANDOFF, then archives the ticket's agents and holds it; Resume
// starts a fresh owner with a free slot, or queues it to start when one frees, oldest first.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PAUSE_HANDOFF_TIMEOUT_MS } from "../shared/pause";
import { Actions } from "./actions";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import { sendFromPlugin } from "./send";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import type { TrackerWatch } from "./tracker-watch";

interface FakeTicket {
  id: string;
  status: string;
  parentTaskId: string | null;
  notes: string;
  updatedAt: string;
}

let tickets: FakeTicket[] = [];
let live: PaseoAgent[] = [];
let clock = 0;

function find(id: string): FakeTicket {
  const ticket = tickets.find((each) => each.id === id);
  if (ticket === undefined) throw new Error(`no ${id}`);
  return ticket;
}

vi.mock("./agents", () => ({
  projectAgents: vi.fn(async (_paseo: unknown, _project: string, role?: string) => live.filter((agent) => role === undefined || agent.labels["taro.role"] === role)),
  listTaroAgents: vi.fn(async (_paseo: unknown, labels: Record<string, string>) => live.filter((agent) => Object.entries(labels).every(([key, value]) => agent.labels[key] === value))),
  projectArchivedAgents: vi.fn(async () => []),
  fetchLiveAgent: vi.fn(async (_paseo: unknown, id: string) => live.find((agent) => agent.id === id) ?? null),
  isAgentGone: vi.fn(async () => false),
  isMidTurn: (agent: { status: string }) => agent.status === "running",
}));
vi.mock("./send", () => ({ sendFromPlugin: vi.fn(async () => undefined), sendWithoutInterrupting: vi.fn(async () => undefined), sendCommand: vi.fn() }));
vi.mock("./package-files", () => ({ TEMPLATES: { pause: "pause", relaunchOwner: "relaunch" }, skillDirectory: async () => "/skill", message: async (path: string) => path }));
vi.mock("./projects", () => ({
  projectPaths: async () => ({ tracker: "/tracker" }),
  listProjectConfigs: async () => [],
  requireProjectConfig: async () => ({ owner: { model: "claude/haiku", thinking: "" }, maxParallelOwners: 2 }),
}));
vi.mock("./headroom", () => ({ readHeadroom: async () => null }));
vi.mock("./models", () => ({ bypassModeId: async () => null }));
vi.mock("./environment", () => ({ taroEnvironment: async () => ({}) }));
vi.mock("./tickets", () => ({
  listTickets: vi.fn(async () =>
    tickets.map((ticket) => ({ id: ticket.id, title: ticket.id, status: ticket.status, parentTaskId: ticket.parentTaskId, labels: [], dependencies: [], updatedAt: ticket.updatedAt })),
  ),
  viewTicket: vi.fn(async (_tracker: string, id: string) => {
    const ticket = find(id);
    return { id, title: id, status: ticket.status, parentTaskId: ticket.parentTaskId, labels: [], dependencies: [], implementationNotes: ticket.notes, updatedAt: ticket.updatedAt };
  }),
  appendTicketNote: vi.fn(async (_tracker: string, id: string, record: string) => {
    const ticket = find(id);
    ticket.notes = `${ticket.notes}\n\n${record}`;
    clock += 1;
    ticket.updatedAt = `2026-01-05T10:00:${String(clock).padStart(2, "0")}Z`;
  }),
}));

const EXECUTION = (id: string) => `EXECUTION 2026-01-05T09:00:00Z owner=old-${id} workspace=wks_${id.replace("-", "")} worktree=/home/user/notes-app branch=taro/${id.toLowerCase()} base=abc host=box`;

function ticket(id: string, status: string, notes = EXECUTION(id)): FakeTicket {
  return { id, status, parentTaskId: null, notes, updatedAt: "2026-01-05T09:00:00Z" };
}

function agent(id: string, ticketId: string, role = "owner", status = "idle"): PaseoAgent {
  return { id, status, workspaceId: `wks_${ticketId.replace("-", "")}`, updatedAt: "2026-01-05T09:00:00Z", labels: { "taro.project": "notes", "taro.role": role, "taro.ticket": ticketId } } as unknown as PaseoAgent;
}

const archived: string[] = [];
const created: { agentId: string; workspace: string; ticket: string }[] = [];
const paseo = {
  agents: {
    ref: (id: string) => ({
      archive: async () => {
        archived.push(id);
        live = live.filter((each) => each.id !== id);
      },
    }),
  },
  workspaces: {
    ref: (workspace: string) => ({
      agents: {
        create: async (input: { agentId: string; labels: Record<string, string> }) => {
          created.push({ agentId: input.agentId, workspace, ticket: input.labels["taro.ticket"] ?? "" });
          live.push(agent(input.agentId, input.labels["taro.ticket"] ?? ""));
        },
      },
    }),
  },
} as unknown as PaseoApi;

const withdrawn: string[] = [];
const state = { forgetAgent: async () => undefined, agent: async () => null } as unknown as PluginState;
const supervisor = { withdrawDecisionsOf: async (id: string) => withdrawn.push(id) } as unknown as Supervisor;
let actions: Actions;

beforeEach(() => {
  tickets = [];
  live = [];
  clock = 0;
  archived.length = 0;
  created.length = 0;
  withdrawn.length = 0;
  vi.mocked(sendFromPlugin).mockClear();
  actions = new Actions(state, supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
});

describe("Pause", () => {
  it("asks the owner for a handoff, then archives it and its subagents and holds the ticket", async () => {
    tickets = [ticket("NA-1", "In Progress")];
    live = [agent("owner-1", "NA-1"), agent("reviewer-1", "NA-1", "reviewer"), agent("other", "NA-2")];
    expect(await actions.pause(paseo, "notes", "NA-1")).toBe("Pausing NA-1: its owner is writing a handoff (at most 10 minutes).");
    expect(sendFromPlugin).toHaveBeenCalledWith(paseo, "owner-1", "pause");
    expect(find("NA-1").notes).toMatch(/\nPAUSE-REQUESTED \S+ — the user pressed Pause/);
    // Before the handoff nothing is archived.
    await actions.advancePauses(paseo, "notes", Date.now());
    expect(archived).toEqual([]);
    await expect(actions.pause(paseo, "notes", "NA-1")).rejects.toThrow("NA-1 is already pausing");

    find("NA-1").notes += "\n\nHANDOFF 2026-01-05T10:03Z\n- Phase: In Progress — list built";
    find("NA-1").updatedAt = "2026-01-05T10:03:00Z";
    expect(await actions.advancePauses(paseo, "notes", Date.now())).toBe(true);
    expect(archived).toEqual(["owner-1", "reviewer-1"]);
    expect(withdrawn).toEqual(["owner-1", "reviewer-1"]);
    expect(find("NA-1").notes).toMatch(/\nHOLD \S+ — paused by the user; resume from the latest HANDOFF$/);
    expect(find("NA-1").status).toBe("In Progress");
  });

  it("waits for the turn that wrote the handoff to end", async () => {
    tickets = [ticket("NA-1", "In Progress")];
    live = [agent("owner-1", "NA-1", "owner", "running")];
    await actions.pause(paseo, "notes", "NA-1");
    find("NA-1").notes += "\n\nHANDOFF 2026-01-05T10:03Z\n- Phase: x";
    find("NA-1").updatedAt = "2026-01-05T10:03:00Z";
    await actions.advancePauses(paseo, "notes", Date.now());
    expect(archived).toEqual([]);
    live = [agent("owner-1", "NA-1")];
    await actions.advancePauses(paseo, "notes", Date.now());
    expect(archived).toEqual(["owner-1"]);
  });

  it("pauses without a handoff when the owner does not answer in time", async () => {
    tickets = [ticket("NA-1", "Planning")];
    live = [agent("owner-1", "NA-1", "owner", "running")];
    await actions.pause(paseo, "notes", "NA-1");
    expect(await actions.advancePauses(paseo, "notes", Date.now() + PAUSE_HANDOFF_TIMEOUT_MS - 60_000)).toBe(false);
    expect(await actions.advancePauses(paseo, "notes", Date.now() + PAUSE_HANDOFF_TIMEOUT_MS + 1_000)).toBe(true);
    expect(archived).toEqual(["owner-1"]);
    expect(find("NA-1").notes).toContain("paused by the user; no handoff (the owner did not write one within 10 minutes): resume from the latest milestone");
  });

  it("pauses at once a ticket whose owner is gone", async () => {
    tickets = [ticket("NA-1", "In Progress")];
    expect(await actions.pause(paseo, "notes", "NA-1")).toContain("NA-1 is paused. It had no live owner");
    expect(sendFromPlugin).not.toHaveBeenCalled();
    expect(find("NA-1").notes).toContain("no handoff (the owner had already stopped)");
  });

  it("is refused while awaiting acceptance or merging, and the owner hears nothing", async () => {
    tickets = [ticket("NA-1", "Awaiting acceptance"), ticket("NA-2", "Awaiting acceptance", `${EXECUTION("NA-2")}\n\nACCEPTED 2026-01-05T10:00:00Z — the user accepted; merging: into main`)];
    live = [agent("owner-1", "NA-1"), agent("owner-2", "NA-2")];
    await expect(actions.pause(paseo, "notes", "NA-1")).rejects.toThrow("NA-1 is awaiting your acceptance: accept it or request changes instead.");
    await expect(actions.pause(paseo, "notes", "NA-2")).rejects.toThrow("NA-2 is merging: wait for it to finish.");
    expect(sendFromPlugin).not.toHaveBeenCalled();
    expect(find("NA-1").notes).not.toContain("PAUSE-REQUESTED");
  });
});

describe("Resume", () => {
  const paused = (id: string) => ticket(id, "In Progress", `${EXECUTION(id)}\n\nHANDOFF 2026-01-05T09:30Z\n- Phase: x\n\nHOLD 2026-01-05T09:31Z — paused by the user; resume from the latest HANDOFF`);

  it("starts a fresh owner in the same workspace with a free slot", async () => {
    tickets = [paused("NA-1")];
    const result = await actions.resume(paseo, "notes", "NA-1");
    expect(result.message).toBe("A fresh owner is starting on NA-1.");
    expect(created).toEqual([{ agentId: result.agentId, workspace: "wks_NA1", ticket: "NA-1" }]);
    expect(find("NA-1").notes).toMatch(/\nRELEASE \S+ — resumed by the user: a fresh owner starts from the latest HANDOFF$/);
  });

  it("queues with no free slot, then starts when one frees", async () => {
    tickets = [ticket("NA-1", "In Progress"), ticket("NA-2", "Reviewing"), paused("NA-3")];
    live = [agent("owner-1", "NA-1"), agent("owner-2", "NA-2")];
    const result = await actions.resume(paseo, "notes", "NA-3");
    expect(result).toEqual({ message: "NA-3 is queued to resume: no free slot (owners 2 of 2). It starts when one frees.", agentId: null });
    expect(find("NA-3").notes).toContain("resumed by the user; queued to resume: no free slot (owners 2 of 2)");
    expect(created).toEqual([]);
    await expect(actions.resume(paseo, "notes", "NA-3")).rejects.toThrow("NA-3 is already queued to resume.");

    await actions.advancePauses(paseo, "notes", Date.now());
    expect(created).toEqual([]);
    find("NA-2").status = "Awaiting acceptance";
    expect(await actions.advancePauses(paseo, "notes", Date.now())).toBe(true);
    expect(created.map((each) => each.ticket)).toEqual(["NA-3"]);
    expect(find("NA-3").notes).toMatch(/\nRESUMED \S+ — a slot freed: the plugin started a fresh owner /);
    // Started once: the next minute leaves it be.
    await actions.advancePauses(paseo, "notes", Date.now());
    expect(created).toHaveLength(1);
  });

  it("leaves a freed slot to an older queued ticket first", async () => {
    tickets = [ticket("NA-0", "Queued", ""), ticket("NA-1", "In Progress"), paused("NA-3")];
    live = [agent("owner-1", "NA-1")];
    expect((await actions.resume(paseo, "notes", "NA-3")).message).toBe("NA-3 is queued to resume: no free slot (older queued tickets come first). It starts when one frees.");
    await actions.advancePauses(paseo, "notes", Date.now());
    expect(created).toEqual([]);
    // The Manager dispatched NA-0: no slot left. NA-1 delivers: the slot is NA-3's.
    find("NA-0").status = "Planning";
    live.push(agent("owner-0", "NA-0"));
    await actions.advancePauses(paseo, "notes", Date.now());
    expect(created).toEqual([]);
    find("NA-1").status = "Awaiting acceptance";
    await actions.advancePauses(paseo, "notes", Date.now());
    expect(created.map((each) => each.ticket)).toEqual(["NA-3"]);
  });

  it("starts queued resumes oldest first", async () => {
    tickets = [ticket("NA-1", "In Progress"), ticket("NA-2", "In Progress"), paused("NA-3"), paused("NA-4")];
    live = [agent("owner-1", "NA-1"), agent("owner-2", "NA-2")];
    await actions.resume(paseo, "notes", "NA-4");
    await actions.resume(paseo, "notes", "NA-3");
    find("NA-1").status = "Done";
    await actions.advancePauses(paseo, "notes", Date.now());
    expect(created.map((each) => each.ticket)).toEqual(["NA-3"]);
  });

  it("is refused for a ticket not paused or awaiting acceptance", async () => {
    tickets = [ticket("NA-1", "In Progress"), { ...paused("NA-2"), status: "Awaiting acceptance" }];
    await expect(actions.resume(paseo, "notes", "NA-1")).rejects.toThrow("NA-1 is not paused.");
    await expect(actions.resume(paseo, "notes", "NA-2")).rejects.toThrow("NA-2 is awaiting your acceptance");
    expect(created).toEqual([]);
  });
});
