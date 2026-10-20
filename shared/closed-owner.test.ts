import { describe, expect, it } from "vitest";

import { AUTO_RELAUNCH_WINDOW_MS, ownerRelaunchedText, ticketsWithClosedOwner } from "./closed-owner";
import { TARO_LABELS } from "./project";

const NOW = Date.parse("2026-01-05T12:00:00Z");
const ticket = (id: string, status: string, notes: string | null = null, parentTaskId: string | null = null) => ({ id, status, parentTaskId, notes });
const owner = (id: string, status: string) => ({ status, labels: { [TARO_LABELS.role]: "owner", [TARO_LABELS.ticket]: id } });

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

  it("stops after two relaunches within the hour but counts older ones out", () => {
    const record = (at: string) => ownerRelaunchedText(at, "a", "b");
    const owners = [owner("TR-1", "closed")];
    const two = [record("2026-01-05T11:30:00Z"), record("2026-01-05T11:50:00Z")].join("\n\n");
    expect(ticketsWithClosedOwner([ticket("TR-1", "In Progress", two)], owners, NOW)).toEqual([]);
    const old = [record("2026-01-05T09:00:00Z"), record(new Date(NOW - AUTO_RELAUNCH_WINDOW_MS + 60_000).toISOString())].join("\n\n");
    expect(ticketsWithClosedOwner([ticket("TR-1", "In Progress", old)], owners, NOW)).toEqual(["TR-1"]);
  });
});
