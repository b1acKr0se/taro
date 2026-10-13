import { describe, expect, it } from "vitest";

import type { Card } from "../shared/contracts";
import type { StoredDecision } from "../shared/state";
import { acceptanceReady, callAction, cardCalls } from "./card-calls";

const owner = {
  id: "agent-1",
  title: "NA-031",
  status: "idle",
  provider: "claude",
  model: null,
  workspaceId: null,
  pendingPermissions: 0,
  updatedAt: "2026-01-01T00:00:00Z",
  contextUsedTokens: null,
  contextMaxTokens: null,
  createdAt: null,
};

function decision(parts: Partial<StoredDecision>): StoredDecision {
  return {
    id: "fee-storage",
    question: "Store fees per trade?",
    why: "",
    blocking: false,
    options: [],
    recommended: "",
    reason: "",
    default: "",
    withdrawn: false,
    problems: [],
    key: "agent-1:fee-storage",
    project: "notes-app",
    ticket: "NA-031",
    agentId: "agent-1",
    agentRole: "owner",
    agentTitle: null,
    askedAt: "2026-01-01T00:00:00Z",
    status: "open",
    answer: null,
    ...parts,
  };
}

function card(parts: Partial<Card>): Card {
  return {
    id: "NA-031",
    title: "Offline drafts",
    status: "In Progress",
    column: "working",
    labels: [],
    complexity: null,
    investigation: false,
    parent: null,
    children: [],
    acceptanceDone: 0,
    acceptanceTotal: 0,
    updatedAt: null,
    owner,
    ownerElsewhere: null,
    pullRequest: null,
    lastStatus: null,
    stalled: false,
    stalledReason: null,
    decisions: [],
    subagents: [],
    pastAgents: [],
    latestMilestone: null,
    evidence: null,
    accepted: null,
    ...parts,
  };
}

describe("cardCalls", () => {
  it("asks nothing of a card with no decision, acceptance or permission", () => {
    expect(cardCalls(card({}))).toEqual([]);
  });

  it("shows one line for decisions: the blocking one first, the rest counted", () => {
    const calls = cardCalls(
      card({
        decisions: [
          decision({ id: "naming", question: "Call it drafts?", askedAt: "2026-01-01T00:00:00Z" }),
          decision({ id: "scope-approval", question: "Approve the plan?", blocking: true, askedAt: "2026-01-02T00:00:00Z" }),
          decision({ id: "colour", question: "Grey or blue?", askedAt: "2026-01-03T00:00:00Z" }),
        ],
      }),
    );
    expect(calls).toEqual([{ kind: "decision", text: "Approve the plan?", blocking: true, more: 2 }]);
  });

  it("leaves out answered and withdrawn decisions", () => {
    const calls = cardCalls(card({ decisions: [decision({ status: "answered" }), decision({ status: "withdrawn" })] }));
    expect(calls).toEqual([]);
  });

  it("offers acceptance only while an owner can hear it", () => {
    expect(cardCalls(card({ status: "Awaiting acceptance" }))).toEqual([{ kind: "acceptance", text: "Ready to accept", evidence: null }]);
    expect(cardCalls(card({ status: "Awaiting acceptance", owner: null }))).toEqual([]);
    expect(cardCalls(card({ status: "Awaiting acceptance", accepted: { at: "2026-01-01T00:00:00Z", merging: "into main" } }))).toEqual([]);
  });

  it("carries the evidence in one line, and is not ready while it is incomplete", () => {
    const complete = { checks: [{ command: "npm test", result: "ok" }], review: "clean", screenshots: [], screenshotsNone: "no visible change", missing: [], complete: true };
    expect(cardCalls(card({ status: "Awaiting acceptance", evidence: complete }))).toEqual([
      { kind: "acceptance", text: "Ready to accept", evidence: "1 check · review · no screenshots: no visible change" },
    ]);
    const incomplete = { ...complete, review: null, missing: ["the review outcome"], complete: false };
    expect(cardCalls(card({ status: "Awaiting acceptance", evidence: incomplete }))).toEqual([
      { kind: "acceptance", text: "Not ready to accept", evidence: "Evidence missing: the review outcome" },
    ]);
  });

  it("counts pending permissions", () => {
    expect(cardCalls(card({ owner: { ...owner, pendingPermissions: 1 } }))).toEqual([{ kind: "permission", text: "Waiting on a permission" }]);
    expect(cardCalls(card({ owner: { ...owner, pendingPermissions: 3 } }))).toEqual([{ kind: "permission", text: "Waiting on 3 permissions" }]);
  });

  it("lists every kind at once in a fixed order: decision, acceptance, permission", () => {
    const calls = cardCalls(card({ status: "Awaiting acceptance", decisions: [decision({})], owner: { ...owner, pendingPermissions: 1 } }));
    expect(calls.map((call) => call.kind)).toEqual(["decision", "acceptance", "permission"]);
    expect(calls.map(callAction)).toEqual(["Answer", "Review", "Allow"]);
  });
});

describe("acceptanceReady", () => {
  const evidence = { checks: [], review: null, screenshots: [], screenshotsNone: null, missing: ["a check"], complete: false };
  it("is ready without an evidence record to judge, and with complete evidence", () => {
    expect(acceptanceReady({ evidence: null })).toBe(true);
    expect(acceptanceReady({ evidence: { ...evidence, missing: [], complete: true } })).toBe(true);
  });
  it("withholds Accept while the evidence is incomplete", () => {
    expect(acceptanceReady({ evidence })).toBe(false);
  });
});
