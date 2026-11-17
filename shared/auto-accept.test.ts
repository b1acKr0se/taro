import { describe, expect, it } from "vitest";

import { acceptedAutomatically, accepterText, autoAcceptBlock, autoAcceptedAcceptance, autoAcceptHoldRecord, autoAcceptRecord, holdListText, parseHoldList, type AutoAcceptTicket } from "./auto-accept";

const HEAD = "a".repeat(40);
const delivered = `EXECUTION 2026-11-01T10:00Z — owner x, review-head: ${HEAD}, pr: https://github.com/o/r/pull/1\n\nEVIDENCE 2026-11-01T09:00Z — checks\ncheck: npm test — green`;
const review = (blockers: string) => `REVIEW 2026-11-01T09:30Z — independent round, every finding answered\n${blockers}\nverdict: clean`;

function ticket(overrides: Partial<AutoAcceptTicket> = {}): AutoAcceptTicket {
  return {
    status: "Awaiting acceptance",
    labels: ["complexity-low"],
    notes: delivered,
    finalSummary: "What changed: a thing.",
    config: { acceptAlsoMerges: true, delivery: "pull-request" },
    evidenceMissing: [],
    ownerStatus: "idle",
    decisionOpen: false,
    ...overrides,
  };
}

describe("autoAcceptBlock", () => {
  it("takes a complete low ticket with no review record", () => {
    expect(autoAcceptBlock(ticket())).toBeNull();
  });

  it("takes one whose newest review says no blocker is open", () => {
    expect(autoAcceptBlock(ticket({ labels: ["complexity-medium"], notes: `${review("blockers-open: 0")}\n\n${delivered}` }))).toBeNull();
  });

  it("leaves a ticket that is not awaiting acceptance", () => {
    expect(autoAcceptBlock(ticket({ status: "In Progress" }))).toMatch(/not awaiting acceptance/);
  });

  it.each([
    ["no live owner", { ownerStatus: null }, /no live owner/],
    ["an owner still delivering", { ownerStatus: "running" }, /still delivering/],
    ["incomplete evidence", { evidenceMissing: ["a ux line"] }, /evidence is missing a ux line/],
    ["no FINAL", { finalSummary: null }, /no FINAL/],
    ["a blank FINAL", { finalSummary: "  \n" }, /no FINAL/],
    ["an open question", { decisionOpen: true }, /question or plan approval/],
    ["no review head", { notes: "EVIDENCE 2026-11-01T09:00Z — checks" }, /no review-head/],
  ] as const)("leaves a ticket with %s", (_name, change, reason) => {
    expect(autoAcceptBlock(ticket(change))).toMatch(reason);
  });

  it("needs the PR url on pull-request delivery but not on a local branch", () => {
    const noUrl = `EXECUTION 2026-11-01T10:00Z — review-head: ${HEAD}\n\nEVIDENCE 2026-11-01T09:00Z — checks`;
    expect(autoAcceptBlock(ticket({ notes: noUrl }))).toMatch(/no PR URL/);
    expect(autoAcceptBlock(ticket({ notes: noUrl, config: { acceptAlsoMerges: true, delivery: "local-only" } }))).toBeNull();
  });

  it("leaves a ticket whose newest review leaves a blocker open", () => {
    expect(autoAcceptBlock(ticket({ notes: `${delivered}\n\n${review("blockers-open: 2")}` }))).toMatch(/leaves 2 blockers open/);
    expect(autoAcceptBlock(ticket({ notes: `${delivered}\n\n${review("blockers-open: 1")}` }))).toMatch(/leaves 1 blocker open/);
  });

  it("lets a later clean review supersede an earlier one with blockers", () => {
    expect(autoAcceptBlock(ticket({ notes: `${review("blockers-open: 3")}\n\n${review("blockers-open: 0")}\n\n${delivered}` }))).toBeNull();
  });

  it("leaves a review that does not say whether blockers are open", () => {
    expect(autoAcceptBlock(ticket({ notes: `${delivered}\n\n${review("")}` }))).toMatch(/does not say/);
  });

  it("leaves a medium or high ticket that has no review record, not a trivial one", () => {
    expect(autoAcceptBlock(ticket({ labels: ["complexity-medium"] }))).toMatch(/no REVIEW/);
    expect(autoAcceptBlock(ticket({ labels: ["complexity-high"] }))).toMatch(/no REVIEW/);
    expect(autoAcceptBlock(ticket({ labels: ["complexity-trivial"] }))).toBeNull();
  });

  it("does not take a ticket whose Accept already ran, but takes it again once re-delivered", () => {
    const accepted = `${delivered}\n\nACCEPTED 2026-11-01T11:00Z — the user accepted; merging: the pull request`;
    expect(autoAcceptBlock(ticket({ notes: accepted }))).toMatch(/Accept is already under way/);
    const handedOff = `${delivered}\n\nAUTO-ACCEPT 2026-11-01T11:00Z — auto-accept was on\n\nACCEPT-HANDOFF 2026-11-01T11:01Z — a conflict`;
    expect(autoAcceptBlock(ticket({ notes: handedOff }))).toMatch(/already ran/);
    const redelivered = `${handedOff}\n\nEVIDENCE 2026-11-01T12:00Z — checks again\n\nEXECUTION 2026-11-01T12:05Z — review-head: ${"b".repeat(40)}`;
    expect(autoAcceptBlock(ticket({ notes: redelivered }))).toBeNull();
  });

  it("does not treat a hold note as a spent Accept", () => {
    expect(autoAcceptBlock(ticket({ notes: `${delivered}\n\n${autoAcceptHoldRecord("2026-11-01T10:30Z")}` }))).toBeNull();
  });

  it("does not take a ticket after a merge that failed", () => {
    expect(autoAcceptBlock(ticket({ notes: `${delivered}\n\nNOT-MERGED 2026-11-01T11:00Z — conflict` }))).toMatch(/already ran|under way/);
  });

  it("an investigation needs no delivery record", () => {
    expect(autoAcceptBlock(ticket({ labels: ["investigation"], notes: "EVIDENCE 2026-11-01T09:00Z — checks" }))).toBeNull();
  });
});

