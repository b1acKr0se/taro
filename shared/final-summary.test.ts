import { describe, expect, it } from "vitest";

import { FINAL_SECTIONS, finalSections, shownLimit } from "./final-summary";

const FINAL = `FINAL 2026-01-05T11:00Z

## What changed
- Notes export to Markdown files

## How it was verified
- Typecheck and tests pass

## Limitations
- None known.

## Rulings
- Exported YAML front matter — the usual choice for Markdown notes — rename the field if wrong
- Kept the old flag — less churn for existing scripts — remove it in a later change

Revision: 0123456789abcdef0123456789abcdef01234567 on taro/tr-001 · PR: none (local-only)`;

describe("a FINAL's Rulings (TR-263)", () => {
  it("is the template's last section, at most five bullets", () => {
    expect(FINAL_SECTIONS.map((section) => [section.key, section.heading, section.limit])).toEqual([
      ["changed", "What changed", 5],
      ["verified", "How it was verified", 3],
      ["limitations", "Limitations", 3],
      ["rulings", "Rulings", 5],
    ]);
  });

  it("is read as bullets, the revision line staying with the rest", () => {
    const sections = finalSections(FINAL);
    expect(sections?.rulings).toEqual([
      "Exported YAML front matter — the usual choice for Markdown notes — rename the field if wrong",
      "Kept the old flag — less churn for existing scripts — remove it in a later change",
    ]);
    expect(sections?.limitations).toEqual(["None known."]);
    expect(sections?.rest).toBe("Revision: 0123456789abcdef0123456789abcdef01234567 on taro/tr-001 · PR: none (local-only)");
  });

  it("is empty for a FINAL without one, and takes bold or colon headings as the others do", () => {
    expect(finalSections(FINAL.replace(/## Rulings[\s\S]*?\n\nRevision/, "Revision"))?.rulings).toEqual([]);
    expect(finalSections("## What changed\n- a\n\n**Rulings:**\n- b — c — d")?.rulings).toEqual(["b — c — d"]);
    expect(finalSections("## What changed\n- a\n\nRulings:\n- b — c — d")?.rulings).toEqual(["b — c — d"]);
  });

  it("shows the five costliest with the closing \"N more in the ticket\" line, and folds anything past that", () => {
    const five = ["a", "b", "c", "d", "e"];
    expect(shownLimit(5, [...five, "3 more in the ticket"])).toBe(6);
    expect(shownLimit(5, [...five, "3 more in the ticket."])).toBe(6);
    expect(shownLimit(5, [...five, "f"])).toBe(5);
    expect(shownLimit(5, [...five, "f", "3 more in the ticket"])).toBe(5);
    expect(shownLimit(5, ["a", "2 more in the ticket"])).toBe(5);
    const sections = finalSections(`## What changed\n- a\n\n## Rulings\n${five.map((each) => `- ${each}`).join("\n")}\n- 7 more in the ticket`);
    expect(sections?.rulings).toHaveLength(6);
    expect(shownLimit(5, sections?.rulings ?? [])).toBe(6);
  });
});
