// TR-257: the project-wide auto-accept switch. The sweep accepts a ticket only with the switch on and
// a complete record; everything else keeps the user's Accept. Bulk Accept works with the switch off.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredDecision } from "../shared/state";
import { acceptLocalBranch } from "./accept-merge";
import { Actions } from "./actions";
import { listTaroAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { readProjectConfig, requireProjectConfig, updateProjectConfig } from "./projects";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { appendTicketNote, closeTicket, listTickets, viewTicket } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", async (original) => ({ ...(await original<typeof import("./agents")>()), listTaroAgents: vi.fn() }));
vi.mock("./projects", () => ({
  listProjectConfigs: vi.fn(async () => []),
  projectPaths: async () => ({ tracker: "/tracker" }),
  requireProjectConfig: vi.fn(),
  readProjectConfig: vi.fn(),
  updateProjectConfig: vi.fn(),
}));
vi.mock("./tickets", () => ({
  listTickets: vi.fn(async () => []),
  viewTicket: vi.fn(),
  appendTicketNote: vi.fn(async () => undefined),
  closeTicket: vi.fn(async () => undefined),
  recordChangesRequested: vi.fn(async () => undefined),
}));
vi.mock("./evidence", () => ({ requireCompleteEvidence: async () => undefined, ticketEvidence: vi.fn(async () => ({ complete: true, missing: [] })) }));
vi.mock("./send", () => ({ sendUserAnswer: vi.fn(async () => undefined), sendWithoutInterrupting: vi.fn(async () => undefined), sendFromPlugin: vi.fn(async () => undefined) }));
vi.mock("./accept-merge", () => ({ acceptPullRequest: vi.fn(), acceptLocalBranch: vi.fn(async () => ({ kind: "done", acceptance: "ACCEPTANCE x" })) }));
vi.mock("./stopping", async (original) => ({ ...(await original<typeof import("./stopping")>()), isStopping: vi.fn(() => false) }));
vi.mock("./models", () => ({ bypassModeId: async () => null }));
vi.mock("./environment", () => ({ taroEnvironment: async () => ({}) }));
vi.mock("./package-files", async (original) => ({ ...(await original<typeof import("./package-files")>()), skillDirectory: async () => "/skill", message: async () => "message" }));

const head = "c".repeat(40);
const complete = `EXECUTION 2026-11-01T10:00Z — branch taro/dm-1, review-head: ${head}\n\nEVIDENCE 2026-11-01T09:00Z — checks\ncheck: npm test — green`;
let actions: Actions;
let stored: StoredDecision[];
let config: Record<string, unknown>;
let notes: Record<string, string>;

const paseo = { agents: { ref: () => ({ archive: async () => undefined }) } } as unknown as PaseoApi;

function agent(): PaseoAgent {
  return { id: "owner-1", status: "idle", workspaceId: "wks_1", updatedAt: new Date().toISOString(), labels: { "taro.project": "demo", "taro.role": "owner", "taro.ticket": "DM-1" } } as unknown as PaseoAgent;
}

function written(): string[] {
  return vi.mocked(appendTicketNote).mock.calls.map((call) => call[2]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appendTicketNote).mockReset().mockResolvedValue(undefined);
  config = { project: "demo", baseBranch: "main", repoPath: "/repo", acceptAlsoMerges: true, delivery: "local-only", mergeMethod: "merge", autoAccept: true, autoAcceptHold: [] };
  notes = { "DM-1": complete, "DM-2": complete };
  stored = [];
  vi.mocked(requireProjectConfig).mockImplementation(async () => config as never);
  vi.mocked(readProjectConfig).mockImplementation(async () => config as never);
  vi.mocked(updateProjectConfig).mockImplementation(async (_project, patch) => ((config = { ...config, ...patch }), config as never));
  vi.mocked(listTickets).mockImplementation(async () => [
    { id: "DM-1", title: "One", status: "Awaiting acceptance" },
    { id: "DM-2", title: "Two", status: "Awaiting acceptance" },
    { id: "DM-3", title: "Three", status: "In Progress" },
  ] as never);
  vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => ({ title: id, status: "Awaiting acceptance", implementationNotes: notes[id] ?? "", finalSummary: "Final.", labels: ["complexity-low"] }) as never);
  vi.mocked(listTaroAgents).mockImplementation(async () => [agent()]);
  const state = { agent: async () => ({ lastTurnEndedAt: null }), allDecisions: async () => stored, updateDecisions: async () => undefined, forgetAgent: async () => undefined } as unknown as PluginState;
  actions = new Actions(state, { withdrawDecisionsOf: async () => undefined } as unknown as Supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
});

