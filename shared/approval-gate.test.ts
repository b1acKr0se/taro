import { describe, expect, it } from "vitest";

import { approvalGate, approvedInRound, buildGap, gateRecord, noApprovalRecord, parentTicketId, workApproved } from "./approval-gate";

const answer = (at: string, rest: string) => `ANSWER ${at} — scope-approval: "Approve the plan for NA-12?" → ${rest} (the user, from the Taro screen)`;
const APPROVE = answer("2026-01-05T10:05Z", 'Approve ("Approve the plan for NA-12")');
const CHANGES = answer("2026-01-05T10:03Z", 'Request changes ("drop tags")');
const REOPENED = 'REOPENED 2026-01-06T09:00Z — user: "check the release"; round 2; past owners: none';
const PLAN = "## Goal\nExport notes";

const gap = (notes: string | null, labels: string[] = ["complexity-medium"], plan: string | null = PLAN, parentNotes: string | null = null) =>
  buildGap({ status: "In Progress", plan, criteria: 0, labels, notes, parentNotes });

describe("buildGap", () => {
  it("is no-plan without a plan, whatever the approval", () => {
    expect(gap(null, ["complexity-medium"], null)).toBe("no-plan");
    expect(gap(APPROVE, ["complexity-high"], "  ")).toBe("no-plan");
  });

  it("is no-approval with a plan the user has not answered, or only asked to change", () => {
    expect(gap(null)).toBe("no-approval");
    expect(gap("MILESTONE 2026-01-05T10:00Z — plan written")).toBe("no-approval");
    expect(gap(CHANGES)).toBe("no-approval");
    // A different option on the card, or typed words, is not Approve either.
    expect(gap(answer("2026-01-05T10:05Z", 'Split into children ("Split")'))).toBe("no-approval");
    expect(gap(answer("2026-01-05T10:05Z", '"looks fine I guess"'))).toBe("no-approval");
  });

  it("is nothing once approved by the card's Approve or an APPROVAL record, after changes were asked too", () => {
    expect(gap(APPROVE)).toBeNull();
    expect(gap(`${CHANGES}\n\n${APPROVE}`)).toBeNull();
    expect(gap('APPROVAL 2026-01-05T10:05Z — the user: "approve, but skip the review"')).toBeNull();
  });

  // Review finding: a Request changes answers the surprise a plan was asked again for, not the whole round.
  it("stays approved when a later Request changes answers a plan asked again with a surprise", () => {
    expect(gap(`${APPROVE}\n\n${answer("2026-01-05T12:00Z", 'Request changes ("rename it")')}`)).toBeNull();
  });

  it("is no-approval in a reopened round until that round approves its own plan", () => {
    expect(gap(`${APPROVE}\n\n${REOPENED}`)).toBe("no-approval");
    expect(gap(`${APPROVE}\n\n${REOPENED}\n\n${answer("2026-01-06T09:30Z", 'Approve ("Approve")')}`)).toBeNull();
  });

  it("exempts trivial and low tickets, closed ones, and a child whose parent is approved", () => {
    expect(gap(null, ["complexity-low"], null)).toBeNull();
    expect(gap(null, ["complexity-trivial"])).toBeNull();
    // Raised from low: the low label left on does not exempt it.
    expect(gap(null, ["complexity-low", "complexity-medium"], PLAN)).not.toBeNull();
    expect(buildGap({ status: "Done", plan: PLAN, criteria: 0, labels: [], notes: null })).toBeNull();
    expect(buildGap({ status: "Cancelled", plan: PLAN, criteria: 0, labels: [], notes: null })).toBeNull();
    expect(gap(null, ["complexity-medium"], PLAN, APPROVE)).toBeNull();
    expect(gap(null, ["complexity-medium"], PLAN, CHANGES)).toBe("no-approval");
  });
});

