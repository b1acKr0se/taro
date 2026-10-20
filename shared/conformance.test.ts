import { describe, expect, it } from "vitest";

import { conformanceViolations } from "./conformance";

const PLAN = `## Goal
Notes can be exported.

## Choices I made
- Front matter is YAML — the usual choice

## What you'll see
- A new export command

## Out of scope
- Importing

## How I'll prove it
- A test per criterion

## Size
Medium: one independent review; about 1 hour.`;

const FINAL = `FINAL 2026-01-05T11:00Z

## What changed
- Notes export to Markdown files

## How it was verified
- Typecheck and tests pass

## Limitations
- None known.

Revision: 0123456789abcdef0123456789abcdef01234567 on work/ab-001 · PR: none (local-only)`;

const NOTES = `OWNER-STARTED 2026-01-05T10:00Z — the plugin set Planning

APPROVAL 2026-01-05T10:05Z — the user: "Approve the plan"

EVIDENCE 2026-01-05T10:50Z — before FINAL
check: npm test — 40 passed
review: one independent round — no findings`;

interface Parts {
  status?: string;
  labels?: string;
  plan?: string;
  notes?: string;
  finalSummary?: string;
}

function ticket(parts: Parts = {}): string {
  return `---
schema: 1
id: "AB-001"
title: "Export notes"
status: "${parts.status ?? "Done"}"
priority: null
labels: [${parts.labels ?? '"complexity-medium"'}]
parent: null
depends_on: []
created: "2026-01-05T10:00:00Z"
updated: "2026-01-05T11:00:00Z"
---

## Description

<!-- taro:description -->
Export my notes.
<!-- /taro:description -->

## Plan

<!-- taro:plan -->
${parts.plan ?? PLAN}
<!-- /taro:plan -->

## Notes

<!-- taro:notes -->
${parts.notes ?? NOTES}
<!-- /taro:notes -->

## Final summary

<!-- taro:final-summary -->
${parts.finalSummary ?? FINAL}
<!-- /taro:final-summary -->
`;
}

const kinds = (text: string, options = {}) => conformanceViolations(text, options).map((violation) => violation.kind);

describe("conformanceViolations", () => {
  it("finds nothing wrong with a clean delivered ticket", () => {
    expect(conformanceViolations(ticket(), { transitions: [{ from: null, to: "Queued", at: "a" }, { from: "Queued", to: "Planning", at: "b" }, { from: "Planning", to: "In Progress", at: "c" }, { from: "In Progress", to: "Awaiting acceptance", at: "d" }, { from: "Awaiting acceptance", to: "Done", at: "e" }] })).toEqual([]);
  });

  it("allows going back to In Progress after changes were requested", () => {
    const transitions = [{ to: "Planning", at: "a" }, { to: "In Progress", at: "b" }, { to: "Awaiting acceptance", at: "c" }, { to: "In Progress", at: "d" }, { to: "Awaiting acceptance", at: "e" }];
    expect(kinds(ticket(), { transitions })).toEqual([]);
  });

  it("flags a status sequence out of order", () => {
    expect(kinds(ticket(), { transitions: [{ to: "Planning", at: "a" }, { to: "In Progress", at: "b" }, { to: "Planning", at: "c" }] })).toEqual(["status-order"]);
  });

  it("flags a build that skipped Planning, unless hands-off", () => {
    const transitions = [{ from: "Queued", to: "In Progress", at: "b" }];
    expect(kinds(ticket(), { transitions })).toEqual(["status-skip"]);
    expect(kinds(ticket(), { transitions, handsOff: true })).toEqual([]);
  });

  it("flags a plan missing a section", () => {
    expect(conformanceViolations(ticket({ plan: PLAN.replace("## Out of scope\n- Importing\n\n", "") }))).toEqual([{ kind: "plan-section-missing", detail: 'the plan has no "Out of scope" section' }]);
  });

  it("flags a plan past a section's bullet limit", () => {
    const plan = PLAN.replace("- Importing", "- Importing\n- Deleting\n- Sync\n- Sharing");
    expect(conformanceViolations(ticket({ plan }))).toEqual([{ kind: "plan-over-limit", detail: '"Out of scope" has 4 (limit 3)' }]);
  });

  it("flags a plan whose sections are out of order", () => {
    const plan = PLAN.replace("## Size\nMedium: one independent review; about 1 hour.", "").replace("## Goal", "## Size\nMedium: one review.\n\n## Goal");
    expect(kinds(ticket({ plan }))).toEqual(["plan-section-order"]);
  });

  it("flags a ticket in progress without a plan", () => {
    expect(kinds(ticket({ plan: "" }))).toEqual(["no-plan"]);
  });

  it("flags a build without an APPROVAL, unless trivial or hands-off", () => {
    const notes = NOTES.replace(/APPROVAL.*\n\n/, "");
    expect(conformanceViolations(ticket({ notes }), { transitions: [{ to: "In Progress", at: "10:06" }] }).map((violation) => violation.detail)).toContain("In Progress at 10:06 with no APPROVAL");
    expect(kinds(ticket({ notes }))).toEqual(["no-approval"]);
    expect(kinds(ticket({ notes }), { handsOff: true })).toEqual([]);
    expect(kinds(ticket({ notes, labels: '"complexity-trivial"', plan: "" }))).toEqual([]);
  });

  it("flags EVIDENCE without a check or a review line", () => {
    expect(kinds(ticket({ notes: NOTES.replace("check: npm test — 40 passed\n", "") }))).toEqual(["evidence-check"]);
    expect(kinds(ticket({ notes: NOTES.replace(/review:.*$/m, "") }))).toEqual(["evidence-review"]);
    expect(kinds(ticket({ notes: NOTES.replace(/EVIDENCE[\s\S]*$/, "") }))).toEqual(["evidence-check"]);
  });

  it("flags a delivered ticket with no FINAL", () => {
    expect(kinds(ticket({ finalSummary: "" }))).toEqual(["no-final"]);
  });

  it("flags a FINAL past its limits or missing a section", () => {
    expect(kinds(ticket({ finalSummary: FINAL.replace("- None known.", "- a\n- b\n- c\n- d") }))).toEqual(["final-over-limit"]);
    expect(kinds(ticket({ finalSummary: FINAL.replace("## Limitations\n- None known.\n", "") }))).toEqual(["final-section-missing"]);
  });

  it("counts the plugin's corrections: DELIVERY-ENDED, NO-PLAN, a held-back note and nudges", () => {
    const notes = `${NOTES}\n\nDELIVERY-ENDED 2026-01-05T10:55Z — the owner asked a question\n\nNO-PLAN 2026-01-05T10:56Z — no plan\n\nNOTE 2026-01-05T10:57Z — the question was held back`;
    expect(conformanceViolations(ticket({ notes }), { nudges: 2 })).toEqual([
      { kind: "plugin-correction", detail: "1 DELIVERY-ENDED record" },
      { kind: "plugin-correction", detail: "1 NO-PLAN record" },
      { kind: "plugin-correction", detail: "1 record saying a question was held back" },
      { kind: "plugin-correction", detail: "2 nudges from the plugin" },
    ]);
  });

  it("does not ask a ticket still in Planning for approval, evidence or a FINAL", () => {
    expect(conformanceViolations(ticket({ status: "Planning", notes: "OWNER-STARTED x", finalSummary: "" }))).toEqual([]);
  });

  it("reports a file that does not parse", () => {
    expect(kinds("not a ticket")).toEqual(["unreadable"]);
  });
});
