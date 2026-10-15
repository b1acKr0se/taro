import { describe, expect, it } from "vitest";

import { holdReason } from "./queue-check";
import { namedTicketIds, queuedWait } from "./queued-wait";

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
    expect(wait(["NA-024", "NA-031"], null)).toEqual({ on: [{ id: "NA-031", status: "Planning" }], dependencies: ["NA-031"], hold: null });
  });

  it("names the tickets a manager's HOLD names, its own id left out", () => {
    const notes = "HOLD 2026-01-01T10:00Z — overlaps NA-031, which reworks the card NA-035 changes; start NA-035 once NA-031 is Done.";
    expect(wait([], notes)).toEqual({
      on: [{ id: "NA-031", status: "Planning" }],
      dependencies: [],
      hold: "overlaps NA-031, which reworks the card NA-035 changes; start NA-035 once NA-031 is Done.",
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
    expect(wait([], "HOLD 2026-01-01T10:00Z — one rewrite at a time")).toEqual({ on: [], dependencies: [], hold: "one rewrite at a time" });
    expect(wait([], "HOLD 2026-01-01T10:00Z — paused by the user; see NA-031")).toBeNull();
    expect(wait(["NA-031"], "HOLD 2026-01-01T10:00Z — paused by the user")).toEqual({ on: [{ id: "NA-031", status: "Planning" }], dependencies: ["NA-031"], hold: null });
  });
});