describe("approvedInRound and workApproved", () => {
  it("reads only the round in progress, and a child through its parent", () => {
    expect(approvedInRound(null)).toBe(false);
    expect(approvedInRound(APPROVE)).toBe(true);
    expect(approvedInRound(`${APPROVE}\n\n${REOPENED}`)).toBe(false);
    expect(workApproved(null, APPROVE)).toBe(true);
    expect(workApproved(APPROVE, null)).toBe(true);
    expect(workApproved(null, null)).toBe(false);
  });

  it("stays approved after a surprise re-ask answered Request changes, until the round is reopened", () => {
    const reasked = `${APPROVE}\n\nMILESTONE 2026-01-05T11:00Z — asked scope-approval again with surprise: the import\n\n${answer("2026-01-05T11:30Z", 'Request changes ("keep the import out")')}`;
    expect(approvedInRound(reasked)).toBe(true);
    expect(approvedInRound(`${CHANGES}\n\n${APPROVE}`)).toBe(true);
    expect(approvedInRound(CHANGES)).toBe(false);
    expect(approvedInRound(`${reasked}\n\n${REOPENED}\n\n${CHANGES}`)).toBe(false);
  });

  it("does not take the plugin's APPROVAL-REPEATED record for an approval", () => {
    expect(approvedInRound("APPROVAL-REPEATED 2026-01-05T11:00Z — `scope-approval` asked again")).toBe(false);
  });

  it("finds a child's parent", () => {
    expect(parentTicketId("TR-263.02")).toBe("TR-263");
    expect(parentTicketId("TR-263")).toBeNull();
  });
});

describe("approvalGate", () => {
  const block = (id: string, blocking: boolean, value = "", surprise?: string) => ({ id, blocking, default: value, ...(surprise === undefined ? {} : { surprise }) });

  it("asks everything as written before approval", () => {
    for (const each of [block("scope-approval", true), block("naming", true), block("naming", true, "Export"), block("tone", false)]) expect(approvalGate(each, false)).toBe("ask");
  });

  it("after approval refuses a second plan approval, defaults a blocking question with a default and holds one without", () => {
    expect(approvalGate(block("scope-approval", true), true)).toBe("refuse");
    expect(approvalGate(block("scope-approval", false), true)).toBe("refuse");
    expect(approvalGate(block("naming", true, "Export"), true)).toBe("default");
    expect(approvalGate(block("naming", true, "   "), true)).toBe("hold");
    expect(approvalGate(block("tone", false), true)).toBe("ask");
    expect(approvalGate(block("investigation-done", true), true)).toBe("ask");
  });

  it("asks anything that names its surprise, but not a blank one", () => {
    expect(approvalGate(block("scope-approval", true, "", "criterion 2 changes"), true)).toBe("ask");
    expect(approvalGate(block("naming", true, "", "Out of scope: no import"), true)).toBe("ask");
    expect(approvalGate(block("naming", true, "", "  "), true)).toBe("hold");
  });
});

describe("records", () => {
  it("say what the gate did", () => {
    expect(noApprovalRecord("2026-01-05T10:00Z", 1, "taro/na-12", "main")).toBe(
      "NO-APPROVAL 2026-01-05T10:00Z — 1 commit on taro/na-12 past main with the plan not approved this round: the owner was told to stop and ask scope-approval",
    );
    expect(gateRecord("T", "refuse", { id: "scope-approval", default: "" })).toBe("APPROVAL-REPEATED T — `scope-approval` asked again after the plan was approved, with no surprise: not shown; the owner was told to build on");
    expect(gateRecord("T", "default", { id: "naming", default: " Export " })).toBe('BLOCKING-AFTER-APPROVAL T — `naming` asked blocking after approval, with no surprise: shown not blocking, the owner going on with "Export"');
    expect(gateRecord("T", "hold", { id: "naming", default: "" })).toBe("BLOCKING-AFTER-APPROVAL T — `naming` asked blocking after approval, with no surprise and no default: not shown");
    expect(gateRecord("T", "ask", { id: "naming", default: "" })).toBeNull();
  });
});
