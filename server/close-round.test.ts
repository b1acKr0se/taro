/** Close round on a reopened ticket (TR-229), on a scratch tracker: its agents stopped, the ticket Done with nothing merged, the round's workspace archived. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acceptanceMerge, acceptedRecord, noteRecords } from "../shared/execution";
import { reopenRefusal, reopenRound } from "../shared/reopen";
import { serializeTicket, type Ticket } from "../shared/ticket-format";
import { Actions } from "./actions";
import { fetchLiveAgent, listTaroAgents, projectAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { appendTicketNote, viewTicket } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

let tracker: string;

vi.mock("./agents", async (original) => ({ ...(await original<typeof import("./agents")>()), fetchLiveAgent: vi.fn(), projectAgents: vi.fn(async () => []), listTaroAgents: vi.fn(async () => []) }));
vi.mock("./projects", async (original) => ({
  ...(await original<typeof import("./projects")>()),
  requireProjectConfig: async (project: string) => ({ project, managerAgentId: "manager-1" }),
  projectPaths: async () => ({ tracker }),
}));

const OLD_OWNER = "aaaaaaaa-1111-4111-8111-111111111111";
const ROUND_OWNER = "bbbbbbbb-2222-4222-8222-222222222222";
const IMPLEMENTER = "cccccccc-3333-4333-8333-333333333333";
const ROUND_ONE = [`EXECUTION 2026-10-01T10:00Z — owner ${OLD_OWNER}, model claude/sonnet, workspace wks_1, branch taro/tr-7`, "ACCEPTANCE 2026-10-02T09:20Z — merge: merged 0a1b2c3"].join("\n\n");
const REOPENED = `REOPENED 2026-10-03T08:00Z — user: "verify it on prod"; round 2; past owners: ${OLD_OWNER}`;
const ROUND_TWO = `${ROUND_ONE}\n\n${REOPENED}\n\nEXECUTION 2026-10-03T08:05Z — owner ${ROUND_OWNER}, model claude/sonnet, workspace wks_2, branch taro/tr-7-2`;

let sent: string[];
let archived: string[];
let archivedWorkspaces: string[];
let paseo: PaseoApi;
let actions: Actions;

async function writeTicket(overrides: Partial<Ticket> & { id: string }): Promise<void> {
  const ticket: Ticket = {
    title: "Export notes as Markdown",
    status: "In Progress",
    priority: null,
    labels: [],
    parent: null,
    dependsOn: [],
    created: "2026-10-01T09:00:00Z",
    updated: "2026-10-03T08:05:00Z",
    description: "",
    plan: "",
    criteria: [],
    notes: ROUND_TWO,
    finalSummary: "",
    extra: {},
    ...overrides,
  };
  await mkdir(join(tracker, "tickets"), { recursive: true });
  await writeFile(join(tracker, "tickets", `${ticket.id}.md`), serializeTicket(ticket));
}

function ticketFile(id: string): Promise<string> {
  return readFile(join(tracker, "tickets", `${id}.md`), "utf8");
}

function agent(id: string, role: string, ticket: string, status = "running", workspaceId = "wks_2"): PaseoAgent {
  return { id, status, workspaceId, labels: { "taro.role": role, "taro.ticket": ticket }, updatedAt: "2026-10-03T08:10:00Z" } as unknown as PaseoAgent;
}

beforeEach(async () => {
  tracker = await mkdtemp(join(tmpdir(), "taro-close-round-"));
  sent = [];
  archived = [];
  archivedWorkspaces = [];
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (id === "manager-1" ? ({ id, status: "idle" } as unknown as PaseoAgent) : null));
  vi.mocked(projectAgents).mockResolvedValue([agent(ROUND_OWNER, "owner", "TR-7"), agent(IMPLEMENTER, "implementer", "TR-7"), agent("manager-1", "manager", "TR-7", "idle", "wks_manager")]);
  paseo = {
    agents: { ref: (agentId: string) => ({ send: async (text: string) => void sent.push(text), archive: async () => void archived.push(agentId) }) },
    workspaces: { archive: async (workspaceId: string) => void archivedWorkspaces.push(workspaceId) },
  } as unknown as PaseoApi;
  const supervisor = { withdrawDecisionsOf: async () => undefined } as unknown as Supervisor;
  const state = { forgetAgent: async () => undefined } as unknown as PluginState;
  actions = new Actions(state, supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(tracker, { recursive: true, force: true });
});

describe("Close round", () => {
  it("stops the round's owner and subagents mid-turn, records ROUND-CLOSED and sets Done, the final summary left empty", async () => {
    await writeTicket({ id: "TR-7" });
    const answer = await actions.closeRound(paseo, "notes-app", "TR-7");
    expect(answer).toBe("TR-7 is back in Done; its round 2 owner was stopped. Nothing was merged.");
    expect(archived).toEqual([ROUND_OWNER, IMPLEMENTER]);
    expect(archivedWorkspaces).toEqual(["wks_2"]);
    const detail = await viewTicket(tracker, "TR-7");
    expect(detail.status).toBe("Done");
    expect(detail.finalSummary).toBeNull();
    expect(noteRecords(detail.implementationNotes).pop()).toMatch(
      /^ROUND-CLOSED \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z — round 2 closed by the user; nothing from this round was merged; branch taro\/tr-7-2 kept unmerged$/,
    );
    expect(sent).toEqual([]);
  });

  it("reads as Done without delivery: nothing accepted or merged in the round, and Reopen offered again", async () => {
    await writeTicket({ id: "TR-7" });
    await actions.closeRound(paseo, "notes-app", "TR-7");
    const detail = await viewTicket(tracker, "TR-7");
    expect(acceptedRecord(detail.implementationNotes)).toBeNull();
    expect(acceptanceMerge(detail.implementationNotes)).toBeNull();
    expect(reopenRefusal(detail.id, { status: detail.status, parent: detail.parentTaskId, note: "again" })).toBeNull();
  });

  it("closes a Queued round with no owner yet: no branch", async () => {
    vi.mocked(projectAgents).mockResolvedValue([]);
    await writeTicket({ id: "TR-7", status: "Queued", notes: `${ROUND_ONE}\n\n${REOPENED}` });
    expect(await actions.closeRound(paseo, "notes-app", "TR-7")).toBe("TR-7 is back in Done; round 2 had no agent running. Nothing was merged.");
    expect(noteRecords((await viewTicket(tracker, "TR-7")).implementationNotes).pop()).toMatch(/^ROUND-CLOSED \S+ — round 2 closed by the user; nothing from this round was merged$/);
  });

  it("reopens after a closed round as round 3, on taro/tr-7-3", async () => {
    await writeTicket({ id: "TR-7" });
    await actions.closeRound(paseo, "notes-app", "TR-7");
    vi.mocked(projectAgents).mockResolvedValue([]);
    await actions.reopenTicket(paseo, "notes-app", "TR-7", "Now verify it for real.");
    const detail = await viewTicket(tracker, "TR-7");
    expect(detail.status).toBe("Queued");
    expect(reopenRound(detail.implementationNotes)).toBe(3);
    expect(sent.at(-1)).toContain("on branch `taro/tr-7-3`");
    expect(noteRecords(detail.implementationNotes).pop()).toMatch(/^REOPENED \S+ — user: "Now verify it for real\."; round 3; past owners: /);
  });

  it("refuses round 1, Awaiting acceptance, Done and a child, leaving the owner running and the ticket as it was", async () => {
    await writeTicket({ id: "TR-7", notes: ROUND_ONE });
    await writeTicket({ id: "TR-8", status: "Awaiting acceptance" });
    await writeTicket({ id: "TR-9", status: "Done" });
    await writeTicket({ id: "TR-9.1", parent: "TR-9" });
    const ids = ["TR-7", "TR-8", "TR-9", "TR-9.1"];
    const before = await Promise.all(ids.map(ticketFile));
    await expect(actions.closeRound(paseo, "notes-app", "TR-7")).rejects.toThrow("TR-7 was never reopened: there is no round to close.");
    await expect(actions.closeRound(paseo, "notes-app", "TR-8")).rejects.toThrow("TR-8 is awaiting your acceptance: accept it or request changes instead.");
    await expect(actions.closeRound(paseo, "notes-app", "TR-9")).rejects.toThrow("TR-9 is Done: its round is over.");
    await expect(actions.closeRound(paseo, "notes-app", "TR-9.1")).rejects.toThrow("TR-9.1 is part of TR-9; close TR-9's round instead.");
    expect(await Promise.all(ids.map(ticketFile))).toEqual(before);
    expect(archived).toEqual([]);
    expect(archivedWorkspaces).toEqual([]);
  });

  it("keeps the round's workspace while another agent lives in it", async () => {
    await writeTicket({ id: "TR-7" });
    vi.mocked(listTaroAgents).mockResolvedValue([agent(ROUND_OWNER, "owner", "TR-7"), { id: "users-own", status: "idle", workspaceId: "wks_2", labels: {} } as unknown as PaseoAgent]);
    await actions.closeRound(paseo, "notes-app", "TR-7");
    expect(archived).toEqual([ROUND_OWNER, IMPLEMENTER]);
    expect(archivedWorkspaces).toEqual([]);
  });

  it("closes the round despite a last note the owner wrote while being stopped", async () => {
    await writeTicket({ id: "TR-7" });
    vi.mocked(projectAgents).mockImplementation(async () => {
      await appendTicketNote(tracker, "TR-7", "MILESTONE 2026-10-03T08:20Z — last words");
      return [agent(ROUND_OWNER, "owner", "TR-7")];
    });
    await actions.closeRound(paseo, "notes-app", "TR-7");
    const detail = await viewTicket(tracker, "TR-7");
    expect(detail.status).toBe("Done");
    expect(noteRecords(detail.implementationNotes).slice(-2)[0]).toBe("MILESTONE 2026-10-03T08:20Z — last words");
  });

  it("refuses when the ticket was delivered between its read and the write", async () => {
    await writeTicket({ id: "TR-7" });
    vi.mocked(projectAgents).mockImplementation(async () => {
      await writeTicket({ id: "TR-7", status: "Awaiting acceptance" });
      return [];
    });
    await expect(actions.closeRound(paseo, "notes-app", "TR-7")).rejects.toThrow("TR-7 changed while its round was being closed; try again.");
    expect(archivedWorkspaces).toEqual([]);
    const detail = await viewTicket(tracker, "TR-7");
    expect(detail.status).toBe("Awaiting acceptance");
    expect(detail.implementationNotes).not.toContain("ROUND-CLOSED");
  });

  it("closes one round when two Close rounds arrive together", async () => {
    await writeTicket({ id: "TR-7" });
    const results = await Promise.allSettled([actions.closeRound(paseo, "notes-app", "TR-7"), actions.closeRound(paseo, "notes-app", "TR-7")]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(noteRecords((await viewTicket(tracker, "TR-7")).implementationNotes).filter((record) => record.startsWith("ROUND-CLOSED"))).toHaveLength(1);
  });
});
