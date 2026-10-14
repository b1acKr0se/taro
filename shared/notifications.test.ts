import { describe, expect, it } from "vitest";

import type { Board, Card } from "./contracts";
import { freshEntries, needsYouEntries, PRESENCE_MS, REMEMBER_MS, someonePresent, WHILE_WAITING, type NeedsYouEntry } from "./notifications";
import type { StoredDecision } from "./state";

const owner = {
  id: "agent-1",
  title: "NA-027",
  status: "idle",
  provider: "claude",
  model: null,
  workspaceId: "workspace-1",
  pendingPermissions: 0,
  updatedAt: "2026-01-01T00:00:00Z",
  contextUsedTokens: null,
  contextMaxTokens: null,
  createdAt: null,
  turnStartedAt: null,
};

function decision(parts: Partial<StoredDecision>): StoredDecision {
  return {
    id: "naming",
    question: "Call it drafts?",
    why: "",
    blocking: true,
    options: [],
    recommended: "",
    reason: "",
    default: "",
    withdrawn: false,
    problems: [],
    key: "agent-1:naming",
    project: "notes-app",
    ticket: "NA-027",
    agentId: "agent-1",
    agentRole: "owner",
    agentTitle: null,
    askedAt: "2026-01-01T00:00:00Z",
    status: "open",
    answer: null,
    ...parts,
  };
}

function card(parts: Partial<Card>): Card {
  return {
    id: "NA-027",
    title: "Sync conflicts",
    status: "In Progress",
    column: "working",
    labels: [],
    complexity: null,
    investigation: false,
    parent: null,
    children: [],
    acceptanceDone: 0,
    acceptanceTotal: 0,
    updatedAt: null,
    owner,
    ownerElsewhere: null,
    pullRequest: null,
    lastStatus: null,
    stalled: false,
    stalledReason: null,
    decisions: [],
    subagents: [],
    pastAgents: [],
    latestMilestone: null,
    activity: null,
    evidence: null,
    accepted: null,
    permission: null,
    delivered: null,
    pause: null,
    pausable: false,
    ...parts,
  };
}

function board(cards: Card[], managerDecisions: StoredDecision[] = []): Board {
  return { project: "notes-app", cards, managerDecisions, suggestions: [], headroom: null, alerts: [], loadedAt: "2026-01-01T00:00:00Z", totals: { "needs-you": 0, working: 0, stalled: 0, queued: 0, done: 0 }, offPage: [] };
}

function entries(cards: Card[], managerDecisions: StoredDecision[] = []): NeedsYouEntry[] {
  return needsYouEntries(board(cards, managerDecisions), "workspace-manager");
}

