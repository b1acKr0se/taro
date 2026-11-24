import { describe, expect, it } from "vitest";

import { allModels, findingsByModel, findingsSummary, parseFindingsLines } from "./review-findings";

function review(lines: string[], verdict = "clean"): string {
  return ["REVIEW 2026-01-05T10:00Z — reviewer (Opus) over main..taro/na-12: F1 fixed in 4d5e6f7", ...lines, `verdict: ${verdict}`].join("\n");
}

function notes(...records: string[]): string {
  return records.join("\n\n");
}

const ESCAPE = "ESCAPE 2026-01-09T08:00Z — the export lost the last note; found by the user after delivery";

describe("parseFindingsLines", () => {
  it("parses the documented line", () => {
    expect(parseFindingsLines(review(["findings: claude-sonnet-5-5 — high 0, medium 1, low 1"]))).toEqual([{ model: "claude-sonnet-5-5", high: 0, medium: 1, low: 1 }]);
  });

  it("parses -- and - dashes and any case", () => {
    expect(parseFindingsLines("Findings: claude-opus-5-5 -- High 0, Medium 0, Low 0")).toEqual([{ model: "claude-opus-5-5", high: 0, medium: 0, low: 0 }]);
    expect(parseFindingsLines("FINDINGS:  claude-haiku-5-5  -  HIGH 2 ,  medium 3,low 4")).toEqual([{ model: "claude-haiku-5-5", high: 2, medium: 3, low: 4 }]);
    expect(parseFindingsLines("findings: claude-haiku-5-5–high 1, medium 0, low 0")).toEqual([{ model: "claude-haiku-5-5", high: 1, medium: 0, low: 0 }]);
  });

  it("normalises a provider prefix and a [1m] suffix", () => {
    expect(parseFindingsLines("findings: claude/claude-sonnet-5-5[1m] — high 1, medium 2, low 0")).toEqual([{ model: "claude-sonnet-5-5", high: 1, medium: 2, low: 0 }]);
  });

  it("skips a line missing a level", () => {
    expect(parseFindingsLines("findings: claude-haiku-5-5 — high 1, medium 2")).toEqual([]);
    expect(parseFindingsLines("findings: claude-haiku-5-5 — high 1, low 2")).toEqual([]);
    expect(parseFindingsLines("findings: claude-haiku-5-5 — high one, medium 2, low 0")).toEqual([]);
    expect(parseFindingsLines("findings: — high 1, medium 2, low 0")).toEqual([]);
  });

  it("reads two authors in one record", () => {
    const record = review(["findings: claude-sonnet-5-5 — high 1, medium 0, low 2", "findings: claude-haiku-5-5 — high 0, medium 3, low 0"]);
    expect(parseFindingsLines(record)).toEqual([
      { model: "claude-sonnet-5-5", high: 1, medium: 0, low: 2 },
      { model: "claude-haiku-5-5", high: 0, medium: 3, low: 0 },
    ]);
  });
});

