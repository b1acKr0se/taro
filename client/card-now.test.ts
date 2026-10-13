import { describe, expect, it } from "vitest";

import type { Card } from "../shared/contracts";
import type { StoredDecision } from "../shared/state";
import { cardFooterParts, cardNowLine, offersCompact } from "./card-now";

const NOW = Date.parse("2026-01-01T12:00:00Z");

const owner = {
  id: "agent-1",
  title: "NA-027",
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

const status = { state: "waiting" as const, text: "implementer building NA-027.01", at: "2026-01-01T11:55:00Z" };

function implementer(parts: Partial<Card["subagents"][number]>): Card["subagents"][number] {
  return { ...owner, id: "agent-2", title: "NA-027.01 · implementer: building NA-027.01", status: "running", role: "implementer", createdAt: "2026-01-01T11:48:00Z", ...parts };
}

function decision(parts: Partial<StoredDecision>): StoredDecision {
  return {
    id: "naming",
    question: "Call it drafts?",
    why: "",
    blocking: false,
    options: [],
    recommended: "",
    reason: "",
    default: "",
    withdrawn: false,
    problems: [],
    key: "agent-1:naming",
    project: "notes-app",
    ticket: "NA-027",
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
    id: "NA-027",
    title: "Sync conflicts",
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
    ...parts,
  };
}

describe("cardNowLine", () => {
  it("says nothing for a queued card with no status", () => {
    expect(cardNowLine(card({ column: "queued", owner: null }), NOW)).toBeNull();
  });

  it("says nothing for a queued child, whose status line is its parent owner's", () => {
    expect(cardNowLine(card({ column: "queued", parent: "NA-027", lastStatus: status }), NOW)).toBeNull();
  });

  it("shows the owner's last status line when nothing else is going on", () => {
    expect(cardNowLine(card({ lastStatus: status }), NOW)).toEqual({ kind: "status", ...status });
  });

  it("prefers the running subagent over the owner's status line that repeats it", () => {
    const line = cardNowLine(card({ lastStatus: status, subagents: [implementer({})] }), NOW);
    expect(line).toEqual({ kind: "subagent", text: "Implementer building NA-027.01 · 12m" });
  });

  it("ignores an idle subagent", () => {
    expect(cardNowLine(card({ lastStatus: status, subagents: [implementer({ status: "idle" })] }), NOW)?.kind).toBe("status");
  });

  it("prefers what the card asks of you over a running subagent, counting every other ask", () => {
    const line = cardNowLine(
      card({
        status: "Awaiting acceptance",
        subagents: [implementer({})],
        owner: { ...owner, pendingPermissions: 2 },
        decisions: [decision({}), decision({ id: "scope-approval", key: "agent-1:scope-approval", question: "Approve the plan?", blocking: true })],
      }),
      NOW,
    );
    expect(line).toEqual({ kind: "call", call: { kind: "decision", text: "Approve the plan?", blocking: true, more: 1 }, more: 3 });
  });

  it("says a delivery with incomplete evidence is not ready, naming what is missing", () => {
    const evidence = { checks: [], review: null, screenshots: [], screenshotsNone: null, missing: ["checks", "review"], complete: false };
    expect(cardNowLine(card({ status: "Awaiting acceptance", column: "needs-you", evidence }), NOW)).toEqual({
      kind: "call",
      call: { kind: "acceptance", text: "Not ready to accept", evidence: "Evidence missing: checks, review" },
      more: 0,
    });
  });

  it("shows acceptance alone with nothing more", () => {
    expect(cardNowLine(card({ status: "Awaiting acceptance", column: "needs-you" }), NOW)).toEqual({
      kind: "call",
      call: { kind: "acceptance", text: "Ready to accept", evidence: null },
      more: 0,
    });
  });

  it("puts the stalled reason first, even over open decisions", () => {
    const line = cardNowLine(card({ column: "stalled", stalledReason: "Crashed twice within an hour", lastStatus: status, decisions: [decision({})] }), NOW);
    expect(line).toEqual({ kind: "stalled", text: "Crashed twice within an hour", at: status.at });
  });

  it("explains a stall without a recorded reason from the owner's state and last words", () => {
    const stalled = (parts: Partial<Card>) => cardNowLine(card({ column: "stalled", ...parts }), NOW);
    expect(stalled({ owner: null })).toEqual({ kind: "stalled", text: "No owner is running", at: null });
    expect(stalled({ owner: { ...owner, status: "error" } })).toMatchObject({ text: "The owner stopped with an error" });
    expect(stalled({ owner: { ...owner, status: "closed" } })).toMatchObject({ text: "The owner was closed" });
    expect(stalled({ lastStatus: { state: "failed", text: "tests need a database", at: status.at } })).toMatchObject({ text: "Failed: tests need a database" });
    expect(stalled({ lastStatus: status })).toMatchObject({ text: "Still idle after a nudge: implementer building NA-027.01" });
    expect(stalled({})).toEqual({ kind: "stalled", text: "Still idle after a nudge", at: null });
  });
});

describe("cardFooterParts", () => {
  it("is empty for a bare card", () => {
    expect(cardFooterParts(card({ owner: null }))).toEqual([]);
  });

  it("lists complexity, investigation, host, context and subagents in order", () => {
    const parts = cardFooterParts(
      card({ complexity: "high", investigation: true, ownerElsewhere: "laptop", owner: { ...owner, contextUsedTokens: 153_400 }, subagents: [implementer({}), implementer({ id: "agent-3" })] }),
    );
    expect(parts).toEqual(["high", "investigation", "on laptop", "context 153k", "2 subagents"]);
    expect(cardFooterParts(card({ subagents: [implementer({})] }))).toEqual(["1 subagent"]);
  });

  it("leaves a child's context to its parent's card", () => {
    expect(cardFooterParts(card({ parent: "NA-027", owner: { ...owner, contextUsedTokens: 153_400 }, subagents: [implementer({})] }))).toEqual(["1 subagent"]);
  });
});

describe("offersCompact", () => {
  it("only for an idle owner past 150k", () => {
    expect(offersCompact(card({ owner: { ...owner, contextUsedTokens: 150_001 } }))).toBe(true);
    expect(offersCompact(card({ owner: { ...owner, contextUsedTokens: 150_000 } }))).toBe(false);
    expect(offersCompact(card({ owner: { ...owner, status: "running", contextUsedTokens: 200_000 } }))).toBe(false);
    expect(offersCompact(card({ owner: { ...owner, contextUsedTokens: null } }))).toBe(false);
    expect(offersCompact(card({ owner: null }))).toBe(false);
    expect(offersCompact(card({ parent: "NA-027", owner: { ...owner, contextUsedTokens: 200_000 } }))).toBe(false);
  });
});
