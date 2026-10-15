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
  turnStartedAt: null,
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
    turn: null,
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
    pullRequestMerged: false,
    lastStatus: null,
    stalled: false,
    stalledReason: null,
    decisions: [],
    subagents: [],
    pastAgents: [],
    latestMilestone: null,
    activity: null,
    evidence: null,
    accepted: null,
    notMerged: null,
    permission: null,
    delivered: null,
    pause: null,
    pausable: false,
    ...parts,
  };
}

describe("cardCalls", () => {
  it("asks nothing of a card with no decision, acceptance or permission", () => {
    expect(cardCalls(card({}))).toEqual([]);
  });

  it("carries the first decision whole, the blocking one first, the rest counted", () => {
    const approval = decision({ id: "scope-approval", question: "Approve the plan?", blocking: true, askedAt: "2026-01-02T00:00:00Z" });
    const calls = cardCalls(
      card({
        decisions: [decision({ id: "naming", question: "Call it drafts?", askedAt: "2026-01-01T00:00:00Z" }), approval, decision({ id: "colour", question: "Grey or blue?", askedAt: "2026-01-03T00:00:00Z" })],
      }),
    );
    expect(calls).toEqual([{ kind: "decision", decision: approval, more: 2 }]);
  });

  it("leaves out answered and withdrawn decisions", () => {
    const calls = cardCalls(card({ decisions: [decision({ status: "answered" }), decision({ status: "withdrawn" })] }));
    expect(calls).toEqual([]);
  });

  it("offers acceptance only while an owner can hear it", () => {
    expect(cardCalls(card({ status: "Awaiting acceptance" }))).toEqual([{ kind: "acceptance", ready: true, delivered: null, evidence: null, notMerged: null }]);
    expect(cardCalls(card({ status: "Awaiting acceptance", delivered: "Drafts work offline." }))).toEqual([{ kind: "acceptance", ready: true, delivered: "Drafts work offline.", evidence: null, notMerged: null }]);
    expect(cardCalls(card({ status: "Awaiting acceptance", owner: null }))).toEqual([]);
    expect(cardCalls(card({ status: "Awaiting acceptance", accepted: { at: "2026-01-01T00:00:00Z", merging: "into main" } }))).toEqual([]);
  });

  it("offers acceptance again after a merge the owner could not make, with why (TR-109)", () => {
    const notMerged = { at: "2026-01-01T00:10Z", reason: "the main checkout has uncommitted changes in src/app.ts", merged: false };
    expect(cardCalls(card({ status: "Awaiting acceptance", notMerged }))).toEqual([
      { kind: "acceptance", ready: true, delivered: null, evidence: null, notMerged: { reason: notMerged.reason, merged: false } },
    ]);
  });

  it("offers acceptance again after a merged pull request the local base branch could not follow (TR-110)", () => {
    const notMerged = { at: "2026-01-01T00:10Z", reason: "main has 2 commits origin lacks; push or drop them, then Accept again", merged: true };
    expect(cardCalls(card({ status: "Awaiting acceptance", notMerged }))).toEqual([
      { kind: "acceptance", ready: true, delivered: null, evidence: null, notMerged: { reason: notMerged.reason, merged: true } },
    ]);
  });

  it("carries the evidence in one line, and is not ready while it is incomplete", () => {
    const complete = { checks: [{ command: "npm test", result: "ok" }], review: "clean", ux: null, screenshots: [], screenshotsNone: "no visible change", missing: [], complete: true };
    expect(cardCalls(card({ status: "Awaiting acceptance", evidence: complete }))).toEqual([
      { kind: "acceptance", ready: true, delivered: null, evidence: "1 check · review · no screenshots: no visible change", notMerged: null },
    ]);
    const incomplete = { ...complete, review: null, missing: ["the review outcome"], complete: false };
    expect(cardCalls(card({ status: "Awaiting acceptance", evidence: incomplete }))).toEqual([
      { kind: "acceptance", ready: false, delivered: null, evidence: "Evidence missing: the review outcome", notMerged: null },
    ]);
  });

  it("carries what the first permission asks and how many wait", () => {
    expect(cardCalls(card({ owner: { ...owner, pendingPermissions: 1 } }))).toEqual([]);
    const permission = { title: "Run a command", detail: "npm test", id: null, agentId: "agent-1", role: "owner" as const, workspaceId: null, count: 3 };
    expect(cardCalls(card({ owner: { ...owner, pendingPermissions: 3 }, permission }))).toEqual([{ kind: "permission", asker: null, title: "Run a command", detail: "npm test", count: 3 }]);
  });

  // TR-096: a researcher's request left its card in Working, saying nothing.
  it("carries a subagent's permission, naming its job, while the owner asks nothing", () => {
    const permission = { title: "Allow Bash?", detail: "npm test", id: "p1", agentId: "researcher-1", role: "researcher" as const, workspaceId: null, count: 1 };
    expect(cardCalls(card({ owner, permission }))).toEqual([{ kind: "permission", asker: "Researcher asks", title: "Allow Bash?", detail: "npm test", count: 1 }]);
  });

  it("lists every kind at once in a fixed order: decision, acceptance, permission", () => {
    const permission = { title: "Edit", detail: null, id: null, agentId: "agent-1", role: "owner" as const, workspaceId: null, count: 1 };
    const calls = cardCalls(card({ status: "Awaiting acceptance", decisions: [decision({})], owner: { ...owner, pendingPermissions: 1 }, permission }));
    expect(calls.map((call) => call.kind)).toEqual(["decision", "acceptance", "permission"]);
    expect(calls.map(callAction)).toEqual(["Answer", "Request changes", "Review"]);
  });

  it("offers Review on a delivery that is not ready", () => {
    const evidence = { checks: [], review: null, ux: null, screenshots: [], screenshotsNone: null, missing: ["a check"], complete: false };
    const [call] = cardCalls(card({ status: "Awaiting acceptance", evidence }));
    expect(call === undefined ? null : callAction(call)).toBe("Review");
  });
});

describe("acceptanceReady", () => {
  const evidence = { checks: [], review: null, ux: null, screenshots: [], screenshotsNone: null, missing: ["a check"], complete: false };
  it("is ready without an evidence record to judge, and with complete evidence", () => {
    expect(acceptanceReady({ evidence: null })).toBe(true);
    expect(acceptanceReady({ evidence: { ...evidence, missing: [], complete: true } })).toBe(true);
  });
  it("withholds Accept while the evidence is incomplete", () => {
    expect(acceptanceReady({ evidence })).toBe(false);
  });
});
