// TR-029: a ticket reaching Awaiting acceptance frees its owner's slot and wakes the manager; a
// child reaching Done never claims a slot, since children have no owner of their own.
// TR-043: the statuses acted on survive a restart, so a change made while the plugin was down
// (the merge at an accept reloads it as the ticket goes Done) still wakes the manager.
// TR-147: a ticket with no parent that becomes Done wakes the manager once, with what merged, even
// when nothing can start, so it can do its after-Done duties.
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
// The wake-ups carry the host's thread count (TR-062); a test must not read the real one.
vi.mock("./headroom", () => ({ readHeadroom: async () => null }));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn(), appendTicketNote: vi.fn(async () => undefined) }));
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
  priority: null,
  dependencies: [],
});
const agent = (id: string, ticketId: string, role: string, status = "running") =>
  ({ id, status, workspaceId: `ws-${id}`, labels: { "taro.project": "demo", "taro.role": role, "taro.ticket": ticketId }, lastUsage: null }) as unknown as PaseoAgent;
const manager = { id: "manager", status: "idle", labels: {}, workspaceId: "ws-manager" } as unknown as PaseoAgent;

let live: PaseoAgent[];
let told: Record<string, string>[];
let dependencies: Record<string, string[]>;
/** Each ticket's notes, where its ACCEPTANCE record is. */
let notes: Record<string, string>;
let actions: Actions;
/** The plugin state's stored statuses, kept across the `Actions` of one test as a disk would be. */
let stored: Map<string, ReadonlyMap<string, string>>;
/** Tells the manager; resolving to "held" stands for a wake-up held while threads are short. */
let tell: (text: string) => Promise<void | "held">;
/** The statuses the stats recorded last (TR-100), kept across the `Actions` of one test as a disk would be. */
let recorded: Map<string, string>;
/** Sends the held wake-ups go out with, once threads allow. */
let held: (() => void)[];
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
  notes = {};
  stored = new Map();
  recorded = new Map();
  held = [];
  tell = async (text) => void told.push(flatten(text));
  vi.mocked(projectAgents).mockClear().mockImplementation(async () => [...live]);
  vi.mocked(projectArchivedAgents).mockImplementation(async () => []);
  vi.mocked(listTaroAgents).mockImplementation(async () => [...live]);
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (id === "manager" ? manager : live.find((candidate) => candidate.id === id) ?? null));
  vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => ({ dependencies: dependencies[id] ?? [], implementationNotes: notes[id] ?? null }) as unknown as Awaited<ReturnType<typeof viewTicket>>);
  actions = start();
});

/** A told message's values, with the recount's (TR-062) and the merge (TR-147) alongside the message's own. */
function flatten(text: string): Record<string, string> {
  const { recount, afterDone, ...values } = JSON.parse(text) as Record<string, string>;
  const { path: _recountPath, ...counted } = recount === undefined ? {} : (JSON.parse(recount) as Record<string, string>);
  const { path: _afterDonePath, ...merge } = afterDone === undefined || afterDone === "" ? {} : (JSON.parse(afterDone) as Record<string, string>);
  return { ...values, ...counted, ...merge };
}

/** A plugin instance, as after a start or reload: a fresh `Actions` over the same stored state. */
function start(): Actions {
  const state = {
    forgetAgent: async () => undefined,
    updateDecisions: async () => undefined,
    ticketStatuses: async (project: string) => stored.get(project) ?? null,
    saveTicketStatuses: async (project: string, statuses: ReadonlyMap<string, string>) => void stored.set(project, new Map(statuses)),
  } as unknown as PluginState;
  // Like the real stats: a transition into the status already recorded is ignored.
  const stats = {
    transition: async (_project: string, id: string, _title: string, _from: string | null, to: string) => void recorded.set(id, to),
    agentUsage: async () => undefined,
    recordedStatuses: async () => (recorded.size === 0 ? null : new Map(recorded)),
  } as unknown as Stats;
  const recovery = {
    tellManagerWhenHeadroom: async (_paseo: PaseoApi, _project: string, _manager: string, text: string, onSent?: () => void) => {
      if ((await tell(text)) === "held") {
        held.push(() => onSent?.());
        return;
      }
      onSent?.();
    },
  } as unknown as Recovery;
  return new Actions(state, {} as Supervisor, {} as TrackerWatch, stats, recovery);
}

