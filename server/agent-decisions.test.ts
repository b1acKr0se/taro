import { describe, expect, it } from "vitest";

import { StoredDecisionSchema, type StoredDecision } from "../shared/state";
import { decisionsOfAgent } from "./agent-decisions";

const decision = (agentId: string, id: string, over: Partial<StoredDecision> = {}): StoredDecision =>
  StoredDecisionSchema.parse({ id, question: "Q?", key: `${agentId}:${id}`, project: "p", ticket: null, agentId, agentRole: "owner", agentTitle: null, askedAt: "2026-01-01T00:00:00Z", status: "open", ...over });

describe("decisionsOfAgent", () => {
  it("keeps every status of the agent and drops other agents' and held ones", () => {
    const all = [
      decision("a", "one"),
      decision("a", "two", { status: "answered" }),
      decision("a", "three", { status: "withdrawn" }),
      decision("a", "four", { held: true }),
      decision("b", "one"),
    ];
    expect(decisionsOfAgent(all, "a").map((each) => each.key)).toEqual(["a:one", "a:two", "a:three"]);
  });

  it("is empty without decisions", () => {
    expect(decisionsOfAgent([], "a")).toEqual([]);
  });
});
