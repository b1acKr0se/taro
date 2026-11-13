import { describe, expect, it } from "vitest";

import { choiceDefault, parsePart, parsePlan, splitChoice } from "./plan";

const FULL = `## Goal
Approve a plan from a compact card in seconds.

## Choices I made
- The plan is written once — the card reads it from the ticket.
- "How I'll prove it" replaces criteria -- older checklists still show.
- One-line Result - not a new field.
- Approval questions get a change placeholder — others keep the answer one.

## What you'll see
- A compact card in chat, Inbox and on the board.
- View plan opens the ticket's Plan.

## Out of scope
- Rewriting existing tickets.

## How I'll prove it
- Screenshots of the card, phone and desktop.
- Tests for the parser.

## Size
High: 2 children, one review each; about 3–4 hours.
`;

describe("parsePlan", () => {
  it("reads the full template into its sections, in order", () => {
    const plan = parsePlan(FULL);
    expect(plan).not.toBeNull();
    expect(plan?.goal).toBe("Approve a plan from a compact card in seconds.");
    expect(plan?.size).toBe("High: 2 children, one review each; about 3–4 hours.");
    expect(plan?.sections.map((section) => section.key)).toEqual(["goal", "choices", "see", "outOfScope", "proof", "size"]);
    expect(plan?.sections[2]?.items).toEqual(["A compact card in chat, Inbox and on the board.", "View plan opens the ticket's Plan."]);
    expect(plan?.intro).toBe("");
    expect(Object.values(plan?.over ?? {})).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(plan?.parts).toEqual([]);
  });

  it("splits each choice at its first dash: —, -- or -", () => {
    expect(parsePlan(FULL)?.choices).toEqual([
      { choice: "The plan is written once", why: "the card reads it from the ticket." },
      { choice: `"How I'll prove it" replaces criteria`, why: "older checklists still show." },
      { choice: "One-line Result", why: "not a new field." },
      { choice: "Approval questions get a change placeholder", why: "others keep the answer one." },
    ]);
  });

  it("keeps a choice without a why whole, and splits only at the first dash", () => {
    expect(splitChoice("Use pre-commit hooks")).toEqual({ choice: "Use pre-commit hooks", why: "" });
    expect(splitChoice("A — b — c")).toEqual({ choice: "A", why: "b — c" });
    expect(parsePlan("## Goal\nG\n## Choices I made\n- Just a choice")?.choices).toEqual([{ choice: "Just a choice", why: "" }]);
  });

  it("returns what is there when sections are missing", () => {
    const plan = parsePlan("## Goal\nOnly a goal.");
    expect(plan?.goal).toBe("Only a goal.");
    expect(plan?.choices).toEqual([]);
    expect(plan?.size).toBe("");
    expect(plan?.sections.map((section) => section.key)).toEqual(["goal"]);
  });

  it("puts the template's sections in template order and keeps unknown ones after them, in the order written", () => {
    const plan = parsePlan("## Size\nLow\n## Open risks\n- r1\n## Goal\nG\n## Notes\nSome notes\n## Choices I made\n- c — w");
    expect(plan?.sections.map((section) => section.heading)).toEqual(["Goal", "Choices I made", "Size", "Open risks", "Notes"]);
    expect(plan?.sections[3]).toMatchObject({ key: null, items: ["r1"], limit: null, over: 0 });
    expect(plan?.sections[4]?.prose).toBe("Some notes");
  });

  it("reads headings in any case, with straight or curly apostrophes, at levels # to ###", () => {
    const plan = parsePlan("# GOAL\nG\n### What you’ll see\n- s\n## how i'll prove it\n- p\n## Out Of Scope:\n- o");
    expect(plan?.sections.map((section) => section.key)).toEqual(["goal", "see", "outOfScope", "proof"]);
    expect(plan?.sections[1]?.heading).toBe("What you’ll see");
    // Four hashes is not one of the plan's headings.
    expect(parsePlan("#### Goal\nG")).toBeNull();
  });

  it("counts only Goal and Size lines past their limit, never bullets", () => {
    const bullets = (count: number) => Array.from({ length: count }, (_, index) => `- item ${index + 1}`).join("\n");
    const plan = parsePlan(`## Goal\nLine one\nLine two\n## Choices I made\n${bullets(9)}\n## What you'll see\n${bullets(9)}\n## Out of scope\n${bullets(9)}\n## How I'll prove it\n${bullets(9)}\n## Size\nS`);
    expect(plan?.over).toEqual({ goal: 1, choices: 0, see: 0, mockups: 0, outOfScope: 0, parts: 0, risks: 0, proof: 0, size: 0 });
    expect(plan?.sections[1]?.items).toHaveLength(9);
    expect(plan?.goal).toBe("Line one Line two");
  });

  it("joins a bullet's wrapped lines and keeps text before the first heading", () => {
    const plan = parsePlan("Intro line.\n\n## Goal\nG\n## What you'll see\n- first\n  continued\n- second");
    expect(plan?.intro).toBe("Intro line.");
    expect(plan?.sections[1]?.items).toEqual(["first continued", "second"]);
  });

  it("ignores headings inside a code fence", () => {
    const plan = parsePlan("## Goal\nG\n## Notes\n```\n## Size\n```");
    expect(plan?.sections.map((section) => section.heading)).toEqual(["Goal", "Notes"]);
  });

  it("is null for an empty plan, no plan, and a legacy numbered list", () => {
    expect(parsePlan("")).toBeNull();
    expect(parsePlan("   \n")).toBeNull();
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan("1. Add the parser\n2. Draw the card\n3. Test it")).toBeNull();
    expect(parsePlan("## Plan\n1. Add the parser\n## Risks\n- none")).toBeNull();
  });

  it("reads CRLF line endings", () => {
    expect(parsePlan("## Goal\r\nG\r\n## Size\r\nLow\r\n")).toMatchObject({ goal: "G", size: "Low" });
  });
});

