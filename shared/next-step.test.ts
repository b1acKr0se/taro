import { describe, expect, it } from "vitest";

import { buildOrder, nextStep, reviewClean, stepKey, ticketLevel, type StepTicket } from "./next-step";

// Records as owners and the plugin write them (skill/reference/tickets.md).
const EXECUTION = "EXECUTION 2026-11-01T10:00Z — owner a1 (claude/sonnet), workspace wks_1, worktree /home/user/wt, branch taro/sh-12";
const ASKED = 'ANSWER 2026-11-01T10:20:00.000Z — scope-approval: "Approve the plan for SH-12?" → Request changes ("split the export") (the user, from the Taro screen)';
const APPROVED = 'ANSWER 2026-11-01T10:30:00.000Z — scope-approval: "Approve the plan for SH-12?" → Approve ("Approve the plan for SH-12") (the user, from the Taro screen)';
const APPROVAL = 'APPROVAL 2026-11-01T10:30Z — user: "Approve the plan for SH-12"';
const REVIEW_FINDINGS = "REVIEW 2026-11-01T12:00Z — reviewer r1 over main..taro/sh-12: 1 blocker, fixed in 3f2a1b0 — verdict: findings";
const REVIEW_CLEAN = "REVIEW 2026-11-01T12:30Z — fix check by r1 of 3f2a1b0..HEAD: pass — verdict: clean";
const REOPENED = 'REOPENED 2026-11-02T09:00Z — user: "check it on staging"; round 2; past owners: a1';
const HANDOFF = "ACCEPT-HANDOFF 2026-11-01T13:00Z — owner a1: the head moved since review";

function ticket(overrides: Partial<StepTicket> = {}): StepTicket {
  return { id: "SH-12", status: "Planning", labels: ["complexity-medium"], notes: EXECUTION, children: [], baseBranch: "main", deliveryGaps: [], ...overrides };
}

const notes = (...records: string[]) => records.join("\n\n");

describe("the level page", () => {
  it("is nothing while the ticket has no level label", () => {
    expect(nextStep(ticket({ labels: [] }))).toBeNull();
    expect(nextStep(ticket({ labels: ["investigation"], notes: notes(EXECUTION, APPROVAL) }))).toBeNull();
  });

  it("is light for trivial and low, and the level's own page above", () => {
    expect(nextStep(ticket({ labels: ["complexity-trivial"] }))?.page).toBe("levels/light.md");
    expect(nextStep(ticket({ labels: ["complexity-low"] }))?.page).toBe("levels/light.md");
    expect(nextStep(ticket({ labels: ["complexity-medium"] }))).toEqual({ page: "levels/medium.md", facts: { ticket: "SH-12", level: "medium", round: "1" } });
    expect(nextStep(ticket({ labels: ["complexity-high"] }))?.page).toBe("levels/high.md");
  });

  it("takes the highest of several labels", () => {
    expect(ticketLevel(["complexity-low", "complexity-high"])).toBe("high");
    expect(nextStep(ticket({ labels: ["complexity-low", "complexity-medium"] }))?.page).toBe("levels/medium.md");
  });

  it("stays while the plan is only asked or changes are requested", () => {
    expect(nextStep(ticket({ notes: notes(EXECUTION, ASKED) }))?.page).toBe("levels/medium.md");
  });

  it("stays for a light ticket however far it goes, until its review is clean", () => {
    expect(nextStep(ticket({ labels: ["complexity-low"], status: "Reviewing", notes: notes(EXECUTION, APPROVAL) }))?.page).toBe("levels/light.md");
  });
});

