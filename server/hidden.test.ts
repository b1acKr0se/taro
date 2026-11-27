// TR-293: hiding a Needs you item takes it out of the board and the counts, lists it, and lets it come back.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredDecision } from "../shared/state";
import { projectAgents, projectArchivedAgents } from "./agents";
import { invalidateBoards, loadBoard } from "./board";
import { hideQuestion, hideTicket, resumeHidden } from "./hide-actions";
import { readHidden } from "./hidden";
import { readHeadroom } from "./headroom";
import type { PaseoApi } from "./host-types";
import { readProjectConfig } from "./projects";
import type { PluginState } from "./state";
import { listTickets, viewTicket } from "./tickets";

vi.mock("./agents", () => ({ projectAgents: vi.fn(), projectArchivedAgents: vi.fn() }));
vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: "/tracker", suggestions: "/nonexistent/taro-suggestions.md" }), readProjectConfig: vi.fn() }));
vi.mock("./headroom", () => ({ readHeadroom: vi.fn() }));
vi.mock("./process", () => ({ runCommand: vi.fn(async () => ({ code: 1, stdout: "", stderr: "gh: not logged in" })) }));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn(), ticketProblems: async () => [] }));

const ticket = (id: string, status: string) => ({ id, title: `${id} title`, status, labels: [], parentTaskId: null, dependencies: [] as string[], acceptanceCriteriaCompleted: 0, acceptanceCriteriaCount: 0, updatedAt: "2026-10-13 15:00" });
const question = (key: string, ticketId: string | null): StoredDecision =>
  ({ key, id: "q", question: `${key}?`, agentId: "a", project: "taro", ticket: ticketId, status: "open", blocking: true, agentRole: ticketId === null ? "manager" : "owner", options: [] }) as unknown as StoredDecision;
const stateOf = (decisions: StoredDecision[]) => ({ allDecisions: async () => decisions, allAgents: async () => ({}), decision: async (key: string) => decisions.find((each) => each.key === key) ?? null }) as unknown as PluginState;
const paseo = {} as PaseoApi;

let home = "";
const previousHome = process.env.PASEO_HOME;
let tickets: ReturnType<typeof ticket>[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "taro-hidden-home-"));
  process.env.PASEO_HOME = home;
  invalidateBoards();
  tickets = [ticket("TR-1", "Blocked"), ticket("TR-2", "Blocked")];
  vi.mocked(readProjectConfig).mockReset().mockResolvedValue(null);
  vi.mocked(readHeadroom).mockReset().mockResolvedValue(null);
  vi.mocked(viewTicket).mockReset().mockResolvedValue({ implementationNotes: "", finalSummary: "" } as unknown as Awaited<ReturnType<typeof viewTicket>>);
  vi.mocked(listTickets).mockReset().mockImplementation(async () => tickets as unknown as Awaited<ReturnType<typeof listTickets>>);
  vi.mocked(projectAgents).mockReset().mockResolvedValue([]);
  vi.mocked(projectArchivedAgents).mockReset().mockResolvedValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

const needsYou = (board: Awaited<ReturnType<typeof loadBoard>>) => board.cards.filter((card) => card.column === "needs-you").map((card) => card.id);

