import { describe, expect, it } from "vitest";

import { decisionsOfLiveAgents, openQuestionHolding, StoredDecisionSchema, withdrawOpenDecisions, type StoredDecision } from "./state";

function decision(agentId: string, id: string, status: StoredDecision["status"] = "open", project = "taro"): StoredDecision {
  return {
    id,
    question: `${id}?`,
    why: "",
    blocking: true,
    options: [{ label: "Yes", prompt: "Yes", consequence: "", images: [] }],
    recommended: "Yes",
    reason: "",
    default: "",
    withdrawn: false,
    problems: [],
    key: `${agentId}:${id}`,
    project,
    ticket: "TR-5",
    agentId,
    agentRole: "owner",
    agentTitle: null,
    askedAt: "2026-10-13T12:00:00.000Z",
    turn: null,
    status,
    answer: null,
  };
}

describe("decisionsOfLiveAgents", () => {
  it("keeps only open decisions whose agent is live", () => {
    const decisions = [decision("old-owner", "scope-approval"), decision("new-owner", "scope-approval"), decision("new-owner", "merge", "answered")];
    expect(decisionsOfLiveAgents(decisions, new Set(["new-owner"])).map((kept) => kept.key)).toEqual(["new-owner:scope-approval"]);
  });

  it("shows nothing when no agent is live, and nothing from nothing", () => {
    expect(decisionsOfLiveAgents([decision("a", "x")], new Set())).toEqual([]);
    expect(decisionsOfLiveAgents([], new Set(["a"]))).toEqual([]);
  });
});

describe("openQuestionHolding (TR-124)", () => {
  it("finds the agent's other open decision", () => {
    const decisions = [decision("other-owner", "naming"), decision("owner", "naming"), decision("owner", "merge", "answered")];
    expect(openQuestionHolding(decisions, "owner", "owner:scope-approval")?.key).toBe("owner:naming");
  });

  it("never holds a re-ask of the open decision itself", () => {
    expect(openQuestionHolding([decision("owner", "scope-approval")], "owner", "owner:scope-approval")).toBeUndefined();
  });

  it("holds nothing once the earlier decisions are answered or withdrawn, or when there are none", () => {
    expect(openQuestionHolding([decision("owner", "naming", "answered"), decision("owner", "size", "withdrawn")], "owner", "owner:scope-approval")).toBeUndefined();
    expect(openQuestionHolding([], "owner", "owner:scope-approval")).toBeUndefined();
    expect(openQuestionHolding([decision("other-owner", "naming")], "owner", "owner:scope-approval")).toBeUndefined();
  });
});

describe("withdrawOpenDecisions", () => {
  it("withdraws the matching open decisions and counts them", () => {
    const decisions = [decision("old-owner", "scope-approval"), decision("old-owner", "complexity"), decision("new-owner", "scope-approval")];
    expect(withdrawOpenDecisions(decisions, (candidate) => candidate.agentId === "old-owner")).toBe(2);
    expect(decisions.map((candidate) => candidate.status)).toEqual(["withdrawn", "withdrawn", "open"]);
  });

  it("leaves answered decisions as answered, keeping their record", () => {
    const decisions = [decision("old-owner", "scope-approval", "answered")];
    expect(withdrawOpenDecisions(decisions, () => true)).toBe(0);
    expect(decisions[0]?.status).toBe("answered");
  });

  it("withdraws nothing from an empty list or when nothing matches", () => {
    expect(withdrawOpenDecisions([], () => true)).toBe(0);
    const decisions = [decision("a", "x")];
    expect(withdrawOpenDecisions(decisions, () => false)).toBe(0);
    expect(decisions[0]?.status).toBe("open");
  });
});

describe("StoredDecisionSchema", () => {
  it("reads a decision stored before its turn was recorded (TR-108) with no turn", () => {
    const { turn: _turn, ...stored } = decision("owner-1", "scope-approval", "answered");
    expect(StoredDecisionSchema.parse(stored).turn).toBeNull();
    expect(StoredDecisionSchema.parse({ ...stored, turn: "abc" }).turn).toBe("abc");
  });
});
