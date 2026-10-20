import { describe, expect, it } from "vitest";

import { renderReport, type ResultFile } from "./report.ts";

function result(overrides: Partial<ResultFile> = {}): ResultFile {
  return {
    task: "medium-feature",
    arm: { checkout: "/repo/main", sha: "aaaaaaa1111" },
    models: { owner: "claude/claude-opus-5-5", subagents: ["claude/claude-sonnet-5-5"] },
    stop: "done",
    wallMs: 95 * 60000,
    costUsd: 12.5,
    byRole: { owner: { agents: 1, models: ["claude/claude-opus-5-5"], costUsd: 9, peakContextTokens: 150000, turns: 20, activeMs: 1 }, implementer: { agents: 1, models: [], costUsd: 3.5, peakContextTokens: 60000, turns: 4, activeMs: 1 } },
    hidden: { passed: 12, total: 13 },
    questions: { asked: 4, preferenceHits: 2, redundant: 1 },
    conformance: [{ kind: "no-approval", detail: "x" }, { kind: "plugin-correction", detail: "y" }, { kind: "plugin-correction", detail: "z" }],
    records: { RISKS: 0, RULING: 0, EVIDENCE: 1, FINAL: 1 },
    cardFailures: [],
    ...overrides,
  };
}

describe("renderReport", () => {
  it("puts two arms side by side per task", () => {
    const text = renderReport([result(), result({ arm: { checkout: "/repo/branch", sha: "bbbbbbb2222" }, costUsd: 8, byRole: { owner: { agents: 1, models: [], costUsd: 5, peakContextTokens: 90000, turns: 1, activeMs: 1 } }, hidden: { passed: 13, total: 13 }, conformance: [], cardFailures: [{ kind: "card-text", detail: "undefined" }] })]);
    expect(text).toContain("### medium-feature");
    expect(text).toContain("| | A · aaaaaaa | B · bbbbbbb |");
    expect(text).toContain("| Cost, total | $12.50 | $8.00 |");
    expect(text).toContain("| Cost, owner | $9.00 | $5.00 |");
    expect(text).toContain("| Cost, subagents | $3.50 | $3.00 |");
    expect(text).toContain("| Owner peak context | 150k | 90k |");
    expect(text).toContain("| Wall time | 1h 35m | 1h 35m |");
    expect(text).toContain("| Hidden tests passed | 12/13 | 13/13 |");
    expect(text).toContain("| Questions (preference hits / redundant) | 4 (2 / 1) | 4 (2 / 1) |");
    expect(text).toContain("| Conformance violations | no-approval ×1, plugin-correction ×2 | none |");
    expect(text).toContain("| Card failures | none | card-text ×1 |");
  });

  it("shows dashes for a task one arm did not run", () => {
    const text = renderReport([result(), result({ task: "bug-fix" }), result({ arm: { checkout: "/repo/branch", sha: "bbbbbbb2222" } })]);
    const bugFix = text.slice(text.indexOf("### bug-fix"));
    expect(bugFix).toContain("| Cost, total | $12.50 | — |");
    expect(bugFix).toContain("| Hidden tests passed | 12/13 | — |");
  });

  it("marks a run stopped at the cost cap, and tests not run", () => {
    const text = renderReport([result({ stop: "cost", costUsd: 25.4, hidden: null })]);
    expect(text).toContain("| Cost, total | $25.40 (stopped: cost cap) |");
    expect(text).toContain("| Hidden tests passed | not run |");
  });
});