describe("the build page", () => {
  it("comes with the round's approval, an Approve answer or an APPROVAL record", () => {
    expect(nextStep(ticket({ status: "In Progress", notes: notes(EXECUTION, APPROVED) }))?.page).toBe("phases/build.md");
    expect(nextStep(ticket({ status: "In Progress", notes: notes(EXECUTION, APPROVAL) }))?.page).toBe("phases/build.md");
  });

  it("comes for a child whose parent's plan is approved", () => {
    expect(nextStep(ticket({ id: "SH-12.01", notes: EXECUTION, parentNotes: notes(EXECUTION, APPROVAL) }))?.page).toBe("phases/build.md");
  });

  it("lists a high ticket's children in build order, each after what it depends on", () => {
    const step = nextStep(
      ticket({
        labels: ["complexity-high"],
        notes: notes(EXECUTION, APPROVAL),
        children: [
          { id: "SH-12.03", title: "Docs", status: "Queued", dependencies: ["SH-12.01"] },
          { id: "SH-12.01", title: "Export button", status: "Queued", dependencies: ["SH-12.02"] },
          { id: "SH-12.02", title: "CSV writer", status: "Done", dependencies: [] },
        ],
      }),
    );
    expect(step?.page).toBe("phases/build.md");
    expect(step?.facts.children).toBe("1. SH-12.02 — CSV writer (Done)\n2. SH-12.01 — Export button (Queued)\n3. SH-12.03 — Docs (Queued)");
  });

  it("says so when the ticket has no children", () => {
    expect(nextStep(ticket({ notes: notes(EXECUTION, APPROVAL) }))?.facts.children).toMatch(/^none/);
  });
});

describe("build order", () => {
  it("never loses a child to a dependency cycle", () => {
    const cycle = buildOrder([
      { id: "SH-1.02", title: "b", status: "Queued", dependencies: ["SH-1.01"] },
      { id: "SH-1.01", title: "a", status: "Queued", dependencies: ["SH-1.02"] },
    ]);
    expect(cycle.map((child) => child.id)).toEqual(["SH-1.01", "SH-1.02"]);
  });

  it("orders ids by number, so .10 comes after .9", () => {
    const ordered = buildOrder([
      { id: "SH-1.10", title: "j", status: "Queued", dependencies: [] },
      { id: "SH-1.9", title: "i", status: "Queued", dependencies: [] },
    ]);
    expect(ordered.map((child) => child.id)).toEqual(["SH-1.9", "SH-1.10"]);
  });
});

describe("the review page", () => {
  it("comes when the ticket is set Reviewing, with the range from the base to the recorded branch", () => {
    const step = nextStep(ticket({ status: "Reviewing", notes: notes(EXECUTION, APPROVAL) }));
    expect(step).toEqual({ page: "phases/review.md", facts: { ticket: "SH-12", level: "medium", round: "1", range: "main..taro/sh-12" } });
  });

  it("comes when every child is Done (a cancelled one aside)", () => {
    const children = [
      { id: "SH-12.01", title: "a", status: "Done", dependencies: [] },
      { id: "SH-12.02", title: "b", status: "Cancelled", dependencies: [] },
    ];
    expect(nextStep(ticket({ labels: ["complexity-high"], status: "In Progress", notes: notes(EXECUTION, APPROVAL), children }))?.page).toBe("phases/review.md");
    const building = [children[0]!, { id: "SH-12.02", title: "b", status: "In Progress", dependencies: [] }];
    expect(nextStep(ticket({ labels: ["complexity-high"], status: "In Progress", notes: notes(EXECUTION, APPROVAL), children: building }))?.page).toBe("phases/build.md");
  });

  it("stays while the newest review has findings", () => {
    expect(nextStep(ticket({ status: "Reviewing", notes: notes(EXECUTION, APPROVAL, REVIEW_FINDINGS) }))?.page).toBe("phases/review.md");
  });

  it("names the round's branch when no EXECUTION record gives one", () => {
    expect(nextStep(ticket({ status: "Reviewing", notes: APPROVAL }))?.facts.range).toBe("main..taro/sh-12");
  });
});