const HIGH = `## Goal
Export a report as CSV.

## Choices I made
- Export format — default: CSV with a header row — opens in any spreadsheet
- Button place — default: beside Print — where people look for output

## What you'll see
- An Export button beside Print.

## Mockups
- mockup-export-desktop.png — the new button

## Out of scope
- Excel files.

## Parts
- SH-12.01 — CSV writer — S — depends on: none
- \`SH-12.02\`: Export button beside Print — M — depends on: SH-12.01, SH-12.03
- SH-12.03 — size: XL — Settings — depends on: SH-12.01

## Risks
- Large reports — the writer streams rows.

## How I'll prove it
- Unit tests and screenshots.

## Size
High: 3 children; about 5 hours.
`;

describe("a high plan", () => {
  it("reads Parts and Risks after Out of scope, in template order", () => {
    const plan = parsePlan(HIGH);
    expect(plan?.sections.map((section) => section.key)).toEqual(["goal", "choices", "see", "mockups", "outOfScope", "parts", "risks", "proof", "size"]);
    expect(plan?.sections.find((section) => section.key === "risks")?.items).toEqual(["Large reports — the writer streams rows."]);
  });

  it("reads each Parts line as a child: id, what it does, size and dependencies, its fields in any order", () => {
    expect(parsePlan(HIGH)?.parts).toEqual([
      { id: "SH-12.01", what: "CSV writer", size: "S", dependsOn: [] },
      { id: "SH-12.02", what: "Export button beside Print", size: "M", dependsOn: ["SH-12.01", "SH-12.03"] },
      { id: "SH-12.03", what: "Settings", size: "XL", dependsOn: ["SH-12.01"] },
    ]);
  });

  it("splits a high choice at its first dash, so the card shows the decision, then its default and why", () => {
    expect(parsePlan(HIGH)?.choices[0]).toEqual({ choice: "Export format", why: "default: CSV with a header row — opens in any spreadsheet" });
  });

  it("reads a Parts line that names no child as none: a `none — why` line, or prose", () => {
    expect(parsePart("none — built in one go")).toBeNull();
    expect(parsePart("no children")).toBeNull();
    expect(parsePart("SH-12.01 — writer")).toEqual({ id: "SH-12.01", what: "writer", size: "", dependsOn: [] });
    expect(parsePlan("## Goal\nG\n## Parts\n- none — one deliverable")?.parts).toEqual([]);
  });

  it("reads an old plan without Parts or Risks as before", () => {
    const plan = parsePlan(FULL);
    expect(plan?.parts).toEqual([]);
    expect(plan?.sections.some((section) => section.key === "parts" || section.key === "risks")).toBe(false);
  });
});

describe("choiceDefault", () => {
  it("reads a high plan choice's default, without its why", () => {
    expect(choiceDefault(splitChoice("Export format — default: CSV with a header row — opens in any spreadsheet"))).toBe("CSV with a header row");
    expect(choiceDefault(splitChoice("Button place — Default: beside Print"))).toBe("beside Print");
  });

  it("is empty for a choice that names no default", () => {
    expect(choiceDefault(splitChoice("The plan is written once — the card reads it from the ticket"))).toBe("");
    expect(choiceDefault(splitChoice("Just a choice"))).toBe("");
    expect(choiceDefault(splitChoice("Keep it — defaults are fine"))).toBe("");
  });
});
