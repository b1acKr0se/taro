import { describe, expect, it } from "vitest";

import type { StoredDecision } from "../shared/state";
import { walkOrder } from "./walk-order";

function decision(id: string, blocking: boolean, askedAt: string): StoredDecision {
  return {
    id,
    question: id,
    why: "",
    blocking,
    options: [],
    recommended: "",
    reason: "",
    default: "",
    withdrawn: false,
    problems: [],
    key: `agent:${id}`,
    project: "app",
    ticket: "AP-1",
    agentId: "agent",
    agentRole: "owner",
    agentTitle: null,
    askedAt,
    turn: null,
    status: "open",
    answer: null,
  };
}

describe("walkOrder", () => {
  it("puts blocking first, then presets by impact, then the rest oldest first", () => {
    const ordered = walkOrder([
      decision("color", false, "2026-01-03"),
      decision("complexity", true, "2026-01-01"),
      decision("merge", true, "2026-01-02"),
      decision("naming", false, "2026-01-01"),
      decision("scope-approval", false, "2026-01-05"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["merge", "complexity", "scope-approval", "naming", "color"]);
  });
});