describe("hiding a ticket", () => {
  it("offers Hide on a ticket in Needs you, and takes it out of the column, the count and the cards", async () => {
    const before = await loadBoard(paseo, stateOf([]), "taro");
    expect(needsYou(before)).toEqual(["TR-1", "TR-2"]);
    expect(before.cards.every((card) => card.hideable)).toBe(true);
    await hideTicket(paseo, stateOf([]), "taro", "TR-1");
    const after = await loadBoard(paseo, stateOf([]), "taro");
    expect(needsYou(after)).toEqual(["TR-2"]);
    expect(after.totals["needs-you"]).toBe(1);
    expect(after.hidden).toMatchObject([{ kind: "ticket", id: "TR-1", title: "TR-1 title" }]);
  });

  it("is shared: a second read sees the same list, and Resume brings the card back", async () => {
    await hideTicket(paseo, stateOf([]), "taro", "TR-1");
    expect((await readHidden("taro")).map((entry) => entry.key)).toEqual(["ticket:TR-1"]);
    await resumeHidden("taro", "ticket", "TR-1");
    const board = await loadBoard(paseo, stateOf([]), "taro");
    expect(needsYou(board)).toEqual(["TR-1", "TR-2"]);
    expect(board.hidden).toEqual([]);
  });

  it("brings the ticket back by itself when it has something new, and forgets the old hide", async () => {
    await hideTicket(paseo, stateOf([]), "taro", "TR-1");
    tickets = [ticket("TR-1", "Awaiting acceptance"), ticket("TR-2", "Blocked")];
    invalidateBoards();
    expect(needsYou(await loadBoard(paseo, stateOf([]), "taro"))).toEqual(["TR-1", "TR-2"]);
    // Back to what it was: it must not vanish again, as the user did not hide this wait.
    tickets = [ticket("TR-1", "Blocked"), ticket("TR-2", "Blocked")];
    invalidateBoards();
    const board = await loadBoard(paseo, stateOf([]), "taro");
    expect(needsYou(board)).toEqual(["TR-1", "TR-2"]);
    expect(await readHidden("taro")).toEqual([]);
  });

  it("brings it back when a new question waits on the user", async () => {
    await hideTicket(paseo, stateOf([]), "taro", "TR-1");
    vi.mocked(projectAgents).mockResolvedValue([{ id: "o1", title: "o", status: "idle", provider: "claude", pendingPermissions: [], updatedAt: "2026-10-13T14:50:00Z", archivedAt: null, labels: { "taro.role": "owner", "taro.ticket": "TR-1", "taro.project": "taro" } }] as never);
    invalidateBoards();
    const board = await loadBoard(paseo, stateOf([{ ...question("o1:ask", "TR-1"), agentId: "o1" }]), "taro");
    expect(needsYou(board)).toContain("TR-1");
  });

  it("refuses a ticket that is not in Needs you", async () => {
    tickets = [ticket("TR-3", "Queued")];
    await expect(hideTicket(paseo, stateOf([]), "taro", "TR-3")).rejects.toThrow(/not in Needs you/);
    await expect(hideTicket(paseo, stateOf([]), "taro", "TR-9")).rejects.toThrow(/not in Needs you/);
  });

  it("offers no Hide on a ticket whose owner waits on a permission", async () => {
    vi.mocked(projectAgents).mockResolvedValue([{ id: "o1", title: "o", status: "idle", provider: "claude", pendingPermissions: [{ id: "p", name: "Bash", kind: "tool" }], updatedAt: "2026-10-13T14:50:00Z", archivedAt: null, labels: { "taro.role": "owner", "taro.ticket": "TR-1", "taro.project": "taro" } }] as never);
    const board = await loadBoard(paseo, stateOf([]), "taro");
    expect(board.cards.find((card) => card.id === "TR-1")?.hideable).toBe(false);
    await expect(hideTicket(paseo, stateOf([]), "taro", "TR-1")).rejects.toThrow(/permission/);
  });
});

describe("hiding the manager's question", () => {
  it("takes it out of the board and lists it until it is resumed", async () => {
    const decisions = [question("m:ask", null)];
    vi.mocked(projectAgents).mockResolvedValue([{ id: "a", title: "m", status: "idle", provider: "claude", pendingPermissions: [], updatedAt: "2026-10-13T14:50:00Z", archivedAt: null, labels: { "taro.role": "manager", "taro.project": "taro" } }] as never);
    await hideQuestion(stateOf(decisions), "taro", "m:ask");
    const hidden = await loadBoard(paseo, stateOf(decisions), "taro");
    expect(hidden.managerDecisions).toEqual([]);
    expect(hidden.hidden).toMatchObject([{ kind: "question", id: "m:ask", title: "m:ask?" }]);
    await resumeHidden("taro", "question", "m:ask");
    expect((await loadBoard(paseo, stateOf(decisions), "taro")).managerDecisions).toHaveLength(1);
  });

  it("forgets a hidden question once it is no longer open", async () => {
    await hideQuestion(stateOf([question("m:ask", null)]), "taro", "m:ask");
    invalidateBoards();
    await loadBoard(paseo, stateOf([]), "taro");
    expect(await readHidden("taro")).toEqual([]);
  });

  it("refuses a question that is not the manager's", async () => {
    await expect(hideQuestion(stateOf([question("o:ask", "TR-1")]), "taro", "o:ask")).rejects.toThrow(/manager's open questions/);
    await expect(hideQuestion(stateOf([]), "taro", "nope")).rejects.toThrow(/manager's open questions/);
  });
});