describe("needsYouEntries", () => {
  it("announces a delivery ready to accept with its first sentence, opening the owner", () => {
    expect(entries([card({ status: "Awaiting acceptance", column: "needs-you", delivered: "Drafts sync across devices." })])).toEqual([
      { key: "while-waiting:NA-027:accept", title: "NA-027 is ready to accept", body: "Drafts sync across devices.", agentId: "agent-1", workspaceId: "workspace-1" },
    ]);
  });

  it("falls back to the ticket title for a delivery without a summary", () => {
    expect(entries([card({ status: "Awaiting acceptance", column: "needs-you" })])[0]?.body).toBe("Sync conflicts");
  });

  it("says nothing for an accepted ticket the owner is merging", () => {
    expect(entries([card({ status: "Awaiting acceptance", column: "working", accepted: { at: "2026-01-01T00:00:00Z", merging: null } })])).toEqual([]);
  });

  it("announces a blocking decision with its question; a non-blocking one is routine", () => {
    const asked = entries([card({ column: "needs-you", decisions: [decision({}), decision({ id: "colour", key: "agent-1:colour", blocking: false })] })]);
    expect(asked).toEqual([
      { key: "decision:agent-1:naming:2026-01-01T00:00:00Z", title: "NA-027 asks", body: "Call it drafts?", agentId: "agent-1", workspaceId: "workspace-1" },
    ]);
  });

  it("gives a decision asked again under the same id a new key", () => {
    const first = entries([card({ column: "needs-you", decisions: [decision({})] })])[0]?.key;
    const again = entries([card({ column: "needs-you", decisions: [decision({ askedAt: "2026-01-01T01:00:00Z" })] })])[0]?.key;
    expect(again).not.toBe(first);
  });

  it("opens a subagent's decision without the owner's workspace", () => {
    expect(entries([card({ column: "needs-you", decisions: [decision({ agentId: "agent-2", key: "agent-2:naming" })] })])[0]).toMatchObject({ agentId: "agent-2", workspaceId: null });
  });

  it("announces a permission request by what it asks, keyed by its request id", () => {
    const asked = entries([card({ column: "needs-you", permission: { title: "Run a command", detail: "npm test", id: "request-7" } })]);
    expect(asked).toEqual([
      { key: "NA-027:permission:agent-1:request-7", title: "NA-027 needs permission", body: "Run a command npm test", agentId: "agent-1", workspaceId: "workspace-1" },
    ]);
  });

  it("keys a permission without an id by what it asks", () => {
    expect(entries([card({ column: "needs-you", permission: { title: "Edit", detail: null, id: null } })])[0]?.key).toBe("NA-027:permission:agent-1:Edit");
  });

  it("announces a Blocked ticket, and an owner whose status line says blocked, with its words", () => {
    expect(entries([card({ status: "Blocked", column: "needs-you" })])[0]).toMatchObject({ key: "while-waiting:NA-027:blocked", title: "NA-027 is blocked", body: "Sync conflicts" });
    const said = { state: "blocked" as const, text: "needs a DATABASE_URL", at: "2026-01-01T02:00:00Z" };
    expect(entries([card({ column: "needs-you", lastStatus: said })])[0]).toMatchObject({ key: "while-waiting:NA-027:blocked", body: "needs a DATABASE_URL" });
  });

  it("keeps a delivery's and a block's key while its summary or status line changes", () => {
    const delivery = (delivered: string | null) => entries([card({ status: "Awaiting acceptance", column: "needs-you", delivered })])[0]?.key;
    expect(delivery(null)).toBe(delivery("Drafts sync across devices."));
    const blocked = (lastStatus: Card["lastStatus"]) => entries([card({ status: "Blocked", column: "needs-you", lastStatus })])[0]?.key;
    expect(blocked({ state: "blocked", text: "needs a key", at: "2026-01-01T02:00:00Z" })).toBe(blocked({ state: "working", text: "waiting", at: "2026-01-01T03:00:00Z" }));
    expect(blocked(null)).toBe(blocked({ state: "blocked", text: "needs a key", at: "2026-01-01T02:00:00Z" }));
  });

  it("keeps a delivery's entry while its owner is stalled", () => {
    expect(entries([card({ status: "Awaiting acceptance", column: "stalled", stalled: true, stalledReason: "crashed" })]).map((asked) => asked.key)).toEqual([
      "NA-027:stalled:agent-1",
      "while-waiting:NA-027:accept",
    ]);
  });

  it("announces a stalled owner with the reason it stalled", () => {
    expect(entries([card({ column: "stalled", stalled: true, stalledReason: "crashed twice in an hour" })])).toEqual([
      { key: "NA-027:stalled:agent-1", title: "NA-027 stalled", body: "crashed twice in an hour", agentId: "agent-1", workspaceId: "workspace-1" },
    ]);
    expect(entries([card({ column: "stalled", owner: null })])[0]).toMatchObject({ key: "NA-027:stalled:none", agentId: null, workspaceId: null, body: "Sync conflicts" });
  });

  it("announces the Manager's questions, opening the Manager", () => {
    expect(entries([], [decision({ ticket: null, agentId: "manager-1", key: "manager-1:next", question: "Start NA-028 next?" })])).toEqual([
      { key: "decision:manager-1:next:2026-01-01T00:00:00Z", title: "Manager asks", body: "Start NA-028 next?", agentId: "manager-1", workspaceId: "workspace-manager" },
    ]);
  });

  it("announces every board alert, named for the project and opening the Manager (TR-064)", () => {
    const alerts = [
      { id: "headroom", tickets: [], text: "The host is at 1900 of 2048 threads (93%)." },
      { id: "manager-crashed", tickets: [], text: "The Manager is stopped." },
      { id: "ticket-file:tickets/NA-012.md", tickets: [], text: "tickets/NA-012.md line 4: bad JSON value." },
      { id: "queued-free-slot", tickets: ["NA-001", "NA-002"], text: "NA-001 and NA-002 queued with a free slot." },
    ];
    const found = needsYouEntries({ ...board([]), alerts }, "workspace-manager", "agent-manager");
    expect(found.map((entry) => [entry.key, entry.title])).toEqual([
      // The host's alert is on every board and names no project.
      ["while-waiting:alert:headroom", "Threads running low"],
      ["while-waiting:alert:manager-crashed", "Manager crashed in notes-app"],
      ["while-waiting:alert:ticket-file:tickets/NA-012.md", "Ticket file unreadable in notes-app"],
      ["while-waiting:alert:queued-free-slot", "Queued with a free slot in notes-app"],
    ]);
    expect(found[3]).toMatchObject({ body: "NA-001 and NA-002 queued with a free slot.", agentId: "agent-manager", workspaceId: "workspace-manager" });
  });

  it("keys the queued alert by its kind, so its tickets and minutes changing keep it", () => {
    const one = needsYouEntries({ ...board([]), alerts: [{ id: "queued-free-slot", tickets: ["NA-001"], text: "NA-001 queued, 10 minutes." }] }, null);
    const two = needsYouEntries({ ...board([]), alerts: [{ id: "queued-free-slot", tickets: ["NA-001", "NA-002"], text: "NA-001 and NA-002 queued, 14 minutes." }] }, null);
    expect(one[0]?.key).toBe(two[0]?.key);
  });

  it("says nothing for routine cards: working, queued, done", () => {
    expect(entries([card({}), card({ id: "NA-028", column: "queued", owner: null }), card({ id: "NA-029", status: "Done", column: "done", decisions: [decision({})] })])).toEqual([]);
  });

  it("shortens a long body to one line of at most 220 characters", () => {
    const body = entries([card({ status: "Awaiting acceptance", column: "needs-you", delivered: `${"word ".repeat(80)}\nend` })])[0]?.body ?? "";
    expect(body.length).toBe(220);
    expect(body.endsWith("…")).toBe(true);
    expect(body).not.toContain("\n");
  });
});

