import { describe, expect, it } from "vitest";

import { boardColumn, complexityOf, ticketAgents, type CardInputs, type JoinedAgent } from "./board";

const base: CardInputs = { status: "In Progress", ownerElsewhere: false, agent: { status: "idle", pendingPermissions: 0 }, lastStatus: "waiting", openBlockingDecisions: 0, stalledAfterNudge: false };

describe("boardColumn", () => {
  it("files finished tickets under Done", () => {
    expect(boardColumn({ ...base, status: "Done" })).toBe("done");
    expect(boardColumn({ ...base, status: "Cancelled" })).toBe("done");
  });

  it("lets urgent live facts win", () => {
    expect(boardColumn({ ...base, agent: { status: "idle", pendingPermissions: 1 } })).toBe("needs-you");
    expect(boardColumn({ ...base, status: "Awaiting acceptance", agent: { status: "running", pendingPermissions: 0 } })).toBe("working");
  });

  it("puts questions, acceptance and blockers under Needs you", () => {
    expect(boardColumn({ ...base, openBlockingDecisions: 1 })).toBe("needs-you");
    expect(boardColumn({ ...base, status: "Awaiting acceptance" })).toBe("needs-you");
    expect(boardColumn({ ...base, status: "Blocked" })).toBe("needs-you");
    expect(boardColumn({ ...base, lastStatus: "blocked" })).toBe("needs-you");
  });

  it("calls work under way with nobody on it Stalled", () => {
    expect(boardColumn({ ...base, agent: null })).toBe("stalled");
    expect(boardColumn({ ...base, agent: { status: "error", pendingPermissions: 0 } })).toBe("stalled");
    expect(boardColumn({ ...base, stalledAfterNudge: true })).toBe("stalled");
    expect(boardColumn({ ...base, lastStatus: "failed" })).toBe("stalled");
  });

  it("calls an owner past its crash-recovery limit Stalled whatever the ticket's status, until it runs again", () => {
    const crashed = { ...base, agent: { status: "error", pendingPermissions: 0 }, crashedOut: true };
    expect(boardColumn({ ...crashed, status: "Awaiting acceptance" })).toBe("stalled");
    expect(boardColumn({ ...crashed, openBlockingDecisions: 1 })).toBe("stalled");
    expect(boardColumn({ ...crashed, status: "Backlog" })).toBe("stalled");
    expect(boardColumn({ ...crashed, agent: { status: "running", pendingPermissions: 0 } })).toBe("working");
    expect(boardColumn({ ...crashed, status: "Done" })).toBe("done");
  });

  it("keeps an owner waiting on something outside itself in Working", () => {
    expect(boardColumn(base)).toBe("working");
  });

  it("queues tickets that have not started", () => {
    expect(boardColumn({ ...base, status: "Backlog", agent: null, lastStatus: null })).toBe("queued");
    expect(boardColumn({ ...base, status: "Ready", agent: null, lastStatus: null })).toBe("queued");
  });

  it("never calls a teammate's ticket stalled", () => {
    expect(boardColumn({ ...base, ownerElsewhere: true, agent: null })).toBe("working");
    expect(boardColumn({ ...base, ownerElsewhere: true, agent: null, status: "Awaiting acceptance" })).toBe("needs-you");
  });
});

describe("complexityOf", () => {
  it("reads the label", () => {
    expect(complexityOf(["investigation", "complexity-medium"])).toBe("medium");
    expect(complexityOf([])).toBeNull();
  });
});

function agent(id: string, role: string, ticket: string, status: string, title: string, updatedAt = "2026-10-13T10:00:00Z", pendingPermissions: unknown[] = []): JoinedAgent & { id: string } {
  return { id, labels: { "taro.project": "demo", "taro.role": role, "taro.ticket": ticket }, title, status, updatedAt, pendingPermissions };
}

function grouped(agents: (JoinedAgent & { id: string })[]): Map<string, (JoinedAgent & { id: string })[]> {
  const byTicket = new Map<string, (JoinedAgent & { id: string })[]>();
  agents.forEach((entry) => byTicket.set(entry.labels["taro.ticket"] ?? "", [...(byTicket.get(entry.labels["taro.ticket"] ?? "") ?? []), entry]));
  return byTicket;
}

