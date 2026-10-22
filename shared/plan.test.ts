import { describe, expect, it } from "vitest";

import { parsePlan, splitChoice } from "./plan";

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
    expect(Object.values(plan?.over ?? {})).toEqual([0, 0, 0, 0, 0, 0]);
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
    const plan = parsePlan("## Size\nLow\n## Risks\n- r1\n## Goal\nG\n## Notes\nSome notes\n## Choices I made\n- c — w");
    expect(plan?.sections.map((section) => section.heading)).toEqual(["Goal", "Choices I made", "Size", "Risks", "Notes"]);
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

  it("counts bullets and lines past each limit", () => {
    const bullets = (count: number) => Array.from({ length: count }, (_, index) => `- item ${index + 1}`).join("\n");
    const plan = parsePlan(`## Goal\nLine one\nLine two\n## Choices I made\n${bullets(6)}\n## What you'll see\n${bullets(9)}\n## Out of scope\n${bullets(4)}\n## How I'll prove it\n${bullets(9)}\n## Size\nS`);
    expect(plan?.over).toEqual({ goal: 1, choices: 2, see: 0, outOfScope: 1, proof: 5, size: 0 });
    expect(plan?.sections[1]?.items).toHaveLength(6);
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
