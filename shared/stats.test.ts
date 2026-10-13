import { describe, expect, it } from "vitest";

import { compareTickets, projectTotals, summarize, type TicketSummary } from "./stats";

describe("summarize", () => {
  it("adds time per status, wall time to Done, agent time and cost", () => {
    const summary = summarize({
      project: "app",
      ticket: "AP-1",
      title: "x",
      transitions: [
        { from: null, to: "Backlog", at: "2026-01-01T00:00:00Z" },
        { from: "Backlog", to: "Planning", at: "2026-01-01T00:01:00Z" },
        { from: "Planning", to: "In Progress", at: "2026-01-01T00:05:00Z" },
        { from: "In Progress", to: "Awaiting acceptance", at: "2026-01-01T00:15:00Z" },
        { from: "Awaiting acceptance", to: "Done", at: "2026-01-01T00:45:00Z" },
      ],
      agents: {
        owner: { agentId: "owner", role: "owner", model: "m", title: null, turns: 3, activeMs: 600_000, costUsd: 1.5, contextTokens: 90_000 },
        implementer: { agentId: "implementer", role: "implementer", model: "h", title: null, turns: 1, activeMs: 120_000, costUsd: 0.25, contextTokens: null },
      },
      nudges: 1,
      decisions: 2,
      recoveries: 1,
      idleCompactions: 2,
    });
    expect(summary.wallMs).toBe(45 * 60_000);
    expect(summary.byStatus).toEqual({ Backlog: 60_000, Planning: 240_000, "In Progress": 600_000, "Awaiting acceptance": 1_800_000, Done: 0 });
    expect(summary.waitingOnUserMs).toBe(1_800_000);
    expect(summary.agentActiveMs).toBe(720_000);
    expect(summary.turns).toBe(4);
    expect(summary.costUsd).toBe(1.75);
    expect(summary.status).toBe("Done");
    expect(summary.recoveries).toBe(1);
    expect(summary.idleCompactions).toBe(2);
  });
});

function row(ticket: string, values: Partial<TicketSummary> = {}): TicketSummary {
  return {
    project: "app",
    ticket,
    title: ticket,
    status: "Done",
    wallMs: 0,
    byStatus: {},
    waitingOnUserMs: 0,
    agentActiveMs: 0,
    turns: 0,
    agents: 0,
    costUsd: null,
    nudges: 0,
    decisions: 0,
    recoveries: 0,
    idleCompactions: 0,
    ...values,
  };
}

describe("projectTotals", () => {
  it("is all zeros and no cost for no tickets", () => {
    expect(projectTotals([])).toEqual({ tickets: 0, wallMs: 0, waitingOnUserMs: 0, agentActiveMs: 0, turns: 0, agents: 0, costUsd: null, nudges: 0, decisions: 0, recoveries: 0, idleCompactions: 0 });
  });

  it("adds top-level tickets and skips a cost nobody reported", () => {
    const totals = projectTotals([
      row("AP-1", { wallMs: 1_000, waitingOnUserMs: 100, agentActiveMs: 500, turns: 3, agents: 1, costUsd: 1.25, nudges: 1, decisions: 2, recoveries: 1 }),
      row("AP-2", { wallMs: 2_000, waitingOnUserMs: 0, agentActiveMs: 700, turns: 4, agents: 2, costUsd: null }),
      row("AP-3", { costUsd: 0 }),
    ]);
    expect(totals).toEqual({ tickets: 3, wallMs: 3_000, waitingOnUserMs: 100, agentActiveMs: 1_200, turns: 7, agents: 3, costUsd: 1.25, nudges: 1, decisions: 2, recoveries: 1, idleCompactions: 0 });
  });

  it("does not count a child's agents, turns, cost or time twice, but adds its nudges, decisions and recoveries", () => {
    const totals = projectTotals([
      row("AP-9", { wallMs: 10_000, agentActiveMs: 900, turns: 9, agents: 3, costUsd: 3, nudges: 1, recoveries: 1 }),
      row("AP-9.1", { wallMs: 4_000, agentActiveMs: 400, turns: 4, agents: 1, costUsd: 1, nudges: 2, decisions: 1, recoveries: 2 }),
    ]);
    expect(totals).toMatchObject({ tickets: 2, wallMs: 10_000, agentActiveMs: 900, turns: 9, agents: 3, costUsd: 3, nudges: 3, decisions: 1, recoveries: 3 });
  });

  it("adds every ticket's idle compactions, children's too, and the manager's", () => {
    const tickets = [row("AP-9", { idleCompactions: 1 }), row("AP-9.1", { idleCompactions: 2 })];
    expect(projectTotals(tickets).idleCompactions).toBe(3);
    expect(projectTotals(tickets, 4).idleCompactions).toBe(7);
    expect(projectTotals([], 1).idleCompactions).toBe(1);
  });
});

describe("compareTickets", () => {
  it("puts the newest first and children in order after their parent", () => {
    expect(["AP-9.2", "AP-2", "AP-10", "AP-9", "AP-9.10", "AP-9.1"].sort(compareTickets)).toEqual(["AP-10", "AP-9", "AP-9.1", "AP-9.2", "AP-9.10", "AP-2"]);
  });
});
