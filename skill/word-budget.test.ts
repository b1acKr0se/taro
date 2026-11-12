/**
 * What agents read is kept short on purpose: an owner once read about 9,600 words before its first
 * command, and rules in the text were still missed. Each page has a budget here, so growth is a
 * visible choice (raise the number in the same change, with the reason in its commit), and the
 * pages a trivial or low owner reads before its first command stay under 3,000 words in all.
 * History (which ticket added a rule) lives in the tracker, never in this text.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL = import.meta.dirname;

/** Words as `wc -w` counts them. */
function words(page: string): number {
  return readFileSync(join(SKILL, page), "utf8").split(/\s+/).filter((word) => word !== "").length;
}

function pages(directory = SKILL): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name.endsWith(".md") ? [relative(SKILL, path)] : [];
  });
}

const BUDGETS: Record<string, number> = {
  "SKILL.md": 540,
  "roles/owner.md": 1020,
  "roles/manager.md": 1850,
  "roles/reviewer.md": 900,
  "roles/implementer.md": 360,
  "roles/researcher.md": 300,
  "levels/light.md": 300,
  "levels/medium.md": 470,
  "levels/high.md": 380,
  "phases/build.md": 415,
  "phases/review.md": 530,
  "phases/delivery.md": 1020,
  "phases/accept.md": 780,
  "reference/formats.md": 730,
  "reference/images.md": 220,
  "reference/several-questions.md": 330,
  "reference/shell.md": 480,
  "reference/tickets.md": 2150,
  "reference/paseo.md": 460,
  "reference/model-tiers.md": 280,
  "reference/actions.md": 260,
  "templates/plan.md": 430,
  "templates/final.md": 200,
  "templates/definition-of-done.md": 470,
  "templates/brief.md": 240,
  "templates/handoff.md": 150,
  "templates/pull-request.md": 150,
};

/**
 * What a trivial or low owner reads before its first command, all it is told to: SKILL.md, its role,
 * shell.md, and what owner.md lists to read first (formats.md; owner.md holds the ticket commands it
 * needs first, so tickets.md waits for a step that needs it), then light.md as its first page.
 */
const LIGHT_OWNER_READS = ["SKILL.md", "roles/owner.md", "reference/shell.md", "reference/formats.md", "levels/light.md"];
const LIGHT_OWNER_BUDGET = 3_000;

describe("word budgets", () => {
  it("give every page of the skill a budget", () => {
    expect(pages().sort()).toEqual(Object.keys(BUDGETS).sort());
  });

  it.each(Object.entries(BUDGETS))("keep %s within %i words", (page, budget) => {
    expect(words(page)).toBeLessThanOrEqual(budget);
  });

  it("count every page owner.md tells an owner to read before its first command", () => {
    const owner = readFileSync(join(SKILL, "roles/owner.md"), "utf8");
    const first = /Before your first command read only ([^;]+);/.exec(owner)?.[1] ?? "";
    const named = [...first.matchAll(/`([a-z/-]+\.md)`|\b(SKILL\.md)\b/g)].map((match) => match[1] ?? match[2]);
    expect(named.length).toBeGreaterThan(0);
    for (const page of named) expect(LIGHT_OWNER_READS).toContain(page);
  });

  it(`keep what a trivial or low owner reads first within ${LIGHT_OWNER_BUDGET} words`, () => {
    const total = LIGHT_OWNER_READS.reduce((sum, page) => sum + words(page), 0);
    expect(total).toBeLessThanOrEqual(LIGHT_OWNER_BUDGET);
  });
});

/** The neutral example prefixes the text may use (`SH-012`, `NA-14`); any other id is a real ticket. */
const EXAMPLE_PREFIXES = new Set(["SH", "NA"]);

/** The history a text names: real ticket ids (not the example prefixes) and numbered decisions, in any case. */
function historyIn(text: string): string[] {
  const tickets = [...text.matchAll(/\b([A-Z][A-Z0-9]*)-\d+\b/g)].map((match) => match[0]).filter((id) => !EXAMPLE_PREFIXES.has(id.split("-")[0] ?? ""));
  const decisions = [...text.matchAll(/\bdecisions? \d+/gi)].map((match) => match[0]);
  return [...tickets, ...decisions];
}

describe("no history in the skill", () => {
  it.each(pages())("%s names no ticket number and no numbered decision", (page) => {
    expect(historyIn(readFileSync(join(SKILL, page), "utf8"))).toEqual([]);
  });

  it("would catch a real ticket number and a numbered decision, however it is written", () => {
    expect(historyIn("the plugin holds it (TR-146), as SH-012 and NA-14 show; Decision 53 and decisions 7")).toEqual(["TR-146", "Decision 53", "decisions 7"]);
  });
});