describe("the delivery page", () => {
  it("comes when the round's newest REVIEW ends verdict: clean, listing what the delivery lacks", () => {
    const step = nextStep(ticket({ status: "Reviewing", notes: notes(EXECUTION, APPROVAL, REVIEW_FINDINGS, REVIEW_CLEAN), deliveryGaps: ["the ticket records no review-head", "the ticket records no PR URL"] }));
    expect(step?.page).toBe("phases/delivery.md");
    expect(step?.facts.missing).toBe("- the ticket records no review-head\n- the ticket records no PR URL");
  });

  it("comes for a light ticket's clean self-review too", () => {
    const self = "REVIEW 2026-11-01T11:00Z — self-review of main..taro/sh-12: diff reread, tests run — verdict: clean";
    expect(nextStep(ticket({ labels: ["complexity-trivial"], status: "In Progress", notes: notes(EXECUTION, self) }))?.page).toBe("phases/delivery.md");
  });

  it("is not brought by a clean plan review recorded before the approval", () => {
    const planReview = "REVIEW 2026-11-01T09:00Z — plan review by r1: interfaces agree — verdict: clean";
    expect(reviewClean(notes(planReview))).toBe(false);
    expect(nextStep(ticket({ status: "Planning", notes: notes(planReview) }))?.page).not.toBe("phases/delivery.md");
    expect(reviewClean(notes(planReview, REVIEW_CLEAN))).toBe(true);
  });

  it("is not brought back by an older clean review once a newer one has findings", () => {
    expect(reviewClean(notes(REVIEW_CLEAN, REVIEW_FINDINGS))).toBe(false);
  });

  it("is what Awaiting acceptance still needs, and nothing once it is complete", () => {
    expect(nextStep(ticket({ status: "Awaiting acceptance", notes: notes(EXECUTION, REVIEW_CLEAN), deliveryGaps: ["EVIDENCE: no ux: line"] }))?.page).toBe("phases/delivery.md");
    expect(nextStep(ticket({ status: "Awaiting acceptance", notes: notes(EXECUTION, REVIEW_CLEAN) }))).toBeNull();
  });
});

describe("the accept page", () => {
  it("comes only while the plugin has handed Accept to the owner", () => {
    expect(nextStep(ticket({ status: "Awaiting acceptance", notes: notes(EXECUTION, REVIEW_CLEAN, HANDOFF) }))?.page).toBe("phases/accept.md");
  });

  it("is nothing on a closed ticket", () => {
    expect(nextStep(ticket({ status: "Done", notes: notes(EXECUTION, HANDOFF) }))).toBeNull();
    expect(nextStep(ticket({ status: "Cancelled" }))).toBeNull();
  });
});

describe("a reopened round", () => {
  const delivered = notes(EXECUTION, APPROVAL, REVIEW_CLEAN, "FINAL 2026-11-01T13:00Z", REOPENED);

  it("starts again at the light page, whatever the first round was rated: a reopened round is low, an investigation", () => {
    const step = nextStep(ticket({ status: "Planning", notes: delivered }));
    expect(step).toEqual({ page: "levels/light.md", facts: { ticket: "SH-12", level: "medium, and this reopened round is worked as low", round: "2" } });
    expect(nextStep(ticket({ labels: ["complexity-high"], notes: delivered }))?.page).toBe("levels/light.md");
  });

  it("is checked by its owner, not sent to an independent review, and its clean check brings the delivery", () => {
    const reviewing = ticket({ status: "Reviewing", notes: notes(delivered, 'APPROVAL 2026-11-02T09:30Z — user: "Approve"') });
    expect(nextStep(reviewing)?.page).toBe("levels/light.md");
    const checked = nextStep({ ...reviewing, notes: notes(delivered, "REVIEW 2026-11-02T10:00Z — self-check on staging: holds — verdict: clean") });
    expect(checked?.page).toBe("phases/delivery.md");
    expect(checked?.facts.round).toBe("2");
  });

  it("is remembered apart from the first round's pages", () => {
    const first = nextStep(ticket({ labels: ["complexity-low"] }))!;
    const second = nextStep(ticket({ notes: delivered }))!;
    expect(first.page).toBe(second.page);
    expect(stepKey("SH-12", first)).not.toBe(stepKey("SH-12", second));
  });
});
