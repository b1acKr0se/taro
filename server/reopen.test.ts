/** Reopen on a Done ticket (TR-229), on a scratch tracker: back to Queued with the user's note, and the manager told once. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { noteRecords } from "../shared/execution";
import { serializeTicket, type Ticket } from "../shared/ticket-format";
import { Actions } from "./actions";
import { fetchLiveAgent, projectAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { appendTicketNote, viewTicket } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

let tracker: string;

vi.mock("./agents", async (original) => ({ ...(await original<typeof import("./agents")>()), fetchLiveAgent: vi.fn(), projectAgents: vi.fn(async () => []) }));
vi.mock("./projects", async (original) => ({
  ...(await original<typeof import("./projects")>()),
  requireProjectConfig: async (project: string) => ({ project, managerAgentId: "manager-1" }),
  projectPaths: async () => ({ tracker }),
}));

const OLD_OWNER = "aaaaaaaa-1111-4111-8111-111111111111";
const RELAUNCHED_OWNER = "bbbbbbbb-2222-4222-8222-222222222222";
const NOTES = [
  `EXECUTION 2026-10-01T10:00Z — owner ${OLD_OWNER}, model claude/sonnet, workspace wks_1, branch taro/tr-7`,
  "EXECUTION 2026-10-01T11:00Z — implementer cccccccc-3333-4333-8333-333333333333, task 1",
  `EXECUTION 2026-10-01T12:00Z — owner ${RELAUNCHED_OWNER}, relaunched; review-head: ${"a".repeat(40)}`,
  "ACCEPTANCE 2026-10-02T09:20Z — merge: merged 0a1b2c3",
].join("\n\n");
const FINAL = "FINAL 2026-10-02T09:30Z — exported notes as Markdown\nPR: https://github.com/acme/notes-app/pull/12";

let managerLive: boolean;
let sent: { agentId: string; text: string }[];
let archived: string[];
let paseo: PaseoApi;
let actions: Actions;

async function writeTicket(overrides: Partial<Ticket> & { id: string }): Promise<void> {
  const ticket: Ticket = {
    title: "Export notes as Markdown",
    status: "Done",
    priority: null,
    labels: [],
    parent: null,
    dependsOn: [],
    created: "2026-10-01T09:00:00Z",
    updated: "2026-10-02T09:30:00Z",
    description: "",
    plan: "",
    criteria: [],
    notes: NOTES,
    finalSummary: FINAL,
    extra: {},
    ...overrides,
  };
  await mkdir(join(tracker, "tickets"), { recursive: true });
  await writeFile(join(tracker, "tickets", `${ticket.id}.md`), serializeTicket(ticket));
}

function ticketFile(id: string): Promise<string> {
  return readFile(join(tracker, "tickets", `${id}.md`), "utf8");
}

beforeEach(async () => {
  tracker = await mkdtemp(join(tmpdir(), "taro-reopen-"));
  managerLive = true;
  sent = [];
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (managerLive && id === "manager-1" ? ({ id, status: "idle" } as unknown as PaseoAgent) : null));
  archived = [];
  paseo = { agents: { ref: (agentId: string) => ({ send: async (text: string) => void sent.push({ agentId, text }), archive: async () => void archived.push(agentId) }) } } as unknown as PaseoApi;
  actions = new Actions({} as PluginState, {} as Supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(tracker, { recursive: true, force: true });
});

describe("Reopen", () => {
  it("sets a Done ticket Queued with a REOPENED record that keeps the final summary indented, and clears it", async () => {
    await writeTicket({ id: "TR-7" });
    const answer = await actions.reopenTicket(paseo, "notes-app", "TR-7", "  Verify the export on prod.  ");
    expect(answer).toBe("TR-7 is reopened and back in Queued: the manager starts a fresh owner.");
    const detail = await viewTicket(tracker, "TR-7");
    expect(detail.status).toBe("Queued");
    expect(detail.finalSummary).toBeNull();
    const records = noteRecords(detail.implementationNotes);
    expect(records).toHaveLength(5);
    expect(records[4]).toMatch(
      new RegExp(
        `^REOPENED \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z — user: "Verify the export on prod\\."; round 2; past owners: ${OLD_OWNER}, ${RELAUNCHED_OWNER}\\n` +
          "previous FINAL:\\n  FINAL 2026-10-02T09:30Z — exported notes as Markdown\\n  PR: https://github.com/acme/notes-app/pull/12$",
      ),
    );
  });

  it("tells the manager once: the ticket, the round, its branch, the note and the past owners", async () => {
    await writeTicket({ id: "TR-7" });
    await actions.reopenTicket(paseo, "notes-app", "TR-7", "Verify the export on prod.");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.agentId).toBe("manager-1");
    expect(sent[0]?.text.split("\n")[0]).toBe("Reopened TR-7 (Export notes as Markdown) for round 2: Verify the export on prod.");
    expect(sent[0]?.text).toContain("on branch `taro/tr-7-2`");
    expect(sent[0]?.text).toContain(`Past owners: ${OLD_OWNER}, ${RELAUNCHED_OWNER}.`);
  });

  it("counts the rounds: a second Reopen is round 3 and names no FINAL when there was none", async () => {
    await writeTicket({ id: "TR-7", notes: `${NOTES}\n\nREOPENED 2026-10-03T08:00Z — user: "check prod"; round 2; past owners: ${OLD_OWNER}`, finalSummary: "" });
    await actions.reopenTicket(paseo, "notes-app", "TR-7", "And the import.");
    const last = noteRecords((await viewTicket(tracker, "TR-7")).implementationNotes).pop();
    expect(last).toMatch(/— user: "And the import\."; round 3; past owners: [^\n]+$/);
    expect(sent[0]?.text).toContain("`taro/tr-7-3`");
  });

  it("reopens with the manager not running: the queue wakes one later", async () => {
    managerLive = false;
    await writeTicket({ id: "TR-7" });
    expect(await actions.reopenTicket(paseo, "notes-app", "TR-7", "Verify it")).toBe("TR-7 is reopened and back in Queued: the manager starts a fresh owner once it runs.");
    expect((await viewTicket(tracker, "TR-7")).status).toBe("Queued");
    expect(sent).toEqual([]);
  });

  it("refuses an In Progress ticket, a child and an empty note, writing nothing", async () => {
    await writeTicket({ id: "TR-7", status: "In Progress", finalSummary: "" });
    await writeTicket({ id: "TR-8" });
    await writeTicket({ id: "TR-8.1", parent: "TR-8" });
    const before = await Promise.all(["TR-7", "TR-8", "TR-8.1"].map(ticketFile));
    await expect(actions.reopenTicket(paseo, "notes-app", "TR-7", "Verify it")).rejects.toThrow("TR-7 is In Progress: only a Done ticket can be reopened.");
    await expect(actions.reopenTicket(paseo, "notes-app", "TR-8.1", "Verify it")).rejects.toThrow("TR-8.1 is part of TR-8; reopen TR-8 instead.");
    await expect(actions.reopenTicket(paseo, "notes-app", "TR-8", "  \n ")).rejects.toThrow("Say what the owner should do first.");
    expect(await Promise.all(["TR-7", "TR-8", "TR-8.1"].map(ticketFile))).toEqual(before);
    expect(sent).toEqual([]);
  });
  // Review S1: an owner that set Done and is still writing its last message is released only while the ticket stays Done.
  it("refuses while the last round's owner is still in its turn, writing nothing", async () => {
    await writeTicket({ id: "TR-7" });
    vi.mocked(projectAgents).mockResolvedValue([{ id: RELAUNCHED_OWNER, status: "running", labels: { "taro.ticket": "TR-7" }, updatedAt: "2026-10-02T09:31:00Z" } as unknown as PaseoAgent]);
    const before = await ticketFile("TR-7");
    await expect(actions.reopenTicket(paseo, "notes-app", "TR-7", "Verify it")).rejects.toThrow("TR-7's owner is still finishing its last turn; reopen it in a minute.");
    expect(await ticketFile("TR-7")).toBe(before);
    expect(sent).toEqual([]);
    expect(archived).toEqual([]);
  });

  it("archives an idle owner the release has not archived yet, then reopens", async () => {
    await writeTicket({ id: "TR-7" });
    vi.mocked(projectAgents).mockResolvedValue([{ id: RELAUNCHED_OWNER, status: "idle", labels: { "taro.ticket": "TR-7" }, updatedAt: "2026-10-02T09:31:00Z" } as unknown as PaseoAgent]);
    await actions.reopenTicket(paseo, "notes-app", "TR-7", "Verify it");
    expect(archived).toEqual([RELAUNCHED_OWNER]);
    expect((await viewTicket(tracker, "TR-7")).status).toBe("Queued");
  });

  // Review B1: two Reopens at once (the card and the phone) open one round.
  it("opens one round when two Reopens arrive together", async () => {
    await writeTicket({ id: "TR-7" });
    const results = await Promise.allSettled([actions.reopenTicket(paseo, "notes-app", "TR-7", "Verify it"), actions.reopenTicket(paseo, "notes-app", "TR-7", "Verify it too")]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const detail = await viewTicket(tracker, "TR-7");
    expect(noteRecords(detail.implementationNotes).filter((record) => record.startsWith("REOPENED"))).toHaveLength(1);
    expect(detail.status).toBe("Queued");
    expect(sent).toHaveLength(1);
  });

  it("refuses when the ticket changed between its read and the write, writing nothing more", async () => {
    await writeTicket({ id: "TR-7" });
    // A late note from the old owner lands while Reopen looks for live owners.
    vi.mocked(projectAgents).mockImplementation(async () => {
      await appendTicketNote(tracker, "TR-7", "MILESTONE 2026-10-02T09:32Z — last words");
      return [];
    });
    await expect(actions.reopenTicket(paseo, "notes-app", "TR-7", "Verify it")).rejects.toThrow("TR-7 changed while it was being reopened; try again.");
    const detail = await viewTicket(tracker, "TR-7");
    expect(detail.status).toBe("Done");
    expect(detail.implementationNotes).not.toContain("REOPENED");
    expect(sent).toEqual([]);
  });
});