describe("a freed owner slot wakes the manager", () => {
  it("wakes it when a ticket reaches Awaiting acceptance, with the count leaving that owner out", async () => {
    live = [agent("one", "DM-1", "owner", "idle"), agent("two", "DM-2", "owner")];
    await move(
      [ticket("DM-1", "Reviewing"), ticket("DM-2", "In Progress"), ticket("DM-3", "Queued")],
      [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "In Progress"), ticket("DM-3", "Queued")],
    );
    expect(told).toEqual([
      {
        path: "messages/dependency-cleared.md",
        ticket: "DM-1",
        status: "Awaiting acceptance",
        dependents: "none",
        counting: "1",
        cap: "2",
        countingTickets: "DM-2",
        freeSlots: "1",
        threads: "no limit published",
        startable: "DM-3",
        waiting: "none",
        held: "none",
        owned: "none",
      },
    ]);
  });

  it("lists the tickets that depend on one reaching Awaiting acceptance (the TR-040 wake-up said none)", async () => {
    dependencies = { "DM-2": ["DM-1"], "DM-3": ["DM-1", "DM-2"] };
    await move(
      [ticket("DM-1", "Reviewing"), ticket("DM-2", "Queued"), ticket("DM-3", "Queued")],
      [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued"), ticket("DM-3", "Queued")],
    );
    expect(told.map((entry) => [entry.ticket, entry.status, entry.dependents, entry.startable, entry.waiting])).toEqual([
      ["DM-1", "Awaiting acceptance", "DM-2, DM-3", "none", "DM-2 (on DM-1), DM-3 (on DM-1, DM-2)"],
    ]);
  });

  it("does not wake it for dependents of a ticket in Awaiting acceptance when no slot is free", async () => {
    live = [agent("two", "DM-2", "owner"), agent("three", "DM-3", "owner")];
    dependencies = { "DM-4": ["DM-1"] };
    await move(
      [ticket("DM-1", "Reviewing"), ticket("DM-2", "In Progress"), ticket("DM-3", "Planning"), ticket("DM-4", "Queued")],
      [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "In Progress"), ticket("DM-3", "Planning"), ticket("DM-4", "Queued")],
    );
    expect(told).toEqual([]);
  });

  it("finds a dependent whose dependency is written in another case", async () => {
    dependencies = { "DM-2": ["dm-1"] };
    await move([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")], [ticket("DM-1", "Done"), ticket("DM-2", "Queued")]);
    expect(told.map((entry) => [entry.ticket, entry.dependents])).toEqual([["DM-1", "DM-2"]]);
  });

  it("stays quiet when no ticket is queued, without listing the owners", async () => {
    live = [agent("one", "DM-1", "owner", "idle")];
    await move([ticket("DM-1", "Reviewing")], [ticket("DM-1", "Awaiting acceptance")]);
    expect(told).toEqual([]);
    expect(projectAgents).not.toHaveBeenCalled();
  });

  it("stays quiet when the owners still counting fill the cap", async () => {
    live = [agent("one", "DM-1", "owner", "idle"), agent("two", "DM-2", "owner"), agent("three", "DM-3", "owner")];
    await move(
      [ticket("DM-1", "Reviewing"), ticket("DM-2", "In Progress"), ticket("DM-3", "Planning"), ticket("DM-4", "Queued")],
      [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "In Progress"), ticket("DM-3", "Planning"), ticket("DM-4", "Queued")],
    );
    expect(told).toEqual([]);
  });

  it("does not wake again for a slot when an accepted ticket goes from Awaiting acceptance to Done, only to say it is Done", async () => {
    await move([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")], [ticket("DM-1", "Done"), ticket("DM-2", "Queued")]);
    expect(told.map((entry) => [entry.path, entry.ticket])).toEqual([["messages/ticket-done.md", "DM-1"]]);
  });

  it("still wakes it for tickets that depended on the accepted one", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    await move([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")], [ticket("DM-1", "Done"), ticket("DM-2", "Queued")]);
    expect(told.map((entry) => [entry.ticket, entry.status, entry.dependents])).toEqual([["DM-1", "Done", "DM-2"]]);
  });

  const childBefore = [ticket("DM-1", "In Progress"), ticket("DM-1.1", "In Progress", "DM-1"), ticket("DM-2", "Queued")];
  const childAfter = [ticket("DM-1", "In Progress"), ticket("DM-1.1", "Done", "DM-1"), ticket("DM-2", "Queued")];

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

describe("a ticket becoming Done wakes the manager once (TR-147)", () => {
  const accepted = "ACCEPTANCE 2026-10-16T03:01Z — user: \"I accept DM-1.\" squash; accepted and closed by the plugin; merge: merged 0a1b2c3";

  it("tells it with what merged when nothing can start: no dependents and every slot full (the TR-139 case)", async () => {
    notes = { "DM-1": accepted };
    live = [agent("two", "DM-2", "owner"), agent("three", "DM-3", "owner")];
    await move(
      [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "In Progress"), ticket("DM-3", "In Progress"), ticket("DM-4", "Queued")],
      [ticket("DM-1", "Done"), ticket("DM-2", "In Progress"), ticket("DM-3", "In Progress"), ticket("DM-4", "Queued")],
    );
    expect(told).toEqual([{ path: "messages/ticket-done.md", ticket: "DM-1", merge: "merged 0a1b2c3" }]);
  });

  it("tells it with nothing queued", async () => {
    notes = { "DM-1": accepted };
    await move([ticket("DM-1", "Awaiting acceptance")], [ticket("DM-1", "Done")]);
    expect(told).toEqual([{ path: "messages/ticket-done.md", ticket: "DM-1", merge: "merged 0a1b2c3" }]);
  });

  it("says so when the ticket has no ACCEPTANCE record (set Done by hand)", async () => {
    await move([ticket("DM-1", "In Progress")], [ticket("DM-1", "Done")]);
    expect(told).toEqual([{ path: "messages/ticket-done.md", ticket: "DM-1", merge: "no ACCEPTANCE record" }]);
  });

  it("puts the merge into the one dependency-cleared wake-up when dependents cleared, never a second message", async () => {
    notes = { "DM-1": accepted };
    dependencies = { "DM-2": ["DM-1"] };
    await move([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")], [ticket("DM-1", "Done"), ticket("DM-2", "Queued")]);
    expect(told.map((entry) => [entry.path, entry.ticket, entry.dependents, entry.merge])).toEqual([["messages/dependency-cleared.md", "DM-1", "DM-2", "merged 0a1b2c3"]]);
  });

  it("puts the merge into the one wake-up for a slot freed straight into Done", async () => {
    notes = { "DM-1": accepted };
    await move([ticket("DM-1", "In Progress"), ticket("DM-2", "Queued")], [ticket("DM-1", "Done"), ticket("DM-2", "Queued")]);
    expect(told.map((entry) => [entry.path, entry.ticket, entry.startable, entry.merge])).toEqual([["messages/dependency-cleared.md", "DM-1", "DM-2", "merged 0a1b2c3"]]);
  });

  it("leaves the merge out of a wake-up for Awaiting acceptance", async () => {
    await move([ticket("DM-1", "Reviewing"), ticket("DM-2", "Queued")], [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")]);
    expect(told.map((entry) => [entry.path, entry.merge])).toEqual([["messages/dependency-cleared.md", undefined]]);
  });

  it("stays quiet for a child reaching Done with no dependents", async () => {
    await move([ticket("DM-1", "In Progress"), ticket("DM-1.1", "In Progress", "DM-1")], [ticket("DM-1", "In Progress"), ticket("DM-1.1", "Done", "DM-1")]);
    expect(told).toEqual([]);
  });

  it("tells it once, and not again at the next pass or after a start", async () => {
    await move([ticket("DM-1", "Awaiting acceptance")], [ticket("DM-1", "Done")]);
    await actions.onTrackerChanged(paseo, "demo");
    actions = start();
    await actions.catchUpAfterStart(paseo);
    expect(told.map((entry) => [entry.path, entry.ticket])).toEqual([["messages/ticket-done.md", "DM-1"]]);
  });

  it("tells it after a start when the ticket went Done during the reload", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Awaiting acceptance")]);
    await actions.primeStatuses();
    actions = start();
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done")]);
    await actions.catchUpAfterStart(paseo);
    expect(told.map((entry) => [entry.path, entry.ticket])).toEqual([["messages/ticket-done.md", "DM-1"]]);
  });

  it("tells it at a later pass when no manager was live, and releases the ticket's mid-turn owner meanwhile", async () => {
    const archived: string[] = [];
    const releasing = { ...paseo, agents: { ref: (id: string) => ({ archive: async () => void archived.push(id) }) } } as unknown as PaseoApi;
    vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => live.find((candidate) => candidate.id === id) ?? null);
    live = [agent("one", "DM-1", "owner", "running")];
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Awaiting acceptance")]);
    await actions.primeStatuses();
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done")]);
    await actions.onTrackerChanged(releasing, "demo");
    expect(told).toEqual([]);

    live = [agent("one", "DM-1", "owner", "idle")];
    await actions.onAgentTurnEnded(releasing, "one");
    expect(archived).toEqual(["one"]);

    live = [manager];
    await actions.onTrackerChanged(releasing, "demo");
    expect(told.map((entry) => [entry.path, entry.ticket])).toEqual([["messages/ticket-done.md", "DM-1"]]);
  });
});

describe("the dependency-cleared message", () => {
  it("fills every placeholder the wake-up passes", async () => {
    const { message: realMessage, TEMPLATES } = await vi.importActual<typeof import("./package-files")>("./package-files");
    const recount = await realMessage(TEMPLATES.recount, {
      counting: "1",
      cap: "2",
      countingTickets: "DM-2",
      freeSlots: "1",
      threads: "820 of 2048 (40%)",
      startable: "DM-3",
      waiting: "DM-4 (on DM-1)",
      held: "DM-5 (exclusive rewrite DM-2 first)",
      owned: "DM-6",
    });
    const afterDone = await realMessage(TEMPLATES.afterDone, { merge: "merged 0a1b2c3" });
    const text = await realMessage(TEMPLATES.dependencyCleared, { ticket: "DM-1", status: "Awaiting acceptance", dependents: "DM-4", afterDone, recount });
    expect(text).not.toContain("{{");
    expect(text).toContain("DM-1 is now Awaiting acceptance");
    expect(text).toContain("Merge: merged 0a1b2c3. Do what your standing orders ask once a ticket is Done");
    expect(text).toContain("Tickets that depend on it: DM-4; they can start only once DM-1 is Done.");
    expect(text).toContain("trust it over your own count: owners counting towards the cap 1 of 2 (DM-2), so 1 free; threads 820 of 2048 (40%).");
    expect(text).toContain("startable now (no unmet dependency, no HOLD), oldest first: DM-3. Waiting on dependencies: DM-4 (on DM-1). Held: DM-5 (exclusive rewrite DM-2 first). Queued but already with an owner (counted above): DM-6.");
  });

  it("fills every placeholder of the short Done message (TR-147)", async () => {
    const { message: realMessage, TEMPLATES } = await vi.importActual<typeof import("./package-files")>("./package-files");
    const afterDone = await realMessage(TEMPLATES.afterDone, { merge: "not merged — GitHub refused the squash" });
    const text = await realMessage(TEMPLATES.ticketDone, { ticket: "DM-1", afterDone });
    expect(text).not.toContain("{{");
    expect(text).toMatch(/^DM-1 is Done\. Merge: not merged — GitHub refused the squash\. Do what your standing orders ask/);
  });
});

describe("a change made while the plugin was down or stopping still wakes the manager (TR-043)", () => {
  const before = [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")];
  const after = [ticket("DM-1", "Done"), ticket("DM-2", "Queued")];

  it("wakes it after a start for a ticket that went Done during the reload", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    await move(before, before);
    expect(told).toEqual([]);

    // The merge reloads the plugin; the tracker shows Done before the new instance first looks.
    actions = start();
    vi.mocked(listTickets).mockResolvedValue(after);
    await actions.catchUpAfterStart(paseo);
    expect(told.map((entry) => [entry.ticket, entry.status, entry.dependents])).toEqual([["DM-1", "Done", "DM-2"]]);

    // Acted on and stored: a second start says nothing more.
    told = [];
    actions = start();
    await actions.catchUpAfterStart(paseo);
    expect(told).toEqual([]);
  });

  it("wakes it after a start for a slot freed during the reload", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Reviewing"), ticket("DM-2", "Queued")]);
    await actions.primeStatuses();
    actions = start();
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")]);
    await actions.catchUpAfterStart(paseo);
    expect(told.map((entry) => [entry.ticket, entry.status, entry.startable])).toEqual([["DM-1", "Awaiting acceptance", "DM-2"]]);
  });

  it("repeats a wake-up the stop cut short (the TR-040 reload)", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    vi.mocked(listTickets).mockResolvedValue(before);
    await actions.primeStatuses();
    tell = async () => {
      throw new Error("Transport not connected (status: disposed)");
    };
    vi.mocked(listTickets).mockResolvedValue(after);
    await expect(actions.onTrackerChanged(paseo, "demo")).rejects.toThrow("disposed");
    expect(stored.get("demo")?.get("DM-1")).toBe("Awaiting acceptance");

    tell = async (text) => void told.push(flatten(text));
    actions = start();
    await actions.catchUpAfterStart(paseo);
    expect(told.map((entry) => [entry.ticket, entry.status, entry.dependents])).toEqual([["DM-1", "Done", "DM-2"]]);
  });

  it("primes from the tracker when nothing is stored, and stores it", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    vi.mocked(listTickets).mockResolvedValue(after);
    await actions.catchUpAfterStart(paseo);
    expect(told).toEqual([]);
    expect(stored.get("demo")).toEqual(new Map([["DM-1", "Done"], ["DM-2", "Queued"]]));
  });

  it("runs one pass at a time per project, so a later pass is not undone by an earlier one", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "In Progress")]);
    await actions.primeStatuses();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(listTickets).mockImplementationOnce(async () => {
      await gate;
      return [ticket("DM-1", "Reviewing")];
    });
    const first = actions.onTrackerChanged(paseo, "demo");
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Awaiting acceptance")]);
    const second = actions.onTrackerChanged(paseo, "demo");
    release();
    await Promise.all([first, second]);
    expect(stored.get("demo")?.get("DM-1")).toBe("Awaiting acceptance");
  });

  it("compares with the stored statuses when a tracker pass comes before the start's priming", async () => {
    // A freed slot needs the status from before: compared with nothing, it would pass unnoticed.
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Reviewing"), ticket("DM-2", "Queued")]);
    await actions.primeStatuses();
    actions = start();
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")]);
    await actions.onTrackerChanged(paseo, "demo");
    expect(told.map((entry) => [entry.ticket, entry.status])).toEqual([["DM-1", "Awaiting acceptance"]]);
    await actions.primeStatuses();
    await actions.catchUpAfterStart(paseo);
    expect(told).toHaveLength(1);
  });

  it("retries a wake-up that failed at the next pass of the same instance", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    vi.mocked(listTickets).mockResolvedValue(before);
    await actions.primeStatuses();
    tell = async () => {
      throw new Error("daemon busy");
    };
    vi.mocked(listTickets).mockResolvedValue(after);
    await expect(actions.onTrackerChanged(paseo, "demo")).rejects.toThrow("daemon busy");
    tell = async (text) => void told.push(flatten(text));
    await actions.onTrackerChanged(paseo, "demo");
    expect(told.map((entry) => [entry.ticket, entry.status])).toEqual([["DM-1", "Done"]]);
    expect(stored.get("demo")?.get("DM-1")).toBe("Done");
  });

  it("acts on the other changes of a pass when one wake-up fails", async () => {
    dependencies = { "DM-3": ["DM-1"], "DM-4": ["DM-2"] };
    const four = (one: string, two: string) => [ticket("DM-1", one), ticket("DM-2", two), ticket("DM-3", "Queued"), ticket("DM-4", "Queued")];
    vi.mocked(listTickets).mockResolvedValue(four("Awaiting acceptance", "Awaiting acceptance"));
    await actions.primeStatuses();
    tell = async (text) => {
      const entry = JSON.parse(text) as Record<string, string>;
      if (entry.ticket === "DM-1") throw new Error("daemon busy");
      told.push(entry);
    };
    vi.mocked(listTickets).mockResolvedValue(four("Done", "Done"));
    await expect(actions.onTrackerChanged(paseo, "demo")).rejects.toThrow("daemon busy");
    expect(told.map((entry) => entry.ticket)).toEqual(["DM-2"]);
    expect(stored.get("demo")?.get("DM-1")).toBe("Awaiting acceptance");
    expect(stored.get("demo")?.get("DM-2")).toBe("Done");
  });

  it("stores a wake-up held for threads as unseen until it goes out, so a stop meanwhile repeats it", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    vi.mocked(listTickets).mockResolvedValue(before);
    await actions.primeStatuses();
    tell = async () => "held";
    vi.mocked(listTickets).mockResolvedValue(after);
    await actions.onTrackerChanged(paseo, "demo");
    expect(stored.get("demo")?.get("DM-1")).toBe("Awaiting acceptance");
    // The same instance does not hold it twice.
    await actions.onTrackerChanged(paseo, "demo");
    expect(held).toHaveLength(1);

    // Stopped before threads allowed: the held wake-up is dropped, and the next start sends it.
    tell = async (text) => void told.push(flatten(text));
    actions = start();
    await actions.catchUpAfterStart(paseo);
    expect(told.map((entry) => [entry.ticket, entry.status])).toEqual([["DM-1", "Done"]]);
  });

  it("stores a held wake-up's change as seen once it went out", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    vi.mocked(listTickets).mockResolvedValue(before);
    await actions.primeStatuses();
    tell = async () => "held";
    vi.mocked(listTickets).mockResolvedValue(after);
    await actions.onTrackerChanged(paseo, "demo");
    expect(held).toHaveLength(1);
    held[0]?.();
    await vi.waitFor(() => expect(stored.get("demo")?.get("DM-1")).toBe("Done"));
  });

  it("wakes it although releasing the Done ticket's agents failed", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    live = [agent("one", "DM-1", "owner", "idle")];
    vi.mocked(listTickets).mockResolvedValue(before);
    await actions.primeStatuses();
    vi.mocked(projectAgents).mockRejectedValueOnce(new Error("daemon busy"));
    vi.mocked(listTickets).mockResolvedValue(after);
    await expect(actions.onTrackerChanged(paseo, "demo")).rejects.toThrow("daemon busy");
    expect(told.map((entry) => [entry.ticket, entry.status])).toEqual([["DM-1", "Done"]]);
    expect(stored.get("demo")?.get("DM-1")).toBe("Done");
  });
});