function childColumn(agents: (JoinedAgent & { id: string })[]): { column: string; subagents: string[]; columnAgent: string | null } {
  const joined = ticketAgents("DEMO-1.01", "DEMO-1", grouped(agents));
  const placing = joined.columnAgent;
  const column = boardColumn({
    ...base,
    agent: placing === null ? null : { status: placing.status, pendingPermissions: placing.pendingPermissions.length },
  });
  return { column, subagents: joined.subagents.map((entry) => entry.id), columnAgent: placing?.id ?? null };
}

describe("ticketAgents", () => {
  const parentOwner = agent("owner", "owner", "DEMO-1", "idle", "DEMO-1 · Parent work");

  it("works a child labelled with its parent and titled with its id through its running implementer (TR-025)", () => {
    const implementer = agent("builder", "implementer", "DEMO-1", "running", "DEMO-1.01 · implementer: building the list");
    expect(childColumn([parentOwner, implementer])).toEqual({ column: "working", subagents: ["builder"], columnAgent: "builder" });
  });

  it("works a child through a subagent labelled with the child", () => {
    const implementer = agent("builder", "implementer", "DEMO-1.01", "running", "DEMO-1 · implementer: building the list");
    expect(childColumn([parentOwner, implementer])).toEqual({ column: "working", subagents: ["builder"], columnAgent: "builder" });
  });

  it("puts a child whose subagent asks permission under Needs you", () => {
    const asking = agent("builder", "implementer", "DEMO-1.01", "running", "DEMO-1.01 · implementer: x", undefined, [{}]);
    expect(childColumn([parentOwner, asking]).column).toBe("needs-you");
  });

  it("falls back to the parent's owner when no subagent of the child is busy", () => {
    const finished = agent("builder", "implementer", "DEMO-1.01", "idle", "DEMO-1.01 · implementer: x");
    expect(childColumn([parentOwner, finished])).toEqual({ column: "working", subagents: ["builder"], columnAgent: "owner" });
    expect(childColumn([agent("owner", "owner", "DEMO-1", "running", "DEMO-1 · Parent work")]).column).toBe("working");
  });

  it("calls a child Stalled only when neither the parent's owner nor a subagent for it is alive", () => {
    expect(childColumn([]).column).toBe("stalled");
    expect(childColumn([agent("owner", "owner", "DEMO-1", "closed", "DEMO-1 · Parent work")]).column).toBe("stalled");
    expect(childColumn([agent("owner", "owner", "DEMO-1", "error", "DEMO-1 · Parent work")]).column).toBe("stalled");
  });

  it("leaves the parent's own subagents and a sibling's off a child's card", () => {
    const parentReviewer = agent("reviewer", "reviewer", "DEMO-1", "running", "DEMO-1 · reviewer: checking the branch");
    const sibling = agent("sibling", "implementer", "DEMO-1", "running", "DEMO-1.010 · implementer: building the form");
    expect(childColumn([parentOwner, parentReviewer, sibling])).toEqual({ column: "working", subagents: [], columnAgent: "owner" });
  });

  it("prefers a child's own owner and leaves tickets that are not children as before", () => {
    const childOwner = agent("child-owner", "owner", "DEMO-1.01", "idle", "DEMO-1.01 · Child work");
    expect(ticketAgents("DEMO-1.01", "DEMO-1", grouped([parentOwner, childOwner])).owner?.id).toBe("child-owner");
    const implementer = agent("builder", "implementer", "DEMO-1", "running", "DEMO-1 · implementer: x", undefined, [{}]);
    const joined = ticketAgents("DEMO-1", null, grouped([parentOwner, implementer]));
    expect(joined.owner?.id).toBe("owner");
    expect(joined.columnAgent?.id).toBe("owner");
    expect(joined.subagents.map((entry) => entry.id)).toEqual(["builder"]);
  });

  it("picks the newest live owner", () => {
    const older = agent("older", "owner", "DEMO-1", "idle", "DEMO-1 · a", "2026-10-13T09:00:00Z");
    const newer = agent("newer", "owner", "DEMO-1", "idle", "DEMO-1 · b", "2026-10-13T11:00:00Z");
    const closed = agent("closed", "owner", "DEMO-1", "closed", "DEMO-1 · c", "2026-10-13T12:00:00Z");
    expect(ticketAgents("DEMO-1", null, grouped([older, closed, newer])).owner?.id).toBe("newer");
  });
});
