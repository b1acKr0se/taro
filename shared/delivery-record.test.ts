import { describe, expect, it } from "vitest";

import { deliveryRecorded, evidenceFromChecks, planDelivery, revisionLine, withRevisionLine, type DeliveryInput } from "./delivery-record";

const HEAD = "c".repeat(40);
const PR = "https://github.com/example/notes-app/pull/7";
const FINAL = "## What changed\n- The export works.\n\nRevision: <full SHA> on <branch> · PR: <URL>";
const EVIDENCE = "EVIDENCE 2026-11-12T07:00Z — verified\ncheck: npm test — 12 passed\nreview: clean, reviewer abc\nscreenshots: none — no visible change";

function input(overrides: Partial<DeliveryInput> = {}, ticket: Partial<DeliveryInput["ticket"]> = {}): DeliveryInput {
  return {
    ticket: { id: "NA-7", status: "In Progress", labels: [], notes: `EXECUTION 2026-11-12T06:00Z — owner x, branch taro/na-7\n\n${EVIDENCE}`, finalSummary: FINAL, ...ticket },
    config: { delivery: "pull-request", acceptAlsoMerges: true },
    facts: { head: HEAD, branch: "taro/na-7", pullRequest: PR },
    problems: [],
    checkLines: null,
    evidenceFiles: new Set(),
    at: "2026-11-12T08:00Z",
    ...overrides,
  };
}

describe("the revision line", () => {
  it("is replaced where FINAL has one and added where it has none", () => {
    const line = revisionLine({ head: HEAD, branch: "taro/na-7", pullRequest: null });
    expect(line).toBe(`Revision: ${HEAD} on taro/na-7 · PR: none (local-only)`);
    expect(withRevisionLine(FINAL, line)).toBe(`## What changed\n- The export works.\n\n${line}`);
    expect(withRevisionLine("## What changed\n- x\n", line)).toBe(`## What changed\n- x\n\n${line}`);
  });
});

describe("planDelivery", () => {
  it("records the head and PR, fills the revision line and moves to Awaiting acceptance", () => {
    const plan = planDelivery(input());
    expect(plan.missing).toEqual([]);
    expect(plan.appendNotes).toEqual([`EXECUTION 2026-11-12T08:00Z — delivered with taro deliver: pr: ${PR}; review-head: ${HEAD}`]);
    expect(plan.finalSummary).toContain(`Revision: ${HEAD} on taro/na-7 · PR: ${PR}`);
    expect(plan.setStatus).toBe(true);
  });

  it("adds nothing when the round already records the same head and PR", () => {
    const notes = `${input().ticket.notes}\n\nEXECUTION 2026-11-12T08:00Z — delivered with taro deliver: pr: ${PR}; review-head: ${HEAD}`;
    const final = withRevisionLine(FINAL, revisionLine(input().facts!));
    expect(deliveryRecorded(notes, final, input().facts!)).toBe(true);
    const plan = planDelivery(input({}, { notes, finalSummary: final, status: "Awaiting acceptance" }));
    expect(plan).toEqual({ missing: [], appendNotes: [], finalSummary: null, setStatus: false });
  });

  it("lists what Accept would refuse: evidence, the PR, the FINAL summary", () => {
    const plan = planDelivery(input({ facts: { head: HEAD, branch: "taro/na-7", pullRequest: null }, problems: ["a pull request for taro/na-7"] }, { notes: "", finalSummary: "" }));
    expect(plan.missing).toEqual([
      "a pull request for taro/na-7",
      "an EVIDENCE record",
      "the ticket records no PR URL",
      "the FINAL summary: write it with taro ticket edit NA-7 --final-summary (templates/final.md), then deliver again",
    ]);
  });

  it("asks an investigation only for a check and its FINAL", () => {
    const investigation = input({ facts: null }, { labels: ["investigation"], notes: "EVIDENCE 2026-11-12T07:00Z — read\ncheck: reading the code — found three gaps" });
    expect(planDelivery(investigation)).toMatchObject({ missing: [], appendNotes: [], finalSummary: null, setStatus: true });
  });

  it("builds EVIDENCE from the check log, carrying the other lines of the newest record", () => {
    const plan = planDelivery(input({ checkLines: ["check: npm test — exit 0; Tests 14 passed", "check: npm run typecheck — exit 0"] }));
    expect(plan.appendNotes[1]).toBe(
      [
        "EVIDENCE 2026-11-12T08:00Z — check lines from the check log (taro check); the other lines carried from the record before",
        "check: npm test — exit 0; Tests 14 passed",
        "check: npm run typecheck — exit 0",
        "review: clean, reviewer abc",
        "screenshots: none — no visible change",
      ].join("\n"),
    );
    expect(plan.missing).toEqual([]);
  });

  it("writes no EVIDENCE that says what the newest one says", () => {
    expect(evidenceFromChecks(EVIDENCE, "2026-11-12T08:00Z", ["check: npm test — 12 passed"])).toBeNull();
  });
});
