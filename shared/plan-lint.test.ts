import { describe, expect, it } from "vitest";

import { isPlanReview, lintPlan, type LintChild, type LintTicket } from "./plan-lint";

const PLAN_EDITED = "2026-11-12T10:05:30Z";
const REVIEWED = "REVIEW 2026-11-12T10:20Z — plan review by reviewer-1: interfaces agree; one gap fixed — verdict: clean";

function plan(parts: string): string {
  return `## Goal\nExport a report.\n## Choices I made\n- Format — default: CSV — any spreadsheet opens it\n## Out of scope\n- Excel\n## Parts\n${parts}\n## Risks\n- none\n## How I'll prove it\n- tests\n## Size\nHigh`;
}

function spec(sections: { owns?: string; interfaces?: string; tests?: string; focus?: string }): string {
  const parts = [`# SH-12.0x · a child\n## Context\nParent: SH-12.`];
  if (sections.owns !== undefined) parts.push(`## Owns\n${sections.owns}`);
  if (sections.interfaces !== undefined) parts.push(`## Interfaces\n${sections.interfaces}`);
  if (sections.tests !== undefined) parts.push(`## Tests required\n${sections.tests}`);
  if (sections.focus !== undefined) parts.push(`## Review Focus\n${sections.focus}`);
  return parts.join("\n\n");
}

const WRITER: LintChild = {
  id: "SH-12.01",
  description: spec({
    owns: "- `server/csv.ts`\n- `server/csv.test.ts`",
    interfaces: "- Provide: `toCsv(rows: Row[]): string`\n  - e.g. `toCsv([{ a: 1 }])` → `\"a\\n1\\n\"`\n  - e.g. `toCsv([])` → `\"\"`",
    tests: "- `toCsv quotes commas`: `[{ a: \"x,y\" }]` → `\"a\\n\\\"x,y\\\"\\n\"`",
  }),
  labels: ["complexity-medium"],
  dependencies: [],
};

const BUTTON: LintChild = {
  id: "SH-12.02",
  description: spec({
    owns: "- `client/export-button.tsx`",
    interfaces: "- Provide: `ExportButton` component\n  - e.g. pressed → downloads `report.csv`\n- Use: `toCsv` — from SH-12.01\n- Use: `useReport()` — existing (client/report.ts:12)",
    tests: "- `ExportButton downloads`: a report of 2 rows → a 3-line file",
  }),
  labels: ["complexity-medium"],
  dependencies: ["SH-12.01"],
};

const PARTS = "- SH-12.01 — CSV writer — S — depends on: none\n- SH-12.02 — Export button — M — depends on: SH-12.01";

function ticket(overrides: Partial<LintTicket> = {}): LintTicket {
  return { labels: ["complexity-high"], plan: plan(PARTS), notes: REVIEWED, planUpdatedAt: PLAN_EDITED, children: [WRITER, BUTTON], ...overrides };
}

