import { describe, expect, it } from "vitest";

import { holdReason, recount } from "./queue-check";
import { namedTicketIds, queuedSlot, queuedWait } from "./queued-wait";

const tickets = [
  { id: "NA-024", status: "Done", parentTaskId: null },
  { id: "NA-031", status: "Planning", parentTaskId: null },
  { id: "NA-032", status: "In Progress", parentTaskId: null },
  { id: "NA-035", status: "Queued", parentTaskId: null },
];

const wait = (dependencies: string[], notes: string | null, id = "NA-035") => queuedWait({ id, dependencies, holdReason: holdReason(notes), tickets });

describe("namedTicketIds", () => {
  it("finds ids in order, once each, children included, and nothing else", () => {
    expect(namedTicketIds("overlaps NA-031 and NA-027.01; start once NA-031 is Done")).toEqual(["NA-031", "NA-027.01"]);
    expect(namedTicketIds("after the rewrite, see ISO-8601 time")).toEqual(["ISO-8601"]);
    expect(namedTicketIds("")).toEqual([]);
    expect(namedTicketIds("na-031 lowercase is not an id")).toEqual([]);
  });
});

describe("queuedWait", () => {
  it("is null when nothing holds it: no dependencies, only Done ones, or a released hold", () => {
    expect(wait([], null)).toBeNull();
    expect(wait(["NA-024"], null)).toBeNull();
    expect(wait([], "HOLD 2026-01-01T10:00Z — after NA-031\n\nRELEASE 2026-01-01T11:00Z — NA-031 done")).toBeNull();
  });

  it("names unfinished dependencies with their status and leaves Done ones out", () => {
    expect(wait(["NA-024", "NA-031"], null)).toEqual({ on: [{ id: "NA-031", status: "Planning" }], dependencies: ["NA-031"], hold: null, slot: null });
  });

  it("names the tickets a manager's HOLD names, its own id left out", () => {
    const notes = "HOLD 2026-01-01T10:00Z — overlaps NA-031, which reworks the card NA-035 changes; start NA-035 once NA-031 is Done.";
    expect(wait([], notes)).toEqual({
      on: [{ id: "NA-031", status: "Planning" }],
      dependencies: [],
      hold: "overlaps NA-031, which reworks the card NA-035 changes; start NA-035 once NA-031 is Done.",
      slot: null,
    });
  });

  it("names a ticket once when it is both a dependency (in any case) and named by the hold, dependencies first", () => {
    expect(wait(["na-032"], "HOLD 2026-01-01T10:00Z — after NA-031 and NA-032")?.on).toEqual([
      { id: "NA-032", status: "In Progress" },
      { id: "NA-031", status: "Planning" },
    ]);
  });

  it("keeps a held ticket whose named ticket is Done, and one the tracker does not list, by id alone", () => {
    expect(wait([], "HOLD 2026-01-01T10:00Z — after NA-024 and NA-077")?.on).toEqual([
      { id: "NA-024", status: "Done" },
      { id: "NA-077", status: null },
    ]);
  });

  it("keeps a hold that names no ticket, and ignores a user's pause", () => {
    expect(wait([], "HOLD 2026-01-01T10:00Z — one rewrite at a time")).toEqual({ on: [], dependencies: [], hold: "one rewrite at a time", slot: null });
    expect(wait([], "HOLD 2026-01-01T10:00Z — paused by the user; see NA-031")).toBeNull();
    expect(wait(["NA-031"], "HOLD 2026-01-01T10:00Z — paused by the user")).toEqual({ on: [{ id: "NA-031", status: "Planning" }], dependencies: ["NA-031"], hold: null, slot: null });    // Its TR-166 words too.
    expect(wait([], "HOLD 2026-01-01T10:00Z — parked by the user before it started: never start it until the user resumes it")).toBeNull();
  });
});

describe("queued slot (TR-142)", () => {
  const owner = (ticket: string, status = "idle") => ({ status, labels: { "taro.role": "owner", "taro.ticket": ticket } });
  const board = [
    { id: "TR-1", status: "In Progress", parentTaskId: null },
    { id: "TR-2", status: "Reviewing", parentTaskId: null },
    { id: "TR-3", status: "Planning", parentTaskId: null },
    { id: "TR-4", status: "Queued", parentTaskId: null },
    { id: "TR-5", status: "Queued", parentTaskId: null },
    { id: "TR-6", status: "Queued", parentTaskId: null },
    { id: "TR-7", status: "Queued", parentTaskId: null },
    { id: "TR-8", status: "Queued", parentTaskId: null },
    { id: "TR-3.01", status: "Queued", parentTaskId: "TR-3" },
  ];
  const count = recount({
    owners: [owner("TR-1"), owner("TR-2"), owner("TR-3"), owner("TR-8"), owner("TR-9", "closed")],
    tickets: board,
    queued: [
      { id: "TR-4", dependencies: [], notes: null },
      { id: "TR-5", dependencies: ["TR-1"], notes: null },
      { id: "TR-6", dependencies: [], notes: "HOLD 2026-01-01T10:00Z — after TR-2" },
      { id: "TR-7", dependencies: [], notes: "HOLD 2026-01-01T10:00Z — paused by the user" },
      { id: "TR-8", dependencies: [], notes: null },
    ],
    cap: 3,
    threads: { current: 900, max: 2048 },
  });

  it("gives a startable ticket the recount's owners, cap, startable count and threads", () => {
    expect(queuedSlot(count, "TR-4", true)).toEqual({ running: ["TR-1", "TR-2", "TR-3", "TR-8"], cap: 3, startable: 1, threads: { current: 900, max: 2048 }, managerRunning: true });
    expect(queuedSlot(count, "TR-4", false)?.managerRunning).toBe(false);
  });

  it("gives none to a ticket waiting on a dependency, held, paused, already owned, a child, or unknown", () => {
    for (const id of ["TR-5", "TR-6", "TR-7", "TR-8", "TR-3.01", "TR-99"]) expect(queuedSlot(count, id, true)).toBeNull();
  });

  it("is the wait only when no dependency or hold stands first", () => {
    const slot = queuedSlot(count, "TR-4", true);
    const at = (dependencies: string[], notes: string | null) => queuedWait({ id: "TR-4", dependencies, holdReason: holdReason(notes), tickets: board, slot });
    expect(at([], null)).toEqual({ on: [], dependencies: [], hold: null, slot });
    expect(at(["TR-1"], null)).toEqual({ on: [{ id: "TR-1", status: "In Progress" }], dependencies: ["TR-1"], hold: null, slot: null });
    expect(queuedWait({ id: "TR-4", dependencies: [], holdReason: null, tickets: board, slot: null })).toBeNull();
    expect(queuedWait({ id: "TR-4", dependencies: [], holdReason: null, tickets: board })).toBeNull();
  });
});
