import { describe, expect, it } from "vitest";

import { renderReport, renderSpread, type ResultFile } from "./report.ts";
import { scoreCards } from "./score.ts";

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
    ownerPeakContextTokens: 150000,
    ...overrides,
  };
}

describe("renderReport", () => {
  it("puts two arms side by side per task", () => {
    const text = renderReport([result(), result({ arm: { checkout: "/repo/branch", sha: "bbbbbbb2222" }, costUsd: 8, byRole: { owner: { agents: 1, models: [], costUsd: 5, peakContextTokens: 90000, turns: 1, activeMs: 1 } }, ownerPeakContextTokens: 90000, hidden: { passed: 13, total: 13 }, conformance: [], cardFailures: [{ kind: "card-text", detail: "undefined" }] })]);
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

  it("shows the owner's real peak context, and a dash when the transcript was not found", () => {
    const text = renderReport([result({ ownerPeakContextTokens: 210_000 }), result({ arm: { checkout: "/repo/branch", sha: "bbbbbbb2222" }, ownerPeakContextTokens: null })]);
    expect(text).toContain("| Owner peak context | 210k | — |");
  });

  it("prints models and caps, and warns when the arms differ", () => {
    const same = renderReport([result({ caps: { maxMinutes: 90, maxUsd: 25 } }), result({ arm: { checkout: "/repo/branch", sha: "bbbbbbb2222" }, caps: { maxMinutes: 90, maxUsd: 25 } })]);
    expect(same).toContain("| Models | owner claude/claude-opus-5-5; subagents claude/claude-sonnet-5-5 | owner claude/claude-opus-5-5; subagents claude/claude-sonnet-5-5 |");
    expect(same).toContain("| Caps | 90 min, $25.00 | 90 min, $25.00 |");
    expect(same).not.toContain("Warning");
    const differ = renderReport([result({ caps: { maxMinutes: 90, maxUsd: 25 } }), result({ arm: { checkout: "/repo/branch", sha: "bbbbbbb2222" }, caps: { maxMinutes: 60, maxUsd: 10 }, models: { owner: "claude/claude-sonnet-5-5", subagents: [] } })]);
    expect(differ).toContain("Warning: medium-feature: the arms differ in models, caps");
  });

  it("shows unknown caps for an older result, without a warning for one arm", () => {
    const text = renderReport([result()]);
    expect(text).toContain("| Caps | unknown |");
    expect(text).not.toContain("Warning");
  });

  it("keeps the owner's context at the end beside the peak, so an old result still shows one", () => {
    const old = result({ arm: { checkout: "/repo/old", sha: "ccccccc3333" } });
    delete old.ownerPeakContextTokens;
    delete old.caps;
    const text = renderReport([old, result({ ownerPeakContextTokens: 210_000, caps: { maxMinutes: 90, maxUsd: 25 } })]);
    expect(text).toContain("| Owner context at end | 150k | 150k |");
    expect(text).toContain("| Owner peak context | — | 210k |");
    expect(text).toContain("| Caps | unknown | 90 min, $25.00 |");
  });

  it("treats unknown caps as unknown, never as a difference", () => {
    const old = result({ arm: { checkout: "/repo/old", sha: "ccccccc3333" } });
    const text = renderReport([old, result({ caps: { maxMinutes: 90, maxUsd: 25 } })]);
    expect(text).not.toContain("Warning");
  });

  it("treats two copies of the same commit as one arm", () => {
    const text = renderReport([result(), result({ task: "bug-fix", arm: { checkout: "/tmp/another-copy", sha: "aaaaaaa1111" } })]);
    expect(text).toContain("| | A · aaaaaaa |");
    expect(text).not.toContain("B ·");
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

  it("prints how the decider answered, ui for a result from before it was recorded", () => {
    const text = renderReport([result({ decider: "rpc" }), result({ arm: { checkout: "/repo/branch", sha: "bbbbbbb2222" } })]);
    expect(text).toContain("| Decider | rpc | ui |");
  });

  it("ignores the planted score a result carries", () => {
    expect(renderReport([result({ planted: { caught: 5, total: 8 } })])).toBe(renderReport([result()]));
  });
});

const branch = { checkout: "/repo/branch", sha: "bbbbbbb2222" };
const costed = (costUsd: number, overrides: Partial<ResultFile> = {}): ResultFile => result({ costUsd, ...overrides });

describe("renderSpread", () => {
  it("spread_three_runs: min, median and max of three runs", () => {
    const text = renderSpread([costed(1), costed(2), costed(9)]);
    expect(text).toContain("| Cost | $1.00 / $2.00 / $9.00 |");
    expect(text).toContain("| Runs | 3 |");
    expect(text).not.toContain("Fewer than 3");
  });

  it("spread_one_run: min = median = max", () => {
    expect(renderSpread([costed(4)])).toContain("| Cost | $4.00 / $4.00 / $4.00 |");
  });

  it("takes the median of an even count as the mean of the middle two", () => {
    expect(renderSpread([costed(1), costed(2), costed(4), costed(9)])).toContain("| Cost | $1.00 / $3.00 / $9.00 |");
  });

  it("flags_fewer_than_three: names the task and arm, counting only finished runs", () => {
    const text = renderSpread([costed(1), costed(2), costed(3, { stop: "error" }), costed(1, { task: "bug-fix", arm: branch }), costed(1, { task: "bug-fix", arm: branch }), costed(1, { task: "bug-fix", arm: branch })]);
    expect(text).toContain("> Fewer than 3 finished runs: medium-feature A · aaaaaaa (2)");
    expect(text).not.toContain("bug-fix B");
  });

  it("cost_per_hidden_test_zero_passed: prints n/a, not a division by zero", () => {
    const text = renderSpread([costed(5, { hidden: { passed: 0, total: 13 } })]);
    expect(text).toContain("| Cost per hidden test passed | n/a |");
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("NaN");
  });

  it("divides each run's cost by its passed tests", () => {
    const text = renderSpread([costed(10, { hidden: { passed: 10, total: 13 } }), costed(30, { hidden: { passed: 10, total: 13 } })]);
    expect(text).toContain("| Hidden passed | 10 / 10 / 10 |");
    expect(text).toContain("| Cost per hidden test passed | $1.00 / $2.00 / $3.00 |");
  });

  it("prints planted caught only for a task that plants defects", () => {
    const planted = renderSpread([costed(1, { planted: { caught: 3, total: 8 } }), costed(1, { planted: { caught: 5, total: 8 } }), costed(1, { planted: { caught: 8, total: 8 } })]);
    expect(planted).toContain("| Planted caught (of 8) | 3 / 5 / 8 |");
    expect(renderSpread([costed(1)])).not.toContain("Planted caught");
  });

  it("puts wall minutes and owner peak context in the table", () => {
    const text = renderSpread([costed(1, { wallMs: 30 * 60000, ownerPeakContextTokens: 100_000 }), costed(1, { wallMs: 60 * 60000, ownerPeakContextTokens: 200_000 })]);
    expect(text).toContain("| Wall minutes | 30 / 45 / 60 |");
    expect(text).toContain("| Owner peak context | 100k / 150k / 200k |");
  });
});

describe("renderSpread, the user's time", () => {
  const answer = (at: string, kind: string, id: string, choice: string, preference = "none") => JSON.stringify({ type: "answer", at, kind, id, via: "rpc", choice, text: "", preference, briefAnswered: false });
  const ticketText = "---\nid: \"AB-001\"\n---\n\n<!-- taro:notes -->\nAPPROVAL 2026-01-05T10:10Z — the user: \"Approve the plan\"\n<!-- /taro:notes -->\n";
  const fromLog = (lines: string[], wallMinutes: number): ResultFile => {
    const cards = scoreCards(lines.join("\n"), ticketText);
    return result({ wallMs: wallMinutes * 60000, wallMinutes, cardsAfterApproval: cards.cardsAfterApproval, userMinutesModelled: cards.userMinutesModelled, wallMinutesWithUser: wallMinutes + cards.userMinutesModelled, preferences: cards.preferences });
  };
  const noCards = fromLog([], 20);
  const beforeOnly = fromLog([answer("2026-01-05T10:02:00.000Z", "question", "q1#A", "x", "P1"), answer("2026-01-05T10:10:00.000Z", "plan", "scope-approval", "Approve")], 30);
  const afterCards = fromLog([answer("2026-01-05T10:10:00.000Z", "plan", "scope-approval", "Approve"), answer("2026-01-05T10:20:00.000Z", "question", "q1#A", "x", "P1"), answer("2026-01-05T10:30:00.000Z", "question", "q2#B", "y", "P2"), answer("2026-01-05T10:31:00.000Z", "question", "q3#C", "z")], 40);

  it("prints each measure per arm as min / median / max", () => {
    const text = renderSpread([noCards, beforeOnly, afterCards]);
    expect(text).toContain("| Cards after approval | 0 / 0 / 3 |");
    expect(text).toContain("| User minutes modelled | 0 / 60 / 120 |");
    expect(text).toContain("| Wall minutes with the user's time | 20 / 90 / 160 |");
    expect(text).toContain("| Preferences before approval | 0 / 0 / 1 |");
    expect(text).toContain("| Preferences after approval | 0 / 0 / 2 |");
  });

  it("shows n/a for results from before these were recorded", () => {
    const text = renderSpread([result()]);
    expect(text).toContain("| Cards after approval | n/a |");
    expect(text).toContain("| Preferences before approval | n/a |");
  });
});
