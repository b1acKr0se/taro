import { describe, expect, it } from "vitest";

import { cardTextViolations } from "./card-check.ts";

const FACTS = { question: "Which format should the export use?", options: ["Markdown with front matter", "Plain text"] };
const CLEAN = "Which format should the export use? Markdown with front matter Recommended Why: editors read it Plain text Other Submit Dismiss";

describe("cardTextViolations", () => {
  it("accepts a clean card", () => {
    expect(cardTextViolations(CLEAN, FACTS)).toEqual([]);
  });
  it("accepts an option label wrapped over lines", () => {
    expect(cardTextViolations(CLEAN.replace("Markdown with", "Markdown\n  with"), FACTS)).toEqual([]);
  });
  it("flags a missing question and a missing option", () => {
    expect(cardTextViolations("Markdown with front matter", FACTS)).toEqual([
      { kind: "card-text", detail: 'the question is not on the card: "Which format should the export use?"' },
      { kind: "card-text", detail: 'the option "Plain text" is not on the card' },
    ]);
  });
  it("flags an empty label", () => {
    expect(cardTextViolations(CLEAN, { ...FACTS, options: [...FACTS.options, "  "] })).toEqual([{ kind: "card-text", detail: "an option has an empty label" }]);
  });
  it.each([
    ["undefined", "Why: undefined", "undefined"],
    ["null", "Going with null unless you say", "null"],
    ["NaN", "Estimate NaN min", "NaN"],
    ["[object Object]", "Why: [object Object]", "[object Object]"],
    ["{}", "Options {}", "{}"],
    ["a raw ```decision fence", "```decision id: x", "a raw ```decision fence"],
    ["raw JSON", 'Details {"id": "x", "options": []}', "raw JSON"],
    ["raw JSON", 'Details [{"label": "A"}]', "raw JSON"],
  ])("flags %s", (_name, extra, shown) => {
    expect(cardTextViolations(`${CLEAN} ${extra}`, FACTS)).toEqual([{ kind: "card-text", detail: `the card shows ${shown}` }]);
  });
  it("does not blame the card for words the agent wrote", () => {
    const facts = { question: "Should an unset tag be null or empty?", options: ["null", "empty"] };
    expect(cardTextViolations("Should an unset tag be null or empty? null empty Other Submit", facts)).toEqual([]);
  });
});
