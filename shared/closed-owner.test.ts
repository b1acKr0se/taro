import { describe, expect, it } from "vitest";

import { AUTO_RELAUNCH_WINDOW_MS, RECENTLY_CLOSED_MS, ownerRelaunchedText, ownerRelaunchFailedText, ownerRested, ticketsWithClosedOwner } from "./closed-owner";
import { TARO_LABELS } from "./project";

const NOW = Date.parse("2026-01-05T12:00:00Z");
const ticket = (id: string, status: string, notes: string | null = null, parentTaskId: string | null = null) => ({ id, status, parentTaskId, notes });
const owner = (id: string, status: string, updatedAt = "2026-01-05T11:00:00Z") => ({ status, updatedAt, labels: { [TARO_LABELS.role]: "owner", [TARO_LABELS.ticket]: id } });

describe("ticketsWithClosedOwner", () => {
  it("picks worked tickets whose only owner is closed, in order", () => {
    const tickets = [ticket("TR-2", "In Progress"), ticket("TR-1", "Planning"), ticket("TR-3", "Reviewing")];
    const owners = [owner("TR-1", "closed"), owner("TR-2", "closed"), owner("TR-3", "closed")];
    expect(ticketsWithClosedOwner(tickets, owners, NOW)).toEqual(["TR-2", "TR-1", "TR-3"]);
  });

  it("leaves Awaiting acceptance, Queued, Done and children alone", () => {
    const tickets = [ticket("A-1", "Awaiting acceptance"), ticket("A-2", "Queued"), ticket("A-3", "Done"), ticket("A-4", "In Progress", null, "A-1")];
    const owners = ["A-1", "A-2", "A-3", "A-4"].map((id) => owner(id, "closed"));
    expect(ticketsWithClosedOwner(tickets, owners, NOW)).toEqual([]);
  });

  it("leaves a ticket with a live owner or no owner at all", () => {
    const tickets = [ticket("TR-1", "In Progress"), ticket("TR-2", "In Progress")];
    expect(ticketsWithClosedOwner(tickets, [owner("TR-1", "closed"), owner("tr-1", "idle")], NOW)).toEqual([]);
  });

  it("leaves a parked ticket to the user", () => {
    const parked = "HOLD 2026-01-05T10:04Z — parked by the user";
    expect(ticketsWithClosedOwner([ticket("TR-1", "In Progress", parked)], [owner("TR-1", "closed")], NOW)).toEqual([]);
  });

  it("stops after three relaunches within a day but counts older ones out", () => {
    const record = (at: string) => ownerRelaunchedText(at, "a", "b");
    const owners = [owner("TR-1", "closed")];
    const two = [record("2026-01-05T11:30:00Z"), record("2026-01-05T11:50:00Z")].join("\n\n");
    expect(ticketsWithClosedOwner([ticket("TR-1", "In Progress", two)], owners, NOW)).toEqual(["TR-1"]);
    const three = [record("2026-01-05T01:30:00Z"), record("2026-01-05T06:50:00Z"), record("2026-01-05T11:50:00Z")].join("\n\n");
    expect(ticketsWithClosedOwner([ticket("TR-1", "In Progress", three)], owners, NOW)).toEqual([]);
    const mixed = [record("2026-01-05T01:30:00Z"), record("2026-01-05T11:30:00Z"), ownerRelaunchFailedText("2026-01-05T11:50:00Z", "boom")].join("\n\n");
    expect(ticketsWithClosedOwner([ticket("TR-1", "In Progress", mixed)], owners, NOW)).toEqual([]);
    const old = [record("2026-01-03T09:00:00Z"), record("2026-01-04T09:00:00Z"), record(new Date(NOW - AUTO_RELAUNCH_WINDOW_MS + 60_000).toISOString())].join("\n\n");
    expect(ticketsWithClosedOwner([ticket("TR-1", "In Progress", old)], owners, NOW)).toEqual(["TR-1"]);
  });

  it("leaves a ticket whose owner waits on the user's answer, matching ids in any case", () => {
    const tickets = [ticket("TR-1", "Planning"), ticket("TR-2", "Planning")];
    const owners = [owner("TR-1", "closed"), owner("TR-2", "closed")];
    expect(ticketsWithClosedOwner(tickets, owners, NOW, new Set(["TR-1"]))).toEqual(["TR-2"]);
    expect(ticketsWithClosedOwner(tickets, owners, NOW, new Set())).toEqual(["TR-1", "TR-2"]);
  });

  it("leaves an owner closed more than six hours ago, and uses the newest of several", async () => {
    const tickets = [ticket("TR-1", "In Progress")];
    const long = new Date(NOW - RECENTLY_CLOSED_MS - 60_000).toISOString();
    expect(ticketsWithClosedOwner(tickets, [owner("TR-1", "closed", long)], NOW)).toEqual([]);
    expect(ticketsWithClosedOwner(tickets, [owner("TR-1", "closed", long), owner("TR-1", "closed", "2026-01-05T11:59:00Z")], NOW)).toEqual(["TR-1"]);
    expect(ticketsWithClosedOwner(tickets, [owner("TR-1", "closed", "not a time")], NOW)).toEqual([]);
  });

  it("leaves a rested owner, one that finished its turn before closing, and uses the newest owner's state", () => {
    const tickets = [ticket("TR-1", "In Progress")];
    expect(ticketsWithClosedOwner(tickets, [{ ...owner("TR-1", "closed", "2026-01-05T11:00:00Z"), rested: true }], NOW)).toEqual([]);
    expect(ticketsWithClosedOwner(tickets, [{ ...owner("TR-1", "closed", "2026-01-05T11:00:00Z"), rested: false }], NOW)).toEqual(["TR-1"]);
    const older = { ...owner("TR-1", "closed", "2026-01-05T09:00:00Z"), rested: false };
    expect(ticketsWithClosedOwner(tickets, [older, { ...owner("TR-1", "closed", "2026-01-05T11:00:00Z"), rested: true }], NOW)).toEqual([]);
  });
});

