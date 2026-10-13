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
    accepted: null,
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

  it("shows the owner's last status line as the headline, its state and age as the detail", () => {
    expect(cardNowLine(card({ lastStatus: status }), NOW)).toEqual({ kind: "status", state: "waiting", headline: "Implementer building NA-027.01", detail: "Waiting · 5m ago" });
  });

  it("prefers the running subagent over the owner's status line that repeats it", () => {
    expect(cardNowLine(card({ lastStatus: status, subagents: [implementer({})] }), NOW)).toEqual({ kind: "subagent", headline: "Implementer building NA-027.01", detail: "running 12m" });
  });

  it("counts the other running subagents in the detail", () => {
    const line = cardNowLine(card({ subagents: [implementer({}), implementer({ id: "agent-3", createdAt: "2026-01-01T11:40:00Z" })] }), NOW);
    expect(line?.detail).toBe("running 12m · 1 more running");
  });

  it("ignores an idle subagent", () => {
    expect(cardNowLine(card({ lastStatus: status, subagents: [implementer({ status: "idle" })] }), NOW)?.kind).toBe("status");
  });

  it("prefers what the card asks of you over a running subagent, naming every other ask in the detail", () => {
    const line = cardNowLine(
      card({
        status: "Awaiting acceptance",
        subagents: [implementer({})],
        owner: { ...owner, pendingPermissions: 2 },
        decisions: [decision({}), decision({ id: "scope-approval", key: "agent-1:scope-approval", question: "Approve the plan?", blocking: true })],
      }),
      NOW,
    );
    expect(line).toMatchObject({ kind: "call", action: "Answer", headline: "Approve the plan?", detail: "Blocking · 1 more question · also ready to accept · also waiting on 2 permissions" });
  });

  it("gives a non-blocking question alone no detail", () => {
    expect(cardNowLine(card({ decisions: [decision({})] }), NOW)).toMatchObject({ headline: "Call it drafts?", detail: null, action: "Answer" });
  });

  it("offers Allow for a permission", () => {
    expect(cardNowLine(card({ owner: { ...owner, pendingPermissions: 1 } }), NOW)).toMatchObject({ headline: "Waiting on a permission", detail: null, action: "Allow" });
  });

  it("puts the whole evidence under Ready to accept", () => {
    const evidence = { checks: [{ command: "npm test", result: "ok" }], review: "self", screenshots: [{ file: "a.png", caption: "", present: true, path: "/tmp/a.png" }], screenshotsNone: null, missing: [], complete: true };
    expect(cardNowLine(card({ status: "Awaiting acceptance", column: "needs-you", evidence }), NOW)).toMatchObject({
      kind: "call",
      action: "Review",
      headline: "Ready to accept",
      detail: "1 check · review · 1 screenshot",
    });
  });

  it("says a delivery with incomplete evidence is not ready, naming what is missing", () => {
    const evidence = { checks: [], review: null, screenshots: [], screenshotsNone: null, missing: ["checks", "review"], complete: false };
    expect(cardNowLine(card({ status: "Awaiting acceptance", column: "needs-you", evidence }), NOW)).toMatchObject({ headline: "Not ready to accept", detail: "Missing: checks, review", action: "Review" });
  });

  it("shows acceptance without an evidence record with no detail", () => {
    expect(cardNowLine(card({ status: "Awaiting acceptance", column: "needs-you" }), NOW)).toMatchObject({ headline: "Ready to accept", detail: null });
  });

  it("says an accepted delivery is merging, with nothing to press (TR-031)", () => {
    const accepted = card({ status: "Awaiting acceptance", accepted: { at: "2026-01-01T11:58:00Z", merging: "into main" }, lastStatus: status });
    expect(cardNowLine(accepted, NOW)).toEqual({ kind: "accepted", headline: "Accepted · merging into main", detail: "2m ago" });
    expect(cardNowLine({ ...accepted, accepted: { at: "2026-01-01T11:58:00Z", merging: null } }, NOW)?.headline).toBe("Accepted · closing the ticket");
  });

  it("still puts a question raised while merging first", () => {
    const accepted = card({ status: "Awaiting acceptance", accepted: { at: "2026-01-01T11:58:00Z", merging: "into main" }, decisions: [decision({})] });
    expect(cardNowLine(accepted, NOW)?.kind).toBe("call");
  });

  it("says where a teammate's owner runs", () => {
    expect(cardNowLine(card({ owner: null, ownerElsewhere: "laptop-b" }), NOW)).toEqual({ kind: "elsewhere", headline: "Owner runs on laptop-b", detail: null });
  });

  it("puts the stalled reason first, even over open decisions", () => {
    const line = cardNowLine(card({ column: "stalled", stalledReason: "Crashed twice within an hour", lastStatus: status, decisions: [decision({})] }), NOW);
    expect(line).toEqual({ kind: "stalled", headline: "Crashed twice within an hour", detail: "5m ago" });
  });

  it("explains a stall without a recorded reason from the owner's state and last words", () => {
    const stalled = (parts: Partial<Card>) => cardNowLine(card({ column: "stalled", ...parts }), NOW);
    expect(stalled({ owner: null })).toEqual({ kind: "stalled", headline: "No owner is running", detail: null });
    expect(stalled({ owner: { ...owner, status: "error" } })).toMatchObject({ headline: "The owner stopped with an error" });
    expect(stalled({ owner: { ...owner, status: "closed" } })).toMatchObject({ headline: "The owner was closed" });
    expect(stalled({ lastStatus: { state: "failed", text: "tests need a database", at: status.at } })).toMatchObject({ headline: "Failed: tests need a database", detail: "5m ago" });
    expect(stalled({ lastStatus: status })).toMatchObject({ headline: "Still idle after a nudge", detail: "Last said: implementer building NA-027.01 · 5m ago" });
    expect(stalled({})).toEqual({ kind: "stalled", headline: "Still idle after a nudge", detail: null });
  });
});

describe("cardFooterParts", () => {
  it("is empty for a bare card", () => {
    expect(cardFooterParts(card({ owner: null }))).toEqual([]);
  });

  it("lists complexity, investigation, context and subagents in order", () => {
    const parts = cardFooterParts(
      card({ complexity: "high", investigation: true, ownerElsewhere: "laptop", owner: { ...owner, contextUsedTokens: 153_400 }, subagents: [implementer({}), implementer({ id: "agent-3" })] }),
    );
    expect(parts).toEqual(["high", "investigation", "context 153k", "2 subagents"]);
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
