import { describe, expect, it } from "vitest";

import { holdsSlot, shouldWakeManager, statusChanges, ticketsCountingTowardsCap } from "./owner-cap";

const owner = (ticket: string | undefined, status = "idle", role = "owner") => ({
  status,
  labels: { "taro.project": "demo", "taro.role": role, ...(ticket === undefined ? {} : { "taro.ticket": ticket }) },
});
const ticket = (id: string, status: string, parentTaskId: string | null = null) => ({ id, status, parentTaskId });

describe("holdsSlot", () => {
  it("is true while an owner works the ticket", () => {
    for (const status of ["Planning", "Ready", "In Progress", "Reviewing", "Blocked"]) expect(holdsSlot(status)).toBe(true);
  });
  it("is false before an owner starts and once the ticket waits for the user or is finished", () => {
    for (const status of ["Backlog", "Awaiting acceptance", "Done", "Cancelled"]) expect(holdsSlot(status)).toBe(false);
  });
});

describe("ticketsCountingTowardsCap", () => {
  it("is empty with no owners", () => {
    expect(ticketsCountingTowardsCap([], [ticket("DM-1", "In Progress")])).toEqual([]);
  });

  it("counts owners of tickets under way, sorted", () => {
    const tickets = [ticket("DM-3", "Reviewing"), ticket("DM-1", "Planning"), ticket("DM-2", "Blocked")];
    expect(ticketsCountingTowardsCap([owner("DM-3"), owner("DM-1", "running"), owner("DM-2", "error")], tickets)).toEqual(["DM-1", "DM-2", "DM-3"]);
  });

  it("leaves out owners whose ticket is Awaiting acceptance, Done or Cancelled, though still alive", () => {
    const tickets = [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Done"), ticket("DM-3", "Cancelled"), ticket("DM-4", "In Progress")];
    expect(ticketsCountingTowardsCap([owner("DM-1"), owner("DM-2", "running"), owner("DM-3"), owner("DM-4")], tickets)).toEqual(["DM-4"]);
  });

  it("three tickets waiting overnight free every slot of a cap of three", () => {
    const tickets = [ticket("DM-1", "Awaiting acceptance"), ticket("DM-2", "Awaiting acceptance"), ticket("DM-3", "Awaiting acceptance")];
    expect(ticketsCountingTowardsCap([owner("DM-1"), owner("DM-2"), owner("DM-3")], tickets)).toHaveLength(0);
  });

  it("never counts children, closed owners, subagents or agents without a ticket", () => {
    const tickets = [ticket("DM-1", "In Progress"), ticket("DM-1.1", "In Progress", "DM-1"), ticket("DM-2", "In Progress")];
    const owners = [owner("DM-1.1"), owner("DM-2", "closed"), owner("DM-2", "idle", "reviewer"), owner(undefined), owner("")];
    expect(ticketsCountingTowardsCap(owners, tickets)).toEqual([]);
  });

  it("counts a ticket once however many live owners it has (a relaunch beside the old owner)", () => {
    expect(ticketsCountingTowardsCap([owner("DM-1"), owner("DM-1", "running")], [ticket("DM-1", "In Progress")])).toEqual(["DM-1"]);
  });

  it("counts an owner whose ticket the tracker does not list", () => {
    expect(ticketsCountingTowardsCap([owner("DM-9")], [])).toEqual(["DM-9"]);
  });

  it("counts again after Request changes moves the ticket back to In Progress", () => {
    expect(ticketsCountingTowardsCap([owner("DM-1")], [ticket("DM-1", "In Progress")])).toEqual(["DM-1"]);
  });
});

describe("statusChanges", () => {
  const previous = new Map([
    ["DM-1", "Reviewing"],
    ["DM-2", "Awaiting acceptance"],
    ["DM-3", "In Progress"],
    ["DM-3.1", "In Progress"],
    ["DM-4", "Backlog"],
    ["DM-5", "In Progress"],
    ["DM-6", "Awaiting acceptance"],
    ["DM-7", "Blocked"],
  ]);

  it("reports a top-level ticket reaching Awaiting acceptance as freeing a slot", () => {
    expect(statusChanges(previous, [ticket("DM-1", "Awaiting acceptance")])).toEqual([{ ticket: "DM-1", status: "Awaiting acceptance", freesSlot: true }]);
  });

  it("reports Done after Awaiting acceptance for its dependents only: the slot was freed already", () => {
    expect(statusChanges(previous, [ticket("DM-2", "Done")])).toEqual([{ ticket: "DM-2", status: "Done", freesSlot: false }]);
  });

  it("reports Done straight from work as freeing a slot", () => {
    expect(statusChanges(previous, [ticket("DM-3", "Done")])).toEqual([{ ticket: "DM-3", status: "Done", freesSlot: true }]);
  });

  it("never lets a child free a slot, but reports its Done for dependents", () => {
    expect(statusChanges(previous, [ticket("DM-3.1", "Done", "DM-3")])).toEqual([{ ticket: "DM-3.1", status: "Done", freesSlot: false }]);
    expect(statusChanges(previous, [ticket("DM-3.1", "Awaiting acceptance", "DM-3")])).toEqual([]);
  });

  it("frees nothing for a ticket cancelled before an owner started", () => {
    expect(statusChanges(previous, [ticket("DM-4", "Cancelled")])).toEqual([]);
  });

  it("reports a cancelled ticket under way as freeing a slot", () => {
    expect(statusChanges(previous, [ticket("DM-7", "Cancelled")])).toEqual([{ ticket: "DM-7", status: "Cancelled", freesSlot: true }]);
  });

  it("ignores unchanged tickets, moves between working statuses and Request changes", () => {
    expect(statusChanges(previous, [ticket("DM-5", "In Progress"), ticket("DM-1", "Blocked"), ticket("DM-6", "In Progress")])).toEqual([]);
  });

  it("frees nothing for a ticket the last look did not know, but reports it Done", () => {
    expect(statusChanges(previous, [ticket("DM-8", "Awaiting acceptance"), ticket("DM-9", "Done")])).toEqual([{ ticket: "DM-9", status: "Done", freesSlot: false }]);
  });
});

describe("shouldWakeManager", () => {
  const base = { dependents: 0, queued: 1, freesSlot: true, counting: 1, cap: 3 };
  it("wakes for a freed slot with a queued ticket and room under the cap", () => {
    expect(shouldWakeManager(base)).toBe(true);
    expect(shouldWakeManager({ ...base, counting: 2 })).toBe(true);
  });
  it("stays quiet at or over the cap, with nothing queued, or when no slot was freed", () => {
    expect(shouldWakeManager({ ...base, counting: 3 })).toBe(false);
    expect(shouldWakeManager({ ...base, counting: 4 })).toBe(false);
    expect(shouldWakeManager({ ...base, queued: 0 })).toBe(false);
    expect(shouldWakeManager({ ...base, freesSlot: false })).toBe(false);
  });
  it("always wakes when tickets depended on this one, a child's included", () => {
    expect(shouldWakeManager({ dependents: 1, queued: 0, freesSlot: false, counting: 3, cap: 3 })).toBe(true);
  });
});
