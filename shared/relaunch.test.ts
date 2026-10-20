import { describe, expect, it } from "vitest";

import { offersRelaunch, relaunchRefusal, type RelaunchFacts } from "./relaunch";

const WORKED: RelaunchFacts = { status: "In Progress", parent: null, paused: false, ownerRunning: false };

describe("Relaunch owner on the detail view (TR-219)", () => {
  it.each(["Planning", "In Progress", "Reviewing", "Awaiting acceptance", "Blocked"])("is offered while %s with no running owner", (status) => {
    expect(offersRelaunch({ ...WORKED, status })).toBe(true);
    expect(relaunchRefusal("TR-1", { ...WORKED, status })).toBeNull();
  });

  it.each(["Queued", "Done", "Cancelled"])("is not offered while %s", (status) => {
    expect(offersRelaunch({ ...WORKED, status })).toBe(false);
  });

  it("is not offered for a child, a paused ticket or an owner in a turn", () => {
    expect(relaunchRefusal("TR-2", { ...WORKED, parent: "TR-1" })).toBe("TR-2 is part of TR-1; TR-1's owner runs it.");
    expect(offersRelaunch({ ...WORKED, paused: true })).toBe(false);
    expect(offersRelaunch({ ...WORKED, ownerRunning: true })).toBe(false);
  });
});
