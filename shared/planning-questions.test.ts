import { describe, expect, it } from "vitest";

import { asPlanningQuestion, asStored, planningTicket } from "./planning-questions";

const approval = "MILESTONE 2026-10-16T02:40Z — plan written\nAPPROVAL 2026-10-16T02:45Z — user picked Approve (decision scope-approval)";

describe("planningTicket (TR-146)", () => {
  it("is planning while Queued or Planning without an APPROVAL record", () => {
    expect(planningTicket({ status: "Queued", notes: null })).toBe(true);
    expect(planningTicket({ status: "Planning", notes: "" })).toBe(true);
    expect(planningTicket({ status: "Planning", notes: "MILESTONE 2026-10-16T02:40Z — plan written" })).toBe(true);
  });

  it("is not once the plan is approved, whatever the status", () => {
    expect(planningTicket({ status: "Planning", notes: approval })).toBe(false);
    expect(planningTicket({ status: "Queued", notes: approval })).toBe(false);
  });

  it("is not after planning, even without an APPROVAL (a trivial ticket goes straight to In Progress)", () => {
    for (const status of ["Ready", "In Progress", "Reviewing", "Awaiting acceptance", "Done", "Blocked", "Cancelled"]) {
      expect(planningTicket({ status, notes: null })).toBe(false);
    }
  });

  it("does not take a word in a record's text for an APPROVAL record", () => {
    expect(planningTicket({ status: "Planning", notes: "MILESTONE 2026-10-16T02:40Z — asking for APPROVAL next" })).toBe(true);
  });
});

describe("asPlanningQuestion", () => {
  it("makes a non-blocking question blocking while planning, and marks it", () => {
    expect(asPlanningQuestion({ id: "a", blocking: false }, true)).toEqual({ id: "a", blocking: true, madeBlocking: true });
  });

  it("leaves a blocking question, and any question after planning, as asked", () => {
    expect(asPlanningQuestion({ id: "a", blocking: true }, true)).toEqual({ id: "a", blocking: true });
    expect(asPlanningQuestion({ id: "a", blocking: false }, false)).toEqual({ id: "a", blocking: false });
  });
});

describe("asStored", () => {
  it("reads the agent's block as blocking only when its stored decision was made so", () => {
    expect(asStored({ blocking: false }, { madeBlocking: true })).toEqual({ blocking: true });
    expect(asStored({ blocking: false }, {})).toEqual({ blocking: false });
    expect(asStored({ blocking: false }, { madeBlocking: undefined })).toEqual({ blocking: false });
  });
});
