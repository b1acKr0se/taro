import { describe, expect, it } from "vitest";

import { summarize } from "./stats";

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
        helper: { agentId: "helper", role: "helper", model: "h", title: null, turns: 1, activeMs: 120_000, costUsd: 0.25, contextTokens: null },
      },
      nudges: 1,
      decisions: 2,
    });
    expect(summary.wallMs).toBe(45 * 60_000);
    expect(summary.byStatus).toEqual({ Backlog: 60_000, Planning: 240_000, "In Progress": 600_000, "Awaiting acceptance": 1_800_000, Done: 0 });
    expect(summary.waitingOnUserMs).toBe(1_800_000);
    expect(summary.agentActiveMs).toBe(720_000);
    expect(summary.turns).toBe(4);
    expect(summary.costUsd).toBe(1.75);
    expect(summary.status).toBe("Done");
  });
});