// TR-050: TR-043's run 2 created a ticket, started it and set it Awaiting acceptance 5 s apart; the
// commit debounce is 5 s, so the pass after the In Progress commit already read Awaiting acceptance
// and took the ticket for a new one.
describe("a ticket first seen past its owner", () => {
  it("wakes the manager for one first seen in Awaiting acceptance after an onboarded empty tracker", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    await move([], [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")]);
    expect(told.map((entry) => [entry.ticket, entry.status, entry.dependents, entry.waiting])).toEqual([["DM-1", "Awaiting acceptance", "DM-2", "DM-2 (on DM-1)"]]);
  });

  it("wakes it for one created and delivered while the plugin was down, compared with the stored statuses", async () => {
    await move([ticket("DM-1", "In Progress")], [ticket("DM-1", "In Progress")]);
    actions = start();
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "In Progress"), ticket("DM-2", "Awaiting acceptance"), ticket("DM-3", "Queued")]);
    await actions.catchUpAfterStart(paseo);
    // DM-3 is new and startable too, but the slot's wake-up already named it: one message, not two.
    expect(told.map((entry) => [entry.path, entry.ticket, entry.status, entry.startable])).toEqual([["messages/dependency-cleared.md", "DM-2", "Awaiting acceptance", "DM-3"]]);
  });

  it("does not wake it on the first pass over an adopted tracker, with nothing stored and no priming yet", async () => {
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")]);
    await actions.onTrackerChanged(paseo, "demo");
    expect(told).toEqual([]);
  });
});