async function sweep(): Promise<void> {
  await actions.sweepAutoAccept(paseo, "demo");
  await Promise.all([actions.acceptRunning("demo", "DM-1"), actions.acceptRunning("demo", "DM-2")]);
}

describe("the auto-accept sweep", () => {
  it("does nothing while the switch is off", async () => {
    config.autoAccept = false;
    await sweep();
    expect(written()).toEqual([]);
    expect(vi.mocked(acceptLocalBranch)).not.toHaveBeenCalled();
  });

  it("accepts each ticket with a complete record, recording the time and that auto-accept was on", async () => {
    await sweep();
    expect(vi.mocked(acceptLocalBranch)).toHaveBeenCalledTimes(2);
    const notesWritten = written();
    expect(notesWritten.filter((text) => /^AUTO-ACCEPT \S+ — auto-accept was on$/.test(text))).toHaveLength(2);
    expect(notesWritten.filter((text) => /^ACCEPTED \S+ — auto-accept was on; merging: into main; by: the plugin$/.test(text))).toHaveLength(2);
    expect(notesWritten.some((text) => text.includes("the user accepted"))).toBe(false);
  });

  it("leaves a held ticket to the user's Accept", async () => {
    config.autoAcceptHold = ["DM-1"];
    await sweep();
    expect(vi.mocked(acceptLocalBranch)).toHaveBeenCalledTimes(1);
    expect(written().every((text) => !text.includes("DM-1"))).toBe(true);
  });

  it("leaves a ticket with an open review blocker, an open question or incomplete evidence", async () => {
    notes["DM-1"] = `${complete}\n\nREVIEW 2026-11-01T09:30Z — round one\nblockers-open: 1\nverdict: findings`;
    stored = [{ id: "plan", project: "demo", ticket: "DM-2", agentRole: "owner", status: "open" } as StoredDecision];
    await sweep();
    expect(vi.mocked(acceptLocalBranch)).not.toHaveBeenCalled();
    expect(written()).toEqual([]);
  });

  it("leaves a ticket whose owner is gone", async () => {
    vi.mocked(listTaroAgents).mockImplementation(async () => []);
    await sweep();
    expect(written()).toEqual([]);
  });

  it("does not retry a ticket it failed on at the same head", async () => {
    vi.mocked(appendTicketNote).mockRejectedValue(new Error("boom"));
    await sweep();
    const first = vi.mocked(appendTicketNote).mock.calls.length;
    expect(first).toBeGreaterThan(0);
    await sweep();
    expect(vi.mocked(appendTicketNote).mock.calls.length).toBe(first);
  });
});

describe("a ticket that changed while the batch ran", () => {
  // DM-1's merge is what runs first; by the time the batch reaches DM-2 its owner is working again.
  function changeSecondDuringFirst(): void {
    vi.mocked(acceptLocalBranch).mockImplementationOnce(async () => {
      vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => ({ title: id, status: id === "DM-2" ? "In Progress" : "Awaiting acceptance", implementationNotes: notes[id] ?? "", finalSummary: "Final.", labels: ["complexity-low"] }) as never);
      return { kind: "done", acceptance: "ACCEPTANCE x" } as never;
    });
  }

  it("is not accepted by the sweep any more", async () => {
    changeSecondDuringFirst();
    await sweep();
    expect(vi.mocked(acceptLocalBranch)).toHaveBeenCalledTimes(1);
    expect(written().filter((text) => text.startsWith("ACCEPTED"))).toHaveLength(1);
  });

  it("is not accepted by the bulk Accept either", async () => {
    changeSecondDuringFirst();
    const result = await actions.acceptWaiting(paseo, "demo");
    expect(result.accepted).toEqual(["DM-1"]);
    expect(result.failed).toEqual([{ id: "DM-2", reason: expect.stringContaining("changed since it was listed") }]);
    expect(written().filter((text) => text.startsWith("ACCEPTED"))).toHaveLength(1);
  });
});