const NOW = Date.parse("2026-01-01T12:00:00Z");

function entry(key: string): NeedsYouEntry {
  return { key, title: key, body: "", agentId: null, workspaceId: null };
}

describe("freshEntries", () => {
  it("takes what already waits as known on a project's first check", () => {
    const result = freshEntries(null, [entry("a"), entry("b")], NOW);
    expect(result.fresh).toEqual([]);
    expect(result.seen).toEqual({ a: NOW, b: NOW });
  });

  it("announces an entry once, however often it is seen", () => {
    const first = freshEntries({}, [entry("a")], NOW);
    expect(first.fresh.map((fresh) => fresh.key)).toEqual(["a"]);
    const second = freshEntries(first.seen, [entry("a")], NOW + 15_000);
    expect(second.fresh).toEqual([]);
    expect(second.seen).toEqual({ a: NOW + 15_000 });
  });

  it("announces a key twice in one board only once", () => {
    expect(freshEntries({}, [entry("a"), entry("a")], NOW).fresh).toHaveLength(1);
  });

  it("keeps a vanished entry for an hour, so one that flickers back is not announced again", () => {
    const gone = freshEntries({ a: NOW }, [], NOW + 1_000).seen;
    expect(gone).toEqual({ a: NOW });
    expect(freshEntries(gone, [entry("a")], NOW + REMEMBER_MS - 1).fresh).toEqual([]);
    expect(freshEntries(gone, [entry("a")], NOW + REMEMBER_MS).fresh.map((fresh) => fresh.key)).toEqual(["a"]);
  });

  it("announces a delivery or a block again once it has left, however soon", () => {
    const delivered = { ...entry(`${WHILE_WAITING}NA-027:accept`) };
    const waiting = freshEntries({}, [delivered], NOW);
    expect(waiting.fresh).toHaveLength(1);
    expect(freshEntries(waiting.seen, [delivered], NOW + 15_000).fresh).toEqual([]);
    // Changes requested: the delivery leaves; the fix comes back with the same summary a minute later.
    const changes = freshEntries(waiting.seen, [], NOW + 30_000);
    expect(changes.seen).toEqual({});
    expect(freshEntries(changes.seen, [delivered], NOW + 90_000).fresh.map((fresh) => fresh.key)).toEqual([`${WHILE_WAITING}NA-027:accept`]);
  });

  it("forgets vanished entries after an hour", () => {
    expect(freshEntries({ a: NOW - REMEMBER_MS, b: NOW - 1 }, [], NOW).seen).toEqual({ b: NOW - 1 });
  });
});

describe("someonePresent", () => {
  it("counts a window used in the last three minutes, inclusive", () => {
    expect(someonePresent([NOW - PRESENCE_MS], NOW)).toBe(true);
    expect(someonePresent([NOW - PRESENCE_MS - 1], NOW)).toBe(false);
    expect(someonePresent([], NOW)).toBe(false);
  });

  it("treats a time in the future as now", () => {
    expect(someonePresent([NOW + 60_000], NOW)).toBe(true);
  });
});
