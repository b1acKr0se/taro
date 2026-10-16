import { describe, expect, it } from "vitest";

import { compareTickets, projectSpanMs, projectTotals, summarize, unionMs, waitingTickets, withoutRepeats, type TicketStats, type TicketSummary } from "./stats";

describe("summarize", () => {
  it("adds time per status, wall time to Done, agent time and cost", () => {
    const summary = summarize({
      project: "app",
      ticket: "AP-1",
      title: "x",
      transitions: [
        { from: null, to: "Queued", at: "2026-01-01T00:00:00Z" },
        { from: "Queued", to: "Planning", at: "2026-01-01T00:01:00Z" },
        { from: "Planning", to: "In Progress", at: "2026-01-01T00:05:00Z" },
        { from: "In Progress", to: "Awaiting acceptance", at: "2026-01-01T00:15:00Z" },
        { from: "Awaiting acceptance", to: "Done", at: "2026-01-01T00:45:00Z" },
      ],
      waiting: [],
      agents: {
        owner: { agentId: "owner", role: "owner", model: "m", title: null, turns: 3, activeMs: 600_000, costUsd: 1.5, contextTokens: 90_000, contextMaxTokens: 200_000, startingContextTokens: null },
        implementer: { agentId: "implementer", role: "implementer", model: "h", title: null, turns: 1, activeMs: 120_000, costUsd: 0.25, contextTokens: null, contextMaxTokens: null, startingContextTokens: null },
      },
      nudges: 1,
      decisions: 2,
      recoveries: 1,
      idleCompactions: 2,
      permissionDenials: 3,
    });
    expect(summary.wallMs).toBe(45 * 60_000);
    expect(summary.byStatus).toEqual({ Queued: 60_000, Planning: 240_000, "In Progress": 600_000, "Awaiting acceptance": 1_800_000, Done: 0 });
    expect(summary.waitingOnUserMs).toBe(1_800_000);
    expect(summary.agentActiveMs).toBe(720_000);
    expect(summary.turns).toBe(4);
    expect(summary.costUsd).toBe(1.75);
    expect(summary.status).toBe("Done");
    expect(summary.recoveries).toBe(1);
    expect(summary.idleCompactions).toBe(2);
    expect(summary.permissionDenials).toBe(3);
    expect(summary.agentsWithoutCost).toBe(0);
  });

  it("counts agents whose cost is unknown, adding up only the known costs", () => {
    const agent = { role: "implementer", model: "m", title: null, turns: 1, activeMs: 0, contextTokens: null, contextMaxTokens: null, startingContextTokens: null };
    const summary = summarize({
      project: "app",
      ticket: "AP-2",
      title: "x",
      transitions: [],
      waiting: [],
      agents: { a: { ...agent, agentId: "a", costUsd: 2 }, b: { ...agent, agentId: "b", costUsd: null }, c: { ...agent, agentId: "c", costUsd: 0 } },
      nudges: 0,
      decisions: 0,
      recoveries: 0,
      idleCompactions: 0,
      permissionDenials: 0,
    });
    expect(summary).toMatchObject({ agents: 3, costUsd: 2, agentsWithoutCost: 1 });
  });
});

function row(ticket: string, values: Partial<TicketSummary> = {}): TicketSummary {
  return {
    project: "app",
    ticket,
    title: ticket,
    status: "Done",
    wallMs: 0,
    startedAt: null,
    finishedAt: null,
    byStatus: {},
    waitingOnUserMs: 0,
    agentActiveMs: 0,
    turns: 0,
    agents: 0,
    costUsd: null,
    agentsWithoutCost: 0,
    nudges: 0,
    decisions: 0,
    recoveries: 0,
    idleCompactions: 0,
    permissionDenials: 0,
    ...values,
  };
}