describe("what an auto-accept records and costs", () => {
  it("closes the ticket with the switch, not the user's quoted words, in its ACCEPTANCE", async () => {
    vi.mocked(appendTicketNote).mockImplementation(async (_tracker, id, record) => void (notes[id] = `${notes[id]}\n\n${record}`));
    vi.mocked(acceptLocalBranch).mockResolvedValue({ kind: "done", acceptance: 'ACCEPTANCE t — user: "I accept DM-1." Accepted c; merge: merged a → c' } as never);
    await sweep();
    const closing = vi.mocked(closeTicket).mock.calls.filter((call) => call[1] === "DM-1").map((call) => call[2]);
    expect(closing).toEqual(['ACCEPTANCE t — auto-accept was on: Accepted c; merge: merged a → c']);
  });

  it("keeps the user's words in the ACCEPTANCE of a bulk Accept", async () => {
    vi.mocked(appendTicketNote).mockImplementation(async (_tracker, id, record) => void (notes[id] = `${notes[id]}\n\n${record}`));
    vi.mocked(acceptLocalBranch).mockResolvedValue({ kind: "done", acceptance: 'ACCEPTANCE t — user: "I accept DM-1." Accepted c; merge: merged a → c' } as never);
    await actions.acceptWaiting(paseo, "demo");
    expect(vi.mocked(closeTicket).mock.calls.every((call) => call[2].includes('user: "I accept DM-1."'))).toBe(true);
  });

  it("runs one sweep and one rescan however many times it is asked for", async () => {
    await Promise.all([1, 2, 3, 4, 5].map(() => actions.sweepAutoAccept(paseo, "demo")));
    // Each sweep lists the tracker once; five asks while one runs make one more, not five.
    expect(vi.mocked(listTickets).mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("the bulk Accept", () => {
  it("accepts every waiting ticket with the switch off, as the user's own press", async () => {
    config.autoAccept = false;
    expect((await actions.waitingForAccept(paseo, "demo")).map((each) => each.id)).toEqual(["DM-1", "DM-2"]);
    const result = await actions.acceptWaiting(paseo, "demo");
    expect(result).toEqual({ accepted: ["DM-1", "DM-2"], failed: [] });
    expect(written().filter((text) => text.startsWith("ACCEPTED") && text.includes("the user accepted"))).toHaveLength(2);
    expect(written().some((text) => text.startsWith("AUTO-ACCEPT"))).toBe(false);
  });
});

describe("setting the switch and the hold list", () => {
  it("writes one stored value and notes each newly held ticket", async () => {
    config.autoAccept = false;
    const turnedOn = await actions.setAutoAccept(paseo, "demo", { enabled: true, hold: ["DM-1"] });
    expect(turnedOn).toMatchObject({ autoAccept: true, autoAcceptHold: ["DM-1"] });
    expect(vi.mocked(appendTicketNote).mock.calls.filter((call) => call[1] === "DM-1" && /^AUTO-ACCEPT-HOLD \S+ — held by the user/.test(call[2]))).toHaveLength(1);
    // A hold already there is not noted again; leaving a field out keeps it.
    vi.mocked(appendTicketNote).mockClear();
    const kept = await actions.setAutoAccept(paseo, "demo", { hold: ["DM-1"] });
    expect(kept).toMatchObject({ autoAccept: true, autoAcceptHold: ["DM-1"] });
    expect(vi.mocked(appendTicketNote)).not.toHaveBeenCalled();
    const off = await actions.setAutoAccept(paseo, "demo", { enabled: false });
    expect(off).toMatchObject({ autoAccept: false, autoAcceptHold: ["DM-1"] });
  });

  it("refuses an id that is no ticket of the project and changes nothing", async () => {
    await expect(actions.setAutoAccept(paseo, "demo", { hold: ["DM-99"] })).rejects.toThrow("DM-99 is not a ticket of demo.");
    expect(vi.mocked(updateProjectConfig)).not.toHaveBeenCalled();
  });
});
