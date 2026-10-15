import { describe, expect, it } from "vitest";

import { carriedQuestionLines, decisionsOfLiveAgents, openQuestionHolding, questionsToCarry, StoredDecisionSchema, withdrawOpenDecisions, type StoredDecision } from "./state";

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

  it("marks only withdrawals made because the agent went away (TR-136)", () => {
    const decisions = [decision("old-owner", "scope-approval"), decision("other-owner", "naming")];
    withdrawOpenDecisions(decisions, (candidate) => candidate.agentId === "old-owner", true);
    withdrawOpenDecisions(decisions, (candidate) => candidate.agentId === "other-owner");
    expect(decisions.map((candidate) => candidate.withdrawnWithAgent)).toEqual([true, undefined]);
  });
});

describe("questionsToCarry (TR-136)", () => {
  const gone = (agentId: string, id: string, parts: Partial<StoredDecision> = {}): StoredDecision => ({ ...decision(agentId, id, "withdrawn"), withdrawnWithAgent: true, ...parts });

  it("hands on owners' questions withdrawn with their owner, for this project and ticket only, oldest first", () => {
    const decisions = [
      gone("old-owner", "storage", { askedAt: "2026-10-13T12:30:00.000Z" }),
      gone("old-owner", "naming", { askedAt: "2026-10-13T12:10:00.000Z" }),
      decision("old-owner", "size", "withdrawn"),
      decision("old-owner", "merge", "answered"),
      decision("live-owner", "open-one"),
      gone("reviewer", "nit", { agentRole: "reviewer" }),
      gone("old-owner", "elsewhere", { ticket: "TR-6" }),
      gone("old-owner", "no-ticket", { ticket: null }),
      gone("old-owner", "other-project", { project: "shop" }),
    ];
    expect(questionsToCarry(decisions, "taro", "TR-5").map((each) => each.id)).toEqual(["naming", "storage"]);
    // Ticket ids compare without case, as owners' labels do.
    expect(questionsToCarry(decisions, "taro", "tr-5").map((each) => each.id)).toEqual(["naming", "storage"]);
  });

  it("hands on one carried to an owner that never asked it again, not one it did", () => {
    expect(questionsToCarry([gone("first", "storage", { carriedTo: "second" })], "taro", "TR-5")).toHaveLength(1);
    const askedAgain = [gone("first", "storage", { carriedTo: "second" }), decision("second", "storage", "answered")];
    expect(questionsToCarry(askedAgain, "taro", "TR-5")).toEqual([]);
  });

  it("keeps the newest copy of a question two owners left open", () => {
    const decisions = [gone("first", "storage", { carriedTo: "third" }), gone("second", "storage", { askedAt: "2026-10-13T13:00:00.000Z", question: "Reworded?" })];
    expect(questionsToCarry(decisions, "taro", "TR-5").map((each) => each.question)).toEqual(["Reworded?"]);
  });

  it("hands on nothing from nothing", () => {
    expect(questionsToCarry([], "taro", "TR-5")).toEqual([]);
  });
});

describe("carriedQuestionLines (TR-136)", () => {
  it("puts each question's id and text on one line", () => {
    const questions = [
      { id: "naming", question: "Call it Notes\n  or Memos?" },
      { id: "storage", question: "  Store notes locally?  " },
    ];
    expect(carriedQuestionLines(questions)).toBe("- `naming`: Call it Notes or Memos?\n- `storage`: Store notes locally?");
    expect(carriedQuestionLines([])).toBe("");
  });
});

describe("StoredDecisionSchema", () => {
  it("reads a decision stored before its turn was recorded (TR-108) with no turn", () => {
    const { turn: _turn, ...stored } = decision("owner-1", "scope-approval", "answered");
    expect(StoredDecisionSchema.parse(stored).turn).toBeNull();
    expect(StoredDecisionSchema.parse({ ...stored, turn: "abc" }).turn).toBe("abc");
  });
});