describe("ownerRested", () => {
  const active = "2026-01-05T11:00:00Z";
  it("without a recorded turn start: true when the turn ended at or after the last activity, within a minute of slack", () => {
    expect(ownerRested({ lastTurnEndedAt: "2026-01-05T11:00:00Z" }, active)).toBe(true);
    expect(ownerRested({ lastTurnEndedAt: "2026-01-05T10:59:30Z", lastTurnStartedAt: null }, active)).toBe(true);
    expect(ownerRested({ lastTurnEndedAt: "2026-01-05T10:50:00Z" }, active)).toBe(false);
    expect(ownerRested({ lastTurnEndedAt: null }, active)).toBe(false);
    expect(ownerRested({ lastTurnEndedAt: "not a time" }, active)).toBe(false);
    expect(ownerRested(null, active)).toBe(false);
  });

  it("with a recorded turn start: true only when the latest end is not before it, however close the restart", () => {
    // A nudge started a new turn 20 seconds after the last end; the daemon restarted during it.
    expect(ownerRested({ lastTurnEndedAt: "2026-01-05T10:59:40Z", lastTurnStartedAt: "2026-01-05T11:00:00Z" }, active)).toBe(false);
    expect(ownerRested({ lastTurnEndedAt: "2026-01-05T10:59:40Z", lastTurnStartedAt: "2026-01-05T10:59:00Z" }, active)).toBe(true);
    // The plugin was down as a turn began, so no start was recorded, and the daemon restarted mid-turn: activity came after the last end.
    expect(ownerRested({ lastTurnEndedAt: "2026-01-05T10:05:00Z", lastTurnStartedAt: "2026-01-05T10:00:00Z" }, "2026-01-05T10:30:00Z")).toBe(false);
    // The turn's end could not be read, so the end is stale.
    expect(ownerRested({ lastTurnEndedAt: "2026-01-05T09:00:00Z", lastTurnStartedAt: "2026-01-05T10:59:00Z" }, "2026-01-05T09:00:00Z")).toBe(false);
  });
});