// TR-100: the tracker conversion onboarded Taro's own tracker again, the plugin had no last look at its
// tickets, and every Done ticket was announced (and recorded) as newly Done.
describe("a tracker onboarded again", () => {
  it("does not announce a ticket again whose status the stats already hold", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    recorded = new Map([["DM-1", "Done"], ["DM-2", "Queued"], ["DM-3", "Done"]]);
    await move([], [ticket("DM-1", "Done"), ticket("DM-2", "Queued"), ticket("DM-3", "Done")]);
    expect(told).toEqual([]);
    expect(stored.get("demo")?.get("DM-1")).toBe("Done");
  });

  it("does so with nothing stored at all", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    recorded = new Map([["DM-1", "Done"], ["DM-2", "Queued"]]);
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Done"), ticket("DM-2", "Queued")]);
    await actions.onTrackerChanged(paseo, "demo");
    expect(told).toEqual([]);
  });

  it("still announces a change the stats do not hold yet", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    recorded = new Map([["DM-1", "Awaiting acceptance"], ["DM-2", "Queued"]]);
    await move([], [ticket("DM-1", "Done"), ticket("DM-2", "Queued")]);
    expect(told.map((entry) => [entry.ticket, entry.status])).toEqual([["DM-1", "Done"]]);
  });

  it("retries a first-seen ticket's failed wake-up although its status was recorded in the failed pass", async () => {
    dependencies = { "DM-2": ["DM-1"] };
    tell = async () => {
      throw new Error("daemon busy");
    };
    vi.mocked(listTickets).mockResolvedValue([]);
    await actions.primeStatuses();
    vi.mocked(listTickets).mockResolvedValue([ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Queued")]);
    await expect(actions.onTrackerChanged(paseo, "demo")).rejects.toThrow("daemon busy");
    expect(recorded.get("DM-1")).toBe("Awaiting acceptance");
    tell = async (text) => void told.push(flatten(text));
    await actions.onTrackerChanged(paseo, "demo");
    expect(told.map((entry) => [entry.ticket, entry.status])).toEqual([["DM-1", "Awaiting acceptance"]]);
  });
});
