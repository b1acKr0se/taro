import { describe, expect, it } from "vitest";

import { ownerStartedRecord, startsPlanning } from "./owner-start";

describe("startsPlanning (TR-173)", () => {
  it("moves a Queued ticket with no parent", () => {
    expect(startsPlanning({ status: "Queued", parent: null })).toBe(true);
  });

  it("leaves a child alone: it has no owner of its own", () => {
    expect(startsPlanning({ status: "Queued", parent: "NA-001" })).toBe(false);
  });

  it.each(["Planning", "Ready", "In Progress", "Reviewing", "Awaiting acceptance", "Blocked", "Done", "Cancelled"])("leaves a %s ticket alone: an owner taking it over keeps its status", (status) => {
    expect(startsPlanning({ status, parent: null })).toBe(false);
  });
});

describe("ownerStartedRecord", () => {
  it("says who set Planning, and why", () => {
    expect(ownerStartedRecord("2026-10-18T09:00:00.000Z", "agent-1")).toBe("OWNER-STARTED 2026-10-18T09:00:00.000Z — the plugin set Planning: owner agent-1 started on this Queued ticket");
  });
});
