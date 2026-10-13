import { describe, expect, it } from "vitest";

import { pastTicketAgents } from "./past-agents";

const agent = (id: string, role: string, archivedAt: string | null | undefined, updatedAt: string) => ({ id, role, archivedAt, updatedAt });

describe("pastTicketAgents", () => {
  it("returns nothing for an empty list or only live agents", () => {
    expect(pastTicketAgents([])).toEqual([]);
    expect(pastTicketAgents([agent("a", "owner", null, "2026-01-01"), agent("b", "helper", undefined, "2026-01-02")])).toEqual([]);
  });

  it("drops manager and other roles", () => {
    expect(pastTicketAgents([agent("a", "manager", "2026-02-01", "2026-01-01"), agent("b", "other", "2026-02-01", "2026-01-01")])).toEqual([]);
  });

  it("sorts newest updatedAt first without moving owners ahead", () => {
    const result = pastTicketAgents([
      agent("o1", "owner", "2026-03-01", "2026-01-01"),
      agent("h1", "helper", "2026-03-02", "2026-01-03"),
      agent("r1", "reviewer", "2026-03-03", "2026-01-04"),
      agent("o2", "owner", "2026-03-04", "2026-01-02"),
    ]);
    expect(result).toEqual([
      { id: "r1", role: "reviewer", archivedAt: "2026-03-03" },
      { id: "h1", role: "helper", archivedAt: "2026-03-02" },
      { id: "o2", role: "owner", archivedAt: "2026-03-04" },
      { id: "o1", role: "owner", archivedAt: "2026-03-01" },
    ]);
  });

  it("keeps input order for equal updatedAt", () => {
    const result = pastTicketAgents([agent("a", "owner", "x", "t"), agent("b", "helper", "x", "t"), agent("c", "owner", "x", "t")]);
    expect(result.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
});
