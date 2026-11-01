import { describe, expect, it } from "vitest";

import { mayBuildBeforePlan, lacksPlan, noPlanRecord } from "./no-plan";

describe("lacksPlan", () => {
  it("finds no plan on a ticket in any status before Done, an empty or blank plan included", () => {
    for (const status of ["Queued", "Planning", "Ready", "In Progress", "Reviewing", "Awaiting acceptance", "Blocked"]) {
      expect(lacksPlan({ status, plan: null, criteria: 0, labels: [] })).toBe(true);
    }
    expect(lacksPlan({ status: "In Progress", plan: "", criteria: 0, labels: [] })).toBe(true);
    expect(lacksPlan({ status: "In Progress", plan: "  \n", criteria: 0, labels: [] })).toBe(true);
  });

  it("leaves a ticket with a plan, however short, and a closed ticket alone", () => {
    expect(lacksPlan({ status: "In Progress", plan: "## Goal\nFix the typo", criteria: 0, labels: [] })).toBe(false);
    expect(lacksPlan({ status: "Done", plan: null, criteria: 0, labels: [] })).toBe(false);
    expect(lacksPlan({ status: "Cancelled", plan: null, criteria: 0, labels: [] })).toBe(false);
  });

  it("counts an older ticket's acceptance-criteria checklist as its plan", () => {
    expect(lacksPlan({ status: "In Progress", plan: null, criteria: 3, labels: [] })).toBe(false);
  });
});

describe("a trivial or low ticket (TR-241)", () => {
  it("may build before it plans, at any status", () => {
    for (const label of ["complexity-trivial", "complexity-low"]) {
      for (const status of ["Planning", "In Progress", "Reviewing", "Awaiting acceptance"]) {
        expect(lacksPlan({ status, plan: null, criteria: 0, labels: [label] })).toBe(false);
      }
    }
  });

  it("still lacks a plan at medium and high", () => {
    for (const level of ["medium", "high"]) {
      expect(lacksPlan({ status: "In Progress", plan: null, criteria: 0, labels: [`complexity-${level}`] })).toBe(true);
    }
    expect(mayBuildBeforePlan(["bug", "complexity-trivial"])).toBe(true);
    expect(mayBuildBeforePlan(["complexity-low"])).toBe(true);
    expect(mayBuildBeforePlan(["complexity-medium"])).toBe(false);
  });
});

describe("noPlanRecord", () => {
  it("names the commits, the branch and the base", () => {
    expect(noPlanRecord("2026-01-05T10:00:00.000Z", 1, "taro/sh-12", "main")).toBe(
      "NO-PLAN 2026-01-05T10:00:00.000Z — 1 commit on taro/sh-12 past main with no plan on the ticket: the owner was told to stop and write it",
    );
    expect(noPlanRecord("2026-01-05T10:00:00.000Z", 3, "taro/sh-12", "main")).toContain("3 commits on taro/sh-12");
  });
});
