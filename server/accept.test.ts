// TR-031: Accept records ACCEPTED on the ticket so the card says it is merging. TR-141: the plugin
// runs the merge itself and wakes no owner; a surprise goes to the owner while its cache is warm
// (last turn under five minutes ago), else to a fresh owner that reads the ticket.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AcceptOutcome } from "../shared/accept-merge";
import type { StoredDecision } from "../shared/state";
import { acceptLocalBranch, acceptPullRequest } from "./accept-merge";
import { Actions } from "./actions";
import { listTaroAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { listProjectConfigs, requireProjectConfig } from "./projects";
import type { Recovery } from "./recovery";
import { sendWithoutInterrupting } from "./send";
import { isStopping } from "./stopping";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { appendTicketNote, closeTicket, listTickets, recordChangesRequested, viewTicket } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", async (original) => ({ ...(await original<typeof import("./agents")>()), listTaroAgents: vi.fn() }));
vi.mock("./projects", () => ({ listProjectConfigs: vi.fn(async () => []), projectPaths: async () => ({ tracker: "/tracker" }), requireProjectConfig: vi.fn() }));
vi.mock("./tickets", () => ({
  listTickets: vi.fn(async () => []),
  viewTicket: vi.fn(),
  appendTicketNote: vi.fn(async () => undefined),
  closeTicket: vi.fn(async () => undefined),
  recordChangesRequested: vi.fn(async () => undefined),
}));
vi.mock("./evidence", () => ({ requireCompleteEvidence: async () => undefined }));
vi.mock("./send", () => ({ sendUserAnswer: vi.fn(async () => undefined), sendWithoutInterrupting: vi.fn(async () => undefined), sendFromPlugin: vi.fn(async () => undefined) }));
vi.mock("./accept-merge", () => ({ acceptPullRequest: vi.fn(), acceptLocalBranch: vi.fn() }));
vi.mock("./stopping", async (original) => ({ ...(await original<typeof import("./stopping")>()), isStopping: vi.fn(() => false) }));
vi.mock("./models", () => ({ bypassModeId: async () => null }));
vi.mock("./environment", () => ({ taroEnvironment: async () => ({}) }));
vi.mock("./package-files", async (original) => ({
  ...(await original<typeof import("./package-files")>()),
  skillDirectory: async () => "/skill",
  message: async (template: string, values: Record<string, string>) => `${template} ${JSON.stringify(values)}`,
}));

const head = "b".repeat(40);
const url = "https://example.test/o/r/pull/7";
const now = Date.now();
let actions: Actions;
let lastTurnEndedAt: string | null;
let ownerStatus: string;
const archived: string[] = [];
const created: { prompt: string; labels: Record<string, string> }[] = [];

const paseo = {
  agents: { ref: (id: string) => ({ archive: async () => void archived.push(id) }) },
  workspaces: { ref: () => ({ agents: { create: async (input: { prompt: string; labels: Record<string, string> }) => void created.push(input) } }) },
} as unknown as PaseoApi;

function owner(): PaseoAgent {
  return { id: "owner-1", status: ownerStatus, workspaceId: "wks_1", updatedAt: new Date(now - 3_600_000).toISOString(), labels: { "taro.project": "demo", "taro.role": "owner", "taro.ticket": "DM-1" } } as unknown as PaseoAgent;
}

function config(parts: Record<string, unknown>) {
  vi.mocked(requireProjectConfig).mockResolvedValue({ project: "demo", baseBranch: "main", repoPath: "/repo", acceptAlsoMerges: true, delivery: "local-only", mergeMethod: "merge", owner: { model: "claude/sonnet", thinking: "" }, ...parts } as never);
}

function ticket(notes: string, labels: string[] = []) {
  vi.mocked(viewTicket).mockResolvedValue({ title: "Demo", status: "Awaiting acceptance", implementationNotes: notes, finalSummary: null, labels } as never);
}

function outcome(result: AcceptOutcome) {
  vi.mocked(acceptLocalBranch).mockResolvedValue(result);
  vi.mocked(acceptPullRequest).mockResolvedValue(result);
}

function written(): string[] {
  return vi.mocked(appendTicketNote).mock.calls.map((call) => call[2]);
}

let stored: StoredDecision[] = [];

async function accept(): Promise<void> {
  await actions.accept(paseo, "demo", "DM-1");
  await actions.acceptRunning("demo", "DM-1");
}

beforeEach(() => {
  vi.clearAllMocks();
  archived.length = 0;
  created.length = 0;
  lastTurnEndedAt = new Date(now - 3 * 3_600_000).toISOString();
  ownerStatus = "idle";
  vi.mocked(listTaroAgents).mockImplementation(async () => [owner()]);
  stored = [];
  const state = { agent: async () => ({ lastTurnEndedAt }), allDecisions: async () => stored, updateDecisions: async (change: (decisions: never[]) => unknown) => change([]), forgetAgent: async () => undefined } as unknown as PluginState;
  const supervisor = { withdrawDecisionsOf: async () => undefined } as unknown as Supervisor;
  actions = new Actions(state, supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
});

describe("accept run by the plugin", () => {
  // TR-146: the user answers the owner's open question before anything merges.
  it("refuses while the owner waits on a question, and runs once it is answered or only investigation-done is open", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    outcome({ kind: "done", acceptance: "ACCEPTANCE x" });
    const question = (id: string, change: Partial<StoredDecision> = {}) =>
      ({ id, project: "demo", ticket: "DM-1", agentRole: "owner", status: "open", ...change }) as StoredDecision;
    stored = [question("count-style", { blocking: false })];
    await expect(actions.accept(paseo, "demo", "DM-1")).rejects.toThrow("DM-1's owner still waits on its question `count-style`: answer it first.");
    expect(written()).toEqual([]);
    expect(vi.mocked(acceptLocalBranch)).not.toHaveBeenCalled();

    // Another ticket's question, a subagent's, an answered one and investigation-done hold nothing.
    stored = [question("count-style", { ticket: "DM-2" }), question("schema", { agentRole: "implementer" }), question("count-style", { status: "answered" }), question("investigation-done")];
    await accept();
    expect(vi.mocked(acceptLocalBranch)).toHaveBeenCalledTimes(1);
  });

  it("fast-forwards a local branch and sets Done without messaging the owner", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — branch taro/dm-1, review-head: ${head}`);
    outcome({ kind: "done", acceptance: "ACCEPTANCE x — merge: merged a → b" });
    await accept();
    expect(written()).toHaveLength(1);
    expect(written()[0]).toMatch(/^ACCEPTED \S+ — the user accepted; merging: into main; by: the plugin$/);
    expect(vi.mocked(acceptLocalBranch).mock.calls[0]?.[0]).toMatchObject({ branches: ["taro/dm-1"], head, baseBranch: "main", repoPath: "/repo", ticket: "DM-1" });
    expect(vi.mocked(closeTicket)).toHaveBeenCalledWith("/tracker", "DM-1", "ACCEPTANCE x — merge: merged a → b");
    expect(vi.mocked(sendWithoutInterrupting)).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it("falls back to the taro branch name when EXECUTION names none", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    outcome({ kind: "done", acceptance: "ACCEPTANCE x" });
    await accept();
    expect(vi.mocked(acceptLocalBranch).mock.calls[0]?.[0]).toMatchObject({ branches: ["taro/dm-1"] });
  });

  it("uses the owner's branch when a reviewer's record comes after it, then the taro branch", async () => {
    config({});
    ticket(
      `EXECUTION 2026-01-01T00:00Z — owner agent owner-1, workspace wks_1, worktree /w, branch feature/dm-1, review-head: ${head}\n` +
        "EXECUTION 2026-01-01T01:00Z — reviewer r (claude/opus), checking the whole branch at 1826b13",
    );
    outcome({ kind: "done", acceptance: "ACCEPTANCE x" });
    await accept();
    expect(vi.mocked(acceptLocalBranch).mock.calls[0]?.[0]).toMatchObject({ branches: ["feature/dm-1", "taro/dm-1"] });
  });

  it("records nothing when a stop cut the steps off, leaving them to resume at start", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    vi.mocked(acceptLocalBranch).mockImplementation(async () => {
      vi.mocked(isStopping).mockReturnValue(true);
      return { kind: "not-merged", reason: "git could not read the main checkout: Taro is stopping" };
    });
    await accept();
    vi.mocked(isStopping).mockReturnValue(false);
    expect(written()).toHaveLength(1);
    expect(written()[0]).toMatch(/^ACCEPTED .*by: the plugin$/);
    expect(vi.mocked(closeTicket)).not.toHaveBeenCalled();
    expect(vi.mocked(sendWithoutInterrupting)).not.toHaveBeenCalled();
  });

  it("merges a pull request with the project's method", async () => {
    config({ delivery: "pull-request", mergeMethod: "squash", baseBranch: "develop" });
    ticket(`EXECUTION 2026-01-01T00:00Z — pr: ${url}, review-head: ${head}`);
    outcome({ kind: "done", acceptance: "ACCEPTANCE x — merge: merged c" });
    await accept();
    expect(written()[0]).toMatch(/merging: the pull request; by: the plugin$/);
    expect(vi.mocked(acceptPullRequest).mock.calls[0]?.[0]).toMatchObject({ url, head, method: "squash", baseBranch: "develop" });
    expect(vi.mocked(closeTicket)).toHaveBeenCalledOnce();
    expect(vi.mocked(sendWithoutInterrupting)).not.toHaveBeenCalled();
  });

  it("closes an investigation, and a project that does not merge, with merge: none and nothing run", async () => {
    config({});
    ticket("", ["investigation"]);
    await accept();
    config({ acceptAlsoMerges: false });
    ticket("");
    await accept();
    expect(written().map((text) => text.replace(/^ACCEPTED \S+/, "ACCEPTED"))).toEqual(["ACCEPTED — the user accepted; merging: none; by: the plugin", "ACCEPTED — the user accepted; merging: none; by: the plugin"]);
    const closed = vi.mocked(closeTicket).mock.calls.map((call) => call[2]);
    expect(closed).toHaveLength(2);
    expect(closed[0]).toMatch(/^ACCEPTANCE \S+ — user: "I accept DM-1\." An investigation: nothing to merge;.*merge: none$/);
    expect(closed[1]).toMatch(/does not merge on Accept;.*merge: none$/);
    expect(vi.mocked(acceptLocalBranch)).not.toHaveBeenCalled();
    expect(vi.mocked(sendWithoutInterrupting)).not.toHaveBeenCalled();
  });

  it("records NOT-MERGED itself, waking no owner", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    outcome({ kind: "not-merged", reason: "the main checkout is dirty; clean it, then Accept again" });
    await accept();
    expect(written()[1]).toMatch(/^NOT-MERGED \S+ — the main checkout is dirty; clean it, then Accept again$/);
    expect(vi.mocked(closeTicket)).not.toHaveBeenCalled();
    expect(vi.mocked(sendWithoutInterrupting)).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it("refuses a second Accept while the first runs", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    let finish: (value: AcceptOutcome) => void = () => undefined;
    vi.mocked(acceptLocalBranch).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await actions.accept(paseo, "demo", "DM-1");
    await expect(actions.accept(paseo, "demo", "DM-1")).rejects.toThrow(/already being accepted/);
    finish({ kind: "done", acceptance: "ACCEPTANCE x" });
    await actions.acceptRunning("demo", "DM-1");
    expect(actions.acceptRunning("demo", "DM-1")).toBeUndefined();
  });

  // TR-191: the Needs you card and the chat pressed in the same instant, both calls still in their checks.
  it("takes only one of two Accepts pressed at once, writing one ACCEPTED", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    outcome({ kind: "done", acceptance: "ACCEPTANCE x" });
    const results = await Promise.allSettled([actions.accept(paseo, "demo", "DM-1"), actions.accept(paseo, "demo", "DM-1")]);
    await actions.acceptRunning("demo", "DM-1");
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(results[1]).toMatchObject({ reason: new Error("DM-1 is already being accepted.") });
    expect(written()).toHaveLength(1);
    expect(vi.mocked(acceptLocalBranch)).toHaveBeenCalledOnce();
  });

  it("frees the ticket for another Accept once one is refused", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    outcome({ kind: "done", acceptance: "ACCEPTANCE x" });
    stored = [{ id: "count-style", project: "demo", ticket: "DM-1", agentRole: "owner", status: "open" } as StoredDecision];
    await expect(actions.accept(paseo, "demo", "DM-1")).rejects.toThrow(/waits on its question/);
    stored = [];
    await accept();
    expect(vi.mocked(acceptLocalBranch)).toHaveBeenCalledOnce();
  });
});

describe("a surprise goes to a warm owner or a fresh one", () => {
  const found = "main moved to c since taro/dm-1; rebase onto it";

  it("tells the owner when its last turn ended under five minutes ago", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    lastTurnEndedAt = new Date(now - 4 * 60_000).toISOString();
    outcome({ kind: "surprise", found });
    await accept();
    const sent = vi.mocked(sendWithoutInterrupting).mock.calls[0];
    expect(sent?.[1]).toBe("owner-1");
    expect(sent?.[2]).toContain("messages/accept.md");
    expect(sent?.[2]).toContain(found);
    expect(sent?.[2]).toContain(`still the recorded review head ${head}`);
    expect(created).toEqual([]);
    expect(written()[1]).toMatch(/^ACCEPT-HANDOFF \S+ — Same owner, active 4 min ago: owner-1 took it\. The plugin stopped: main moved to c since taro\/dm-1; rebase onto it$/);
  });

  it("tells a mid-turn owner, however long ago its last turn ended", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    ownerStatus = "running";
    outcome({ kind: "surprise", found });
    await accept();
    expect(vi.mocked(sendWithoutInterrupting)).toHaveBeenCalledOnce();
    expect(created).toEqual([]);
    expect(written()[1]).toMatch(/ — Same owner, mid-turn: owner-1 took it\. The plugin stopped: main moved/);
  });

  it("starts a fresh owner with the found problem when the owner has been idle longer, archiving the old one", async () => {
    config({ delivery: "pull-request" });
    ticket(`EXECUTION 2026-01-01T00:00Z — workspace wks_1, pr: ${url}, review-head: ${head}`);
    lastTurnEndedAt = new Date(now - 6 * 60_000).toISOString();
    outcome({ kind: "surprise", found: "gh pr merge failed: conflict" });
    await accept();
    expect(vi.mocked(sendWithoutInterrupting)).not.toHaveBeenCalled();
    expect(archived).toEqual(["owner-1"]);
    expect(created).toHaveLength(1);
    expect(created[0]?.labels).toMatchObject({ "taro.role": "owner", "taro.ticket": "DM-1" });
    expect(created[0]?.prompt).toContain("messages/relaunch-owner.md");
    expect(created[0]?.prompt).toContain("messages/accept-fresh-owner.md");
    expect(created[0]?.prompt).toContain("gh pr merge failed: conflict");
    expect(created[0]?.prompt).toContain(`--match-head-commit ${head}`);
    expect(written()[1]).toMatch(/^ACCEPT-HANDOFF \S+ — Fresh owner, idle 6 min: the owner owner-1 was idle past the 5 min its context stays cached, so \S+ took over\. The plugin stopped: gh pr merge failed: conflict$/);
  });

  it("hands a ticket without a review head to an owner before recording ACCEPTED, so the card keeps Accept", async () => {
    config({});
    ticket("EXECUTION 2026-01-01T00:00Z — workspace wks_1");
    await actions.accept(paseo, "demo", "DM-1");
    expect(written().some((text) => text.startsWith("ACCEPTED"))).toBe(false);
    expect(created[0]?.prompt).toContain("Do not merge: the ticket records no review-head");
    expect(vi.mocked(acceptLocalBranch)).not.toHaveBeenCalled();
  });

  it("hands over a pull request without a recorded URL the same way", async () => {
    config({ delivery: "pull-request" });
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    lastTurnEndedAt = new Date(now - 60_000).toISOString();
    await actions.accept(paseo, "demo", "DM-1");
    expect(written().some((text) => text.startsWith("ACCEPTED"))).toBe(false);
    expect(vi.mocked(sendWithoutInterrupting).mock.calls[0]?.[2]).toContain("the ticket records no PR URL");
  });
});

describe("resuming after a restart", () => {
  it("runs the steps again for a ticket whose plugin Accept was cut off, and only for it", async () => {
    config({});
    vi.mocked(listProjectConfigs).mockResolvedValue([{ project: "demo" }] as never);
    vi.mocked(listTickets).mockResolvedValue([
      { id: "DM-1", status: "Awaiting acceptance" },
      { id: "DM-2", status: "Awaiting acceptance" },
      { id: "DM-3", status: "Done" },
    ] as never);
    const notes: Record<string, string> = {
      "DM-1": `EXECUTION 2026-01-01T00:00Z — review-head: ${head}\nACCEPTED 2026-01-02T00:00Z — the user accepted; merging: into main; by: the plugin`,
      // An owner-run Accept from before TR-141: the owner is on it.
      "DM-2": `EXECUTION 2026-01-01T00:00Z — review-head: ${head}\nACCEPTED 2026-01-02T00:00Z — the user accepted; merging: into main`,
    };
    vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => ({ status: "Awaiting acceptance", implementationNotes: notes[id] ?? "", finalSummary: null, labels: [] }) as never);
    outcome({ kind: "done", acceptance: "ACCEPTANCE x" });
    const restarted = actions as unknown as { lastStatuses: Map<string, Map<string, string>>; state: PluginState };
    Object.assign(restarted.state, { ticketStatuses: async () => [], saveTicketStatuses: async () => undefined });
    vi.spyOn(actions, "onTrackerChanged").mockResolvedValue(undefined as never);
    await actions.catchUpAfterStart(paseo);
    await actions.acceptRunning("demo", "DM-1");
    expect(vi.mocked(acceptLocalBranch)).toHaveBeenCalledOnce();
    expect(vi.mocked(closeTicket)).toHaveBeenCalledWith("/tracker", "DM-1", "ACCEPTANCE x");
  });
});

describe("requestChanges (TR-131)", () => {
  it("tells the owner, then records CHANGES-REQUESTED through the write that ends the delivery", async () => {
    await actions.requestChanges({} as PaseoApi, "demo", "DM-1", "  Rename the button  ");
    expect(vi.mocked(sendWithoutInterrupting)).toHaveBeenCalledOnce();
    expect(vi.mocked(sendWithoutInterrupting).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(recordChangesRequested).mock.invocationCallOrder[0] ?? 0);
    expect(vi.mocked(recordChangesRequested)).toHaveBeenCalledWith("/tracker", "DM-1", expect.stringMatching(/^CHANGES-REQUESTED \S+ — the user: "Rename the button"$/));
    expect(written()).toEqual([]);
  });

  it("ends nothing when the owner could not be told", async () => {
    vi.mocked(sendWithoutInterrupting).mockRejectedValueOnce(new Error("gone"));
    await expect(actions.requestChanges({} as PaseoApi, "demo", "DM-1", "Rename it")).rejects.toThrow("gone");
    expect(vi.mocked(recordChangesRequested)).not.toHaveBeenCalled();
  });

  it("fails, saying the words went, when the ticket could not be moved to In Progress, so the card stays", async () => {
    vi.mocked(recordChangesRequested).mockRejectedValueOnce(new Error("tracker locked"));
    await expect(actions.requestChanges({} as PaseoApi, "demo", "DM-1", "Rename it")).rejects.toThrow("Sent to the owner, but DM-1 could not be moved to In Progress: tracker locked");
    expect(vi.mocked(sendWithoutInterrupting)).toHaveBeenCalledOnce();
  });

  // TR-191: changes sent from another surface while the merge runs would send the owner to work the merge then closes.
  it("refuses changes while the ticket is being accepted, and takes them once the Accept settled", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    let finish: (value: AcceptOutcome) => void = () => undefined;
    vi.mocked(acceptLocalBranch).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await actions.accept(paseo, "demo", "DM-1");
    await expect(actions.requestChanges({} as PaseoApi, "demo", "DM-1", "Rename it")).rejects.toThrow("DM-1 is being accepted: wait for the merge to finish.");
    expect(vi.mocked(sendWithoutInterrupting)).not.toHaveBeenCalled();
    expect(vi.mocked(recordChangesRequested)).not.toHaveBeenCalled();
    finish({ kind: "not-merged", reason: "the main checkout is dirty" });
    await actions.acceptRunning("demo", "DM-1");
    await actions.requestChanges({} as PaseoApi, "demo", "DM-1", "Rename it");
    expect(vi.mocked(recordChangesRequested)).toHaveBeenCalledOnce();
  });

  it("refuses changes pressed in the same instant as Accept, whichever came first", async () => {
    config({});
    ticket(`EXECUTION 2026-01-01T00:00Z — review-head: ${head}`);
    outcome({ kind: "done", acceptance: "ACCEPTANCE x" });
    const acceptFirst = await Promise.allSettled([actions.accept(paseo, "demo", "DM-1"), actions.requestChanges({} as PaseoApi, "demo", "DM-1", "Rename it")]);
    await actions.acceptRunning("demo", "DM-1");
    expect(acceptFirst.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(vi.mocked(recordChangesRequested)).not.toHaveBeenCalled();

    const changesFirst = await Promise.allSettled([actions.requestChanges({} as PaseoApi, "demo", "DM-1", "Rename it"), actions.accept(paseo, "demo", "DM-1")]);
    expect(changesFirst.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(changesFirst[1]).toMatchObject({ reason: new Error("DM-1's changes are being sent to its owner: Accept is off until they are.") });
    expect(vi.mocked(recordChangesRequested)).toHaveBeenCalledOnce();
    expect(vi.mocked(acceptLocalBranch)).toHaveBeenCalledOnce();
  });
});