describe("projectTotals", () => {
  it("is all zeros and no cost for no tickets", () => {
    expect(projectTotals([])).toEqual({ tickets: 0, wallMs: 0, waitingOnUserMs: 0, agentActiveMs: 0, turns: 0, agents: 0, costUsd: null, agentsWithoutCost: 0, nudges: 0, decisions: 0, recoveries: 0, idleCompactions: 0, permissionDenials: 0 });
  });

  it("adds top-level tickets and skips a cost nobody reported", () => {
    const totals = projectTotals([
      row("AP-1", { wallMs: 1_000, startedAt: 0, finishedAt: 1_000, waitingOnUserMs: 100, agentActiveMs: 500, turns: 3, agents: 1, costUsd: 1.25, nudges: 1, decisions: 2, recoveries: 1 }),
      row("AP-2", { wallMs: 2_000, startedAt: 1_000, finishedAt: 3_000, waitingOnUserMs: 0, agentActiveMs: 700, turns: 4, agents: 2, costUsd: null }),
      row("AP-3", { costUsd: 0 }),
    ]);
    expect(totals).toEqual({ tickets: 3, wallMs: 3_000, waitingOnUserMs: 100, agentActiveMs: 1_200, turns: 7, agents: 3, costUsd: 1.25, agentsWithoutCost: 0, nudges: 1, decisions: 2, recoveries: 1, idleCompactions: 0, permissionDenials: 0 });
  });

  it("does not count a child's agents, turns, cost or time twice, but adds its nudges, decisions and recoveries", () => {
    const totals = projectTotals([
      row("AP-9", { wallMs: 10_000, startedAt: 0, finishedAt: 10_000, agentActiveMs: 900, turns: 9, agents: 3, costUsd: 3, nudges: 1, recoveries: 1 }),
      row("AP-9.1", { wallMs: 4_000, startedAt: 2_000, finishedAt: 6_000, agentActiveMs: 400, turns: 4, agents: 1, costUsd: 1, nudges: 2, decisions: 1, recoveries: 2 }),
    ]);
    expect(totals).toMatchObject({ tickets: 2, wallMs: 10_000, agentActiveMs: 900, turns: 9, agents: 3, costUsd: 3, nudges: 3, decisions: 1, recoveries: 3 });
  });

  it("counts agents without a cost once, on top-level tickets only, as their agents are", () => {
    const totals = projectTotals([row("AP-9", { agents: 3, costUsd: 3, agentsWithoutCost: 1 }), row("AP-9.1", { agents: 1, costUsd: null, agentsWithoutCost: 1 }), row("AP-8", { agents: 2, costUsd: 1, agentsWithoutCost: 2 })]);
    expect(totals).toMatchObject({ agents: 5, costUsd: 4, agentsWithoutCost: 3 });
  });

  it("adds every ticket's idle compactions, children's too, and the manager's", () => {
    const tickets = [row("AP-9", { idleCompactions: 1 }), row("AP-9.1", { idleCompactions: 2 })];
    expect(projectTotals(tickets).idleCompactions).toBe(3);
    expect(projectTotals(tickets, 4).idleCompactions).toBe(7);
    expect(projectTotals([], 1).idleCompactions).toBe(1);
  });

  it("adds up shell denials on every ticket, children included", () => {
    expect(projectTotals([row("AP-9", { permissionDenials: 2 }), row("AP-9.1", { permissionDenials: 1 }), row("AP-10")]).permissionDenials).toBe(3);
  });
});

function ticket(transitions: ReadonlyArray<[string, string]>, waiting: TicketStats["waiting"] = []): TicketStats {
  return { project: "app", ticket: "AP-1", title: "x", transitions: transitions.map(([to, at], index) => ({ from: index === 0 ? null : (transitions[index - 1]?.[0] ?? null), to, at })), waiting, agents: {}, nudges: 0, decisions: 0, recoveries: 0, idleCompactions: 0, permissionDenials: 0 };
}

