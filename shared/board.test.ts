import { describe, expect, it } from "vitest";

import { boardColumn, complexityOf, type CardInputs } from "./board";

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
