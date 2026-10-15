import { describe, expect, it } from "vitest";

import { offersSpecChange, specChangeRefusal, type SpecChangeFacts } from "./spec-change";

const QUEUED: SpecChangeFacts = { status: "Queued", parent: null, ownerRunning: false, paused: false };

describe("Change spec… on a ticket (TR-129)", () => {
  it("is offered on a top-level Queued ticket with no owner", () => {
    expect(offersSpecChange(QUEUED)).toBe(true);
    expect(specChangeRefusal("TR-1", QUEUED)).toBeNull();
  });

  it.each(["Planning", "In Progress", "Awaiting acceptance", "Done", "Cancelled", "Blocked", ""])("is not offered once the ticket is %s", (status) => {
    expect(offersSpecChange({ ...QUEUED, status })).toBe(false);
    expect(specChangeRefusal("TR-1", { ...QUEUED, status })).toContain("its chat");
  });

  it("is not offered while an owner runs, even before it moves the ticket out of Queued", () => {
    expect(offersSpecChange({ ...QUEUED, ownerRunning: true })).toBe(false);
    expect(specChangeRefusal("TR-1", { ...QUEUED, ownerRunning: true })).toBe("TR-1 has an owner now. Tell it in its chat instead.");
  });

  it("leaves a child to its parent's owner", () => {
    expect(offersSpecChange({ ...QUEUED, parent: "TR-0" })).toBe(false);
    expect(specChangeRefusal("TR-1", { ...QUEUED, parent: "TR-0" })).toBe("TR-1 is part of TR-0. Tell TR-0's owner in its chat instead.");
  });

  it("leaves a paused ticket to Resume", () => {
    expect(offersSpecChange({ ...QUEUED, paused: true })).toBe(false);
  });
});
