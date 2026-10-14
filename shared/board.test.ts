import { describe, expect, it } from "vitest";

import { boardColumn, columnCounts, complexityOf, inboxCount, needsYouExtras, ticketAgents, type CardInputs, type JoinedAgent } from "./board";

const base: CardInputs = { status: "In Progress", ownerElsewhere: false, agent: { status: "idle", pendingPermissions: 0 }, lastStatus: "waiting", openBlockingDecisions: 0, stalledAfterNudge: false };

describe("boardColumn", () => {
  it("queues a paused ticket with no owner, never Stalled (TR-088)", () => {
    for (const status of ["Planning", "In Progress", "Reviewing", "Ready", "Blocked"]) {
      expect(boardColumn({ ...base, status, agent: null, paused: true })).toBe("queued");
    }
    expect(boardColumn({ ...base, agent: null })).toBe("stalled");
    // A fresh owner started from the pause is placed by its own state.
    expect(boardColumn({ ...base, agent: { status: "running", pendingPermissions: 0 }, paused: true })).toBe("working");
    // Its last owner's EXECUTION names another machine: the pause, in the tracker, still holds.
    expect(boardColumn({ ...base, ownerElsewhere: true, agent: null, paused: true })).toBe("queued");
    expect(boardColumn({ ...base, ownerElsewhere: true, agent: null })).toBe("working");
  });

  it("files finished tickets under Done", () => {
    expect(boardColumn({ ...base, status: "Done" })).toBe("done");
    expect(boardColumn({ ...base, status: "Cancelled" })).toBe("done");
  });

  it("lets urgent live facts win", () => {
    expect(boardColumn({ ...base, agent: { status: "idle", pendingPermissions: 1 } })).toBe("needs-you");
    expect(boardColumn({ ...base, status: "Awaiting acceptance", agent: { status: "running", pendingPermissions: 0 } })).toBe("working");
  });

  it("places an accepted delivery like work under way, not under Needs you (TR-031)", () => {
    const accepted = { ...base, status: "Awaiting acceptance", accepted: true };
    expect(boardColumn({ ...accepted, agent: { status: "idle", pendingPermissions: 0 } })).toBe("working");
    expect(boardColumn({ ...accepted, agent: { status: "running", pendingPermissions: 0 } })).toBe("working");
    expect(boardColumn({ ...accepted, agent: null })).toBe("stalled");
    expect(boardColumn({ ...accepted, agent: { status: "idle", pendingPermissions: 0 }, openBlockingDecisions: 1 })).toBe("needs-you");
    expect(boardColumn({ ...accepted, ownerElsewhere: true, agent: null })).toBe("working");
    expect(boardColumn({ ...base, status: "Awaiting acceptance", accepted: false, agent: { status: "idle", pendingPermissions: 0 } })).toBe("needs-you");
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
    expect(boardColumn({ ...crashed, status: "Queued" })).toBe("stalled");
    expect(boardColumn({ ...crashed, agent: { status: "running", pendingPermissions: 0 } })).toBe("working");
    expect(boardColumn({ ...crashed, status: "Done" })).toBe("done");
  });

  it("keeps an owner waiting on something outside itself in Working", () => {
    expect(boardColumn(base)).toBe("working");
  });

  it("queues tickets that have not started", () => {
    expect(boardColumn({ ...base, status: "Queued", agent: null, lastStatus: null })).toBe("queued");
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

  // TR-080: children not started flipped between Queued and Working with the parent owner's turns.
  it("never places a child not started by the parent's owner, only by its own subagents", () => {
    const placed = (status: string, agents: (JoinedAgent & { id: string })[]) => {
      const joined = ticketAgents("DEMO-1.01", "DEMO-1", grouped(agents), status);
      const placing = joined.columnAgent;
      return boardColumn({ ...base, status, lastStatus: null, agent: placing === null ? null : { status: placing.status, pendingPermissions: placing.pendingPermissions.length } });
    };
    const running = agent("owner", "owner", "DEMO-1", "running", "DEMO-1 · Parent work");
    const asking = agent("owner", "owner", "DEMO-1", "running", "DEMO-1 · Parent work", undefined, [{}]);
    for (const status of ["Queued", "Ready"]) {
      expect(placed(status, [running])).toBe("queued");
      expect(placed(status, [asking])).toBe("queued");
      expect(placed(status, [parentOwner])).toBe("queued");
      expect(placed(status, [running, agent("builder", "implementer", "DEMO-1", "running", "DEMO-1.01 · implementer: building the list")])).toBe("working");
    }
    expect(placed("In Progress", [running])).toBe("working");
    expect(placed("In Progress", [asking])).toBe("needs-you");
    expect(ticketAgents("DEMO-1", null, grouped([running]), "Queued").columnAgent?.id).toBe("owner");
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

describe("columnCounts", () => {
  it("is zero everywhere on an empty board", () => {
    expect(columnCounts([], 0)).toEqual({ "needs-you": 0, working: 0, stalled: 0, queued: 0, done: 0 });
  });

  it("counts the Manager's questions in Needs you with the tickets there (TR-045)", () => {
    expect(columnCounts([], 3)["needs-you"]).toBe(3);
    const cards = [{ column: "needs-you" as const }, { column: "working" as const }, { column: "working" as const }, { column: "done" as const }];
    expect(columnCounts(cards, 2)).toEqual({ "needs-you": 3, working: 2, stalled: 0, queued: 0, done: 1 });
  });
});

describe("needsYouExtras and inboxCount (TR-064)", () => {
  const alert = { id: "manager-crashed", tickets: [], text: "The Manager is stopped." };
  const cards = [{ column: "needs-you" as const }, { column: "stalled" as const }, { column: "working" as const }, { column: "queued" as const }];

  it("counts nothing for no board and no paused sync", () => {
    expect(needsYouExtras(null, false)).toBe(0);
    expect(inboxCount(null, false)).toBe(0);
  });

  it("counts the paused sync without a board", () => {
    expect(inboxCount(null, true)).toBe(1);
  });

  it("counts every alert and the Manager's questions in Needs you", () => {
    expect(needsYouExtras({ managerDecisions: [{}], alerts: [alert, alert] }, true)).toBe(4);
    expect(columnCounts(cards, needsYouExtras({ managerDecisions: [], alerts: [alert] }, false))["needs-you"]).toBe(2);
  });

  it("counts an alert alone on an otherwise quiet board", () => {
    expect(inboxCount({ cards: [{ column: "working" }], managerDecisions: [], alerts: [alert] }, false)).toBe(1);
  });

  it("counts Needs you and stalled tickets in the Inbox, not work under way", () => {
    expect(inboxCount({ cards, managerDecisions: [{}], alerts: [alert] }, true)).toBe(5);
  });
});