describe("repeated statuses (TR-100)", () => {
  const worked: Array<[string, string]> = [
    ["Queued", "2026-01-01T00:00:00Z"],
    ["In Progress", "2026-01-01T00:02:00Z"],
    ["Awaiting acceptance", "2026-01-01T00:10:00Z"],
    ["Done", "2026-01-01T00:12:00Z"],
  ];

  it("a Done announced again a day later changes neither wall time nor time per status", () => {
    const clean = summarize(ticket(worked), Date.parse("2026-01-03T00:00:00Z"));
    const repeated = summarize(ticket([...worked, ["Done", "2026-01-02T06:00:00Z"]]), Date.parse("2026-01-03T00:00:00Z"));
    expect(clean.wallMs).toBe(12 * 60_000);
    expect(repeated.wallMs).toBe(clean.wallMs);
    expect(repeated.byStatus).toEqual(clean.byStatus);
    expect(repeated.finishedAt).toBe(Date.parse("2026-01-01T00:12:00Z"));
  });

  it("a status repeated mid-way keeps the time from its first entry", () => {
    const summary = summarize(ticket([["Queued", "2026-01-01T00:00:00Z"], ["Queued", "2026-01-01T00:05:00Z"], ["Done", "2026-01-01T00:08:00Z"]]));
    expect(summary.byStatus).toEqual({ Queued: 8 * 60_000, Done: 0 });
  });

  it("withoutRepeats keeps changes, drops only repeats, and is empty for nothing", () => {
    const transitions = ticket([["Queued", "a"], ["Queued", "b"], ["Done", "c"], ["Done", "d"], ["In Progress", "e"], ["Done", "f"]]).transitions;
    expect(withoutRepeats(transitions).map((transition) => transition.at)).toEqual(["a", "c", "e", "f"]);
    expect(withoutRepeats([])).toEqual([]);
  });
});

describe("waiting on the user (TR-100)", () => {
  const minute = 60_000;

  it("adds Needs-you stretches to Awaiting acceptance, counting an overlap once", () => {
    const summary = summarize(
      ticket(
        [["Planning", "2026-01-01T00:00:00Z"], ["In Progress", "2026-01-01T00:20:00Z"], ["Awaiting acceptance", "2026-01-01T01:00:00Z"], ["Done", "2026-01-01T01:30:00Z"]],
        [
          { start: "2026-01-01T00:05:00Z", end: "2026-01-01T00:15:00Z" },
          { start: "2026-01-01T01:00:00Z", end: "2026-01-01T01:30:00Z" },
          { start: "2026-01-01T00:40:00Z", end: "2026-01-01T00:42:00Z" },
        ],
      ),
    );
    expect(summary.waitingOnUserMs).toBe((10 + 30 + 2) * minute);
  });

  it("is the Awaiting acceptance time alone for a ticket recorded before stretches were", () => {
    const summary = summarize(ticket([["In Progress", "2026-01-01T00:00:00Z"], ["Awaiting acceptance", "2026-01-01T00:10:00Z"], ["Done", "2026-01-01T00:25:00Z"]]));
    expect(summary.waitingOnUserMs).toBe(15 * minute);
  });

  it("takes the waiting tickets from the board's Needs you column only", () => {
    expect(waitingTickets([{ id: "AP-1", column: "needs-you" }, { id: "AP-2", column: "working" }, { id: "AP-3", column: "stalled" }, { id: "AP-3.1", column: "needs-you" }])).toEqual(["AP-1", "AP-3.1"]);
    expect(waitingTickets([])).toEqual([]);
  });

  it("unionMs merges overlapping, nested and touching intervals and ignores empty ones", () => {
    expect(unionMs([])).toBe(0);
    expect(unionMs([[0, 10], [5, 15], [20, 30], [22, 25], [30, 31], [40, 40], [50, 45]])).toBe(26);
  });
});

describe("projectSpanMs (TR-100)", () => {
  it("is the span of overlapping tickets, not their sum", () => {
    const tickets = [row("AP-1", { wallMs: 10, startedAt: 0, finishedAt: 10 }), row("AP-2", { wallMs: 10, startedAt: 5, finishedAt: 15 }), row("AP-3", { wallMs: 2, startedAt: 6, finishedAt: 8 })];
    expect(projectSpanMs(tickets)).toBe(15);
    expect(projectTotals(tickets).wallMs).toBe(15);
  });

  it("runs to now while a ticket is open, and is 0 with none seen", () => {
    expect(projectSpanMs([row("AP-1", { startedAt: 0, finishedAt: 10 }), row("AP-2", { status: "In Progress", startedAt: 4, finishedAt: null })], 100)).toBe(100);
    expect(projectSpanMs([], 100)).toBe(0);
    expect(projectSpanMs([row("AP-1")], 100)).toBe(0);
  });
});

describe("compareTickets", () => {
  it("puts the newest first and children in order after their parent", () => {
    expect(["AP-9.2", "AP-2", "AP-10", "AP-9", "AP-9.10", "AP-9.1"].sort(compareTickets)).toEqual(["AP-10", "AP-9", "AP-9.1", "AP-9.2", "AP-9.10", "AP-2"]);
  });
});