describe("parseHoldList", () => {
  it("reads ids one per line or comma-separated, upper-case and once each", () => {
    expect(parseHoldList("tr-12\nTR-13, tr-12;TR-014.02")).toEqual({ ids: ["TR-12", "TR-13", "TR-014.02"], invalid: [] });
  });

  it("returns what is no ticket id", () => {
    expect(parseHoldList("TR-12 banana 12")).toEqual({ ids: ["TR-12"], invalid: ["banana", "12"] });
  });

  it("an empty box holds nothing", () => {
    expect(parseHoldList("  \n ,")).toEqual({ ids: [], invalid: [] });
  });

  it("round-trips through the box's text", () => {
    expect(parseHoldList(holdListText(["TR-1", "TR-2"])).ids).toEqual(["TR-1", "TR-2"]);
  });
});

describe("records", () => {
  it("say the switch was on, with the time", () => {
    expect(autoAcceptRecord("2026-11-01T10:00Z")).toBe("AUTO-ACCEPT 2026-11-01T10:00Z — auto-accept was on");
    expect(autoAcceptHoldRecord("2026-11-01T10:00Z")).toMatch(/^AUTO-ACCEPT-HOLD 2026-11-01T10:00Z — held by the user/);
  });
});

describe("who accepted", () => {
  const acceptance = 'ACCEPTANCE t — user: "I accept TR-1." Accepted abc; merge: merged a → b';
  it("tells an automatic ACCEPTED record from the user's", () => {
    expect(acceptedAutomatically("ACCEPTED 2026-11-01T10:00Z — auto-accept was on; merging: into main")).toBe(true);
    expect(acceptedAutomatically("ACCEPTED 2026-11-01T10:00Z — the user accepted; merging: into main")).toBe(false);
    expect(acceptedAutomatically(null)).toBe(false);
    expect(acceptedAutomatically("ACCEPTED 2026-11-01T10:00Z — auto-accept was on; merging: x\n\nACCEPTED 2026-11-02T10:00Z — the user accepted; merging: x")).toBe(false);
  });
  it("puts the switch in the ACCEPTANCE record where the user's quoted words were", () => {
    expect(autoAcceptedAcceptance(acceptance, "TR-1")).toBe("ACCEPTANCE t — auto-accept was on: Accepted abc; merge: merged a → b");
    expect(autoAcceptedAcceptance(acceptance, "TR-2")).toBe(acceptance);
  });
  it("names the accepter for the owner a merge is handed to", () => {
    expect(accepterText("ACCEPTED 2026-11-01T10:00Z — auto-accept was on; merging: x")).toContain("auto-accept");
    expect(accepterText("ACCEPTED 2026-11-01T10:00Z — the user accepted; merging: x")).toBe("by the user");
  });
});
