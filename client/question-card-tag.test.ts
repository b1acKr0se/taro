/**
 * Needs you cards carry no all-caps "WAITING FOR YOU" tag (TR-158): it read as machine-made, and the
 * card's place in Needs you and its amber border already say the question pauses work. React Native
 * that vitest cannot render, so this reads the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const questionCard = readFileSync(join(__dirname, "decision-card.tsx"), "utf8");
const planCard = readFileSync(join(__dirname, "plan-card.tsx"), "utf8");

describe("a question that pauses work", () => {
  it("shows no waiting tag on a question card or a plan card", () => {
    for (const source of [questionCard, planCard]) {
      expect(source).not.toMatch(/waiting for you/i);
      expect(source).not.toMatch(/styles\.(blocking|waiting)\b/);
    }
  });

  it("keeps the amber border on a question card that can be answered", () => {
    expect(questionCard).toContain("const waiting = decision.blocking && answerable;");
    expect(questionCard).toContain("borderColor: waiting ? colors.statusWarning : colors.border");
  });

  it("keeps the amber border on a plan card", () => {
    expect(planCard).toContain("borderColor: decision.blocking ? colors.statusWarning : colors.border");
  });

  it("still says what happens without an answer on a question that does not pause work", () => {
    expect(questionCard).toContain("Going with “{decision.default}” unless you say otherwise.");
  });
});