describe("lintPlan", () => {
  it("passes a high plan whose children are specified and whose plan was reviewed after its last edit", () => {
    expect(lintPlan(ticket())).toEqual([]);
  });

  it("judges only a high ticket's plan in the template's shape, in its first round", () => {
    const empty = { plan: plan("- SH-12.09 — missing — XL"), notes: null, children: [] };
    expect(lintPlan(ticket({ ...empty, labels: ["complexity-medium"] }))).toEqual([]);
    expect(lintPlan(ticket({ ...empty, plan: "An older free-form plan.\n\nBuild the export." }))).toEqual([]);
    expect(lintPlan(ticket({ ...empty, notes: "REOPENED 2026-11-12T11:00Z — round 2: fix the header" }))).toEqual([]);
    expect(lintPlan(ticket(empty)).length).toBeGreaterThan(0);
  });

  // An investigation is worked as low whatever its rating: no children, no plan review, no high-level sections.
  it("asks nothing of a high investigation's plan", () => {
    const empty = { plan: plan("- SH-12.09 — missing — XL"), notes: null, children: [] };
    expect(lintPlan(ticket({ ...empty, labels: ["complexity-high", "investigation"] }))).toEqual([]);
    expect(lintPlan(ticket({ ...empty, labels: ["complexity-high", "investigation"], plan: "## Goal\nFind why exports fail" }))).toEqual([]);
  });

  describe("Parts", () => {
    it("asks for Parts in a plan with no children and no Parts section (an old plan)", () => {
      const gaps = lintPlan(ticket({ plan: "## Goal\nG\n## Choices I made\n- c — w\n## Size\nHigh", children: [] }));
      expect(gaps).toHaveLength(1);
      expect(gaps[0]).toContain("a Parts section");
    });

    it("asks for a child line in a Parts section that names none", () => {
      expect(lintPlan(ticket({ plan: plan("Children later."), children: [] }))[0]).toContain("a child line under Parts");
    });

    it("accepts a plan with no children that says why", () => {
      expect(lintPlan(ticket({ plan: plan("- none — one deliverable, built by one implementer"), children: [] }))).toEqual([]);
    });
  });

  describe("children", () => {
    it("names a child in Parts that does not exist, and passes once it does", () => {
      expect(lintPlan(ticket({ children: [WRITER] }))).toEqual([expect.stringContaining("child ticket SH-12.02, named in Parts")]);
      expect(lintPlan(ticket())).toEqual([]);
    });

    it("names what a child's definition of done lacks among Owns, Interfaces and Tests", () => {
      const bare = { ...BUTTON, description: spec({ owns: "- <exact path of each file>" }) };
      const gaps = lintPlan(ticket({ children: [WRITER, bare] }));
      expect(gaps).toEqual(["Owns (its exact files), Interfaces (what it provides and uses, or `none — <why>`), Tests required (each test named, with its input and expected output) in SH-12.02's definition of done"]);
    });

    it("accepts Interfaces of `none — why`", () => {
      const docs = { ...BUTTON, description: spec({ owns: "- `docs/export.md`", interfaces: "- none — text only", tests: "- `word budget`: the page → within 300 words" }) };
      expect(lintPlan(ticket({ children: [WRITER, docs] }))).toEqual([]);
    });

    it("asks for examples under an interface provided without an e.g. line", () => {
      const noExamples = { ...WRITER, description: spec({ owns: "- `server/csv.ts`", interfaces: "- Provide: `toCsv(rows: Row[]): string`", tests: "- `toCsv`: [] → \"\"" }) };
      expect(lintPlan(ticket({ children: [noExamples, BUTTON] }))).toEqual([expect.stringContaining("examples for SH-12.01's `toCsv` under Interfaces")]);
    });

    it("refuses a child sized over L and one with no size", () => {
      const gaps = lintPlan(ticket({ plan: plan("- SH-12.01 — CSV writer — XL — depends on: none\n- SH-12.02 — Export button — depends on: SH-12.01") }));
      expect(gaps).toEqual([expect.stringContaining("a split of SH-12.01: sized XL, over L"), expect.stringContaining("a size (S, M or L) on SH-12.02's Parts line")]);
      expect(lintPlan(ticket({ plan: plan("- SH-12.01 — CSV writer — L — depends on: none\n- SH-12.02 — Export button — S — depends on: SH-12.01") }))).toEqual([]);
    });

    it("asks a child labelled risk for its Review Focus, and passes once it has one", () => {
      const risky = { ...WRITER, labels: ["complexity-medium", "risk"] };
      expect(lintPlan(ticket({ children: [risky, BUTTON] }))).toEqual([expect.stringContaining("a Review Focus in SH-12.01's definition of done")]);
      const focused = { ...risky, description: `${WRITER.description}\n\n## Review Focus\n- a field with a quote and a comma — test: \`toCsv quotes commas\`` };
      expect(lintPlan(ticket({ children: [focused, BUTTON] }))).toEqual([]);
    });
  });

  describe("shared files", () => {
    const sharing = { ...BUTTON, description: (BUTTON.description ?? "").replace("- `client/export-button.tsx`", "- `client/export-button.tsx`\n- `./server/csv.ts` — adds a header option") };

    it("refuses two children with no dependency between them owning the same file", () => {
      const parallel = { ...sharing, dependencies: [] };
      const gaps = lintPlan(ticket({ plan: plan("- SH-12.01 — CSV writer — S — depends on: none\n- SH-12.02 — Export button — M — depends on: none"), children: [WRITER, parallel] }));
      expect(gaps).toEqual(["an owner for `server/csv.ts`: both SH-12.01 and SH-12.02 own it and neither depends on the other (give it to one, or add a dependency)"]);
    });

    it("lets children one after the other share a file, by a ticket dependency, a Parts dependency, or through a third child", () => {
      expect(lintPlan(ticket({ children: [WRITER, sharing] }))).toEqual([]);
      expect(lintPlan(ticket({ children: [WRITER, { ...sharing, dependencies: [] }] }))).toEqual([]);
      const middle: LintChild = { id: "SH-12.03", description: spec({ owns: "- `server/other.ts`", interfaces: "- none — glue", tests: "- `glue`: a → b" }), labels: [], dependencies: ["SH-12.01"] };
      const parts = "- SH-12.01 — writer — S — depends on: none\n- SH-12.03 — glue — S — depends on: SH-12.01\n- SH-12.02 — button — M — depends on: SH-12.03";
      expect(lintPlan(ticket({ plan: plan(parts), children: [WRITER, middle, { ...sharing, dependencies: ["SH-12.03"] }] }))).toEqual([]);
    });
  });

  describe("interfaces", () => {
    it("reads `Provide: none` as no interface, so it asks for no examples", () => {
      const usesOnly = { ...BUTTON, description: (BUTTON.description ?? "").replace("- Provide: `ExportButton` component\n  - e.g. pressed → downloads `report.csv`", "- Provide: none — it only calls others") };
      expect(lintPlan(ticket({ children: [WRITER, usesOnly] }))).toEqual([]);
    });

    it("reads `Use: none` as no interface, so it asks for no provider", () => {
      const standalone = { ...WRITER, description: (WRITER.description ?? "").replace("- Provide:", "- Use: none\n- Provide:") };
      expect(lintPlan(ticket({ children: [standalone, BUTTON] }))).toEqual([]);
      const bold = { ...WRITER, description: (WRITER.description ?? "").replace("- Provide:", "- **Use:** `none` — standalone\n- Provide:") };
      expect(lintPlan(ticket({ children: [bold, BUTTON] }))).toEqual([]);
    });

    it("names an interface a child uses that no child provides, unless it is existing", () => {
      const orphan = { ...BUTTON, description: (BUTTON.description ?? "").replace("- Use: `toCsv` — from SH-12.01", "- Use: `toTsv(rows)` — from SH-12.01") };
      expect(lintPlan(ticket({ children: [WRITER, orphan] }))).toEqual([expect.stringContaining("a provider for `toTsv`, which SH-12.02 uses and no child provides")]);
      const existing = { ...BUTTON, description: (BUTTON.description ?? "").replace("- Use: `toCsv` — from SH-12.01", "- Use: `toTsv(rows)` — existing (server/tsv.ts:4)") };
      expect(lintPlan(ticket({ children: [WRITER, existing] }))).toEqual([]);
    });
  });

  describe("plan review", () => {
    it("asks for a plan review when the round has none", () => {
      expect(lintPlan(ticket({ notes: null }))).toEqual([expect.stringContaining("a plan review: an independent reviewer's REVIEW record")]);
    });

    it("asks again when the plan was edited after the review, and counts a review in the same minute", () => {
      const stale = "REVIEW 2026-11-12T10:04Z — plan review by reviewer-1 — verdict: findings";
      expect(lintPlan(ticket({ notes: stale }))).toEqual([expect.stringContaining(`written after the plan's last edit at ${PLAN_EDITED}`)]);
      expect(lintPlan(ticket({ notes: `${stale}\nREVIEW 2026-11-12T10:05Z — plan review by reviewer-1: fixed — verdict: clean` }))).toEqual([]);
    });

    it("does not take a code review for a plan review", () => {
      expect(lintPlan(ticket({ notes: "REVIEW 2026-11-12T10:20Z — reviewer-1, main..taro/sh-12 — verdict: clean" }))).toEqual([expect.stringContaining("a plan review")]);
    });

    it("counts any plan review for a plan edited before its edit time was kept", () => {
      expect(lintPlan(ticket({ planUpdatedAt: null, notes: "REVIEW 2026-01-01T00:00Z — plan review by reviewer-1 — verdict: clean" }))).toEqual([]);
    });
  });
});

describe("isPlanReview", () => {
  it("knows a plan review by the words right after the record's time", () => {
    expect(isPlanReview(REVIEWED)).toBe(true);
    expect(isPlanReview("REVIEW — Plan review by reviewer-1")).toBe(true);
    expect(isPlanReview("REVIEW 2026-11-12T10:20Z — reviewer-1 — the plan review found nothing — verdict: clean")).toBe(false);
    expect(isPlanReview("REVIEW 2026-11-12T10:20Z — self-review of main..taro/sh-12 — verdict: clean")).toBe(false);
  });
});