describe("findingsByModel", () => {
  it("counts the brief's example", () => {
    const tickets = [
      { id: "NA-1", notes: notes(review(["findings: claude-sonnet-5-5 — high 1, medium 2, low 0"]), ESCAPE) },
      { id: "NA-2", notes: review(["findings: claude/claude-sonnet-5-5[1m] — high 0, medium 1, low 1"]) },
    ];
    expect(findingsByModel(tickets)).toEqual([{ model: "claude-sonnet-5-5", tickets: 2, high: 1, medium: 3, low: 1, escapes: 1 }]);
    expect(findingsSummary(tickets)).toEqual({
      models: [{ model: "claude-sonnet-5-5", tickets: 2, high: 1, medium: 3, low: 1, escapes: 1 }],
      all: { model: "All models", tickets: 2, high: 1, medium: 3, low: 1, escapes: 1 },
      reviews: 2,
    });
  });

  it("ignores old blocker records", () => {
    const tickets = [{ id: "NA-1", notes: notes("REVIEW 2025-12-01T10:00Z — reviewer over main..taro/na-1: 1 blocker, 2 should-fix\nverdict: changes", ESCAPE) }];
    expect(findingsByModel(tickets)).toEqual([]);
    expect(findingsSummary(tickets).reviews).toBe(0);
  });

  it("ignores plan reviews", () => {
    const tickets = [{ id: "NA-1", notes: "REVIEW 2026-01-04T10:00Z — plan review by a fresh agent\nfindings: claude-opus-5-5 — high 2, medium 0, low 0\nverdict: clean" }];
    expect(findingsByModel(tickets)).toEqual([]);
    expect(allModels(tickets).tickets).toBe(0);
  });

  it("ignores a findings line outside a REVIEW record", () => {
    const tickets = [{ id: "NA-1", notes: notes("EXECUTION 2026-01-03T10:00Z — owner started\nfindings: claude-opus-5-5 — high 2, medium 0, low 0", "findings: claude-opus-5-5 — high 1, medium 0, low 0") }];
    expect(findingsByModel(tickets)).toEqual([]);
  });

  it("keeps an upper-case FINDINGS line in its REVIEW record", () => {
    const tickets = [{ id: "NA-1", notes: notes(review(["FINDINGS: claude-opus-5-5 — high 1, medium 0, low 0"]), "EXECUTION 2026-01-06T10:00Z\nFINDINGS: claude-opus-5-5 — high 5, medium 0, low 0") }];
    expect(findingsByModel(tickets)).toEqual([{ model: "claude-opus-5-5", tickets: 1, high: 1, medium: 0, low: 0, escapes: 0 }]);
  });

  it("counts a model's tickets once across rounds", () => {
    const tickets = [
      {
        id: "NA-1",
        notes: notes(review(["findings: claude-sonnet-5-5 — high 1, medium 0, low 0"], "changes"), "REOPENED 2026-01-07T10:00Z — the user asked for more", review(["findings: claude-sonnet-5-5 — high 0, medium 1, low 0"])),
      },
    ];
    expect(findingsByModel(tickets)[0]?.tickets).toBe(1);
    expect(findingsSummary(tickets).reviews).toBe(2);
  });

  it("sums levels across rounds", () => {
    const tickets = [{ id: "NA-1", notes: notes(review(["findings: claude-sonnet-5-5 — high 1, medium 2, low 3"], "changes"), review(["findings: claude-sonnet-5-5 — high 1, medium 0, low 1"])) }];
    expect(findingsByModel(tickets)).toEqual([{ model: "claude-sonnet-5-5", tickets: 1, high: 2, medium: 2, low: 4, escapes: 0 }]);
  });

  it("counts zero-finding reviews as reviewed tickets", () => {
    const tickets = [{ id: "NA-1", notes: review(["findings: claude-opus-5-5 — high 0, medium 0, low 0"]) }];
    expect(findingsByModel(tickets)).toEqual([{ model: "claude-opus-5-5", tickets: 1, high: 0, medium: 0, low: 0, escapes: 0 }]);
  });

  it("counts a ticket's escapes once for each model it names", () => {
    const tickets = [
      {
        id: "NA-1",
        notes: notes(
          review(["findings: claude-sonnet-5-5 — high 0, medium 1, low 0", "findings: claude-haiku-5-5 — high 1, medium 0, low 0"], "changes"),
          review(["findings: claude-sonnet-5-5 — high 0, medium 0, low 1"]),
          ESCAPE,
          ESCAPE.replace("export", "import"),
        ),
      },
    ];
    const rows = findingsByModel(tickets);
    expect(rows.map((row) => [row.model, row.escapes])).toEqual([
      ["claude-haiku-5-5", 2],
      ["claude-sonnet-5-5", 2],
    ]);
  });

  it("does not count escapes on tickets without findings lines", () => {
    const tickets = [
      { id: "NA-1", notes: review(["findings: claude-sonnet-5-5 — high 0, medium 1, low 0"]) },
      { id: "NA-2", notes: notes(review([]), ESCAPE) },
      { id: "NA-3", notes: ESCAPE },
    ];
    expect(findingsByModel(tickets)[0]?.escapes).toBe(0);
    expect(allModels(tickets).escapes).toBe(0);
  });

  it("sorts by High per ticket, ties by tickets reviewed then name", () => {
    let count = 0;
    const line = (model: string, high: number) => ({ id: `NA-${++count}`, notes: review([`findings: ${model} — high ${high}, medium 0, low 0`]) });
    // alpha: 1 High over 2 tickets (0.5); beta and zeta: 1 over 4 (0.25), by name; delta: 1 over 8; omega: none.
    const tickets = [
      line("zeta", 1), line("zeta", 0), line("zeta", 0), line("zeta", 0),
      line("alpha", 1), line("alpha", 0),
      line("beta", 1), line("beta", 0), line("beta", 0), line("beta", 0),
      line("delta", 1), line("delta", 0),
      line("delta", 0), line("delta", 0), line("delta", 0), line("delta", 0), line("delta", 0), line("delta", 0),
      line("omega", 0),
    ];
    expect(findingsByModel(tickets).map((row) => row.model)).toEqual(["alpha", "beta", "zeta", "delta", "omega"]);
    // Both 0.5: the one with more tickets reviewed first.
    const ties = [line("small", 1), line("small", 0), line("large", 2), line("large", 0), line("large", 0), line("large", 0)];
    expect(findingsByModel(ties).map((row) => row.model)).toEqual(["large", "small"]);
  });

  it("the All models row counts a two-author ticket and its escapes once", () => {
    const tickets = [
      { id: "NA-1", notes: notes(review(["findings: claude-sonnet-5-5 — high 1, medium 0, low 0", "findings: claude-haiku-5-5 — high 2, medium 1, low 0"]), ESCAPE) },
      { id: "NA-2", notes: review(["findings: claude-haiku-5-5 — high 0, medium 0, low 3"]) },
    ];
    expect(allModels(tickets)).toEqual({ model: "All models", tickets: 2, high: 3, medium: 1, low: 3, escapes: 1 });
    expect(allModels([])).toEqual({ model: "All models", tickets: 0, high: 0, medium: 0, low: 0, escapes: 0 });
    expect(allModels([{ id: "NA-3", notes: null }])).toEqual({ model: "All models", tickets: 0, high: 0, medium: 0, low: 0, escapes: 0 });
  });
});
