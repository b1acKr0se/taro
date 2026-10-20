import { describe, expect, it } from "vitest";

import type { DecisionQuestion } from "./reports";
import { allAnswered, answeredFlags, draftAnswers, freshDrafts, keptDrafts, nextUnanswered, pillText, recapLine, type SeveralDrafts } from "./several-questions";

const question = (header: string, labels: string[]): DecisionQuestion => ({
  header,
  question: `${header}?`,
  why: "",
  options: labels.map((label) => ({ label, prompt: `Use ${label}`, consequence: "", images: [] })),
  recommended: labels[0] ?? "",
  reason: "",
});
const QUESTIONS = [question("Tags", ["YAML", "Hashtags"]), question("Folders", ["Flat", "Rename…"]), question("Images", ["Copy", "Link"])];

describe("stepping through several questions (TR-207)", () => {
  it("goes to the next unanswered question after a pick", () => {
    expect(nextUnanswered([true, false, false], 0)).toBe(1);
    expect(nextUnanswered([false, true, true], 2)).toBe(0);
    expect(nextUnanswered([true, true, true], 0)).toBeNull();
  });

  it("enables Submit only when every question is answered", () => {
    const some = [{ label: "YAML", typed: "" }, null, { label: "Copy", typed: "" }];
    expect(allAnswered(answeredFlags(QUESTIONS, some))).toBe(false);
    // An option asking for words, or Other, answers only with words.
    expect(allAnswered(answeredFlags(QUESTIONS, [some[0] ?? null, { label: "Rename…", typed: " " }, some[2] ?? null]))).toBe(false);
    expect(allAnswered(answeredFlags(QUESTIONS, [some[0] ?? null, { label: null, typed: "" }, some[2] ?? null]))).toBe(false);
    expect(allAnswered(answeredFlags(QUESTIONS, [some[0] ?? null, { label: "Rename…", typed: "by notebook" }, some[2] ?? null]))).toBe(true);
    expect(allAnswered(answeredFlags(QUESTIONS, [some[0] ?? null, { label: null, typed: "flat" }, some[2] ?? null]))).toBe(true);
  });

  it("cuts a long pill's answer with …", () => {
    const pill = pillText("Folders", "One file per note, notebooks as folders");
    expect(pill).toBe("✓ Folders: One file per note…");
    expect(pillText("Tag format", "YAML front matter")).toBe("✓ Tag format: YAML front matter");
    expect(pillText("Tags", null)).toBe("Tags");
    expect(pillText("Tags", "Averyveryverylongwordwithoutanyspaceinside")).toMatch(/^✓ Tags: .{22}…$/);
  });

  it("recaps the other answers from question 2", () => {
    const drafts = [{ label: "YAML", typed: "" }, { label: null, typed: "one per notebook" }, null];
    expect(recapLine(QUESTIONS, drafts, 0)).toBeNull();
    expect(recapLine(QUESTIONS, drafts, 2)).toBe("Answered: YAML · “one per notebook”");
  });

  it("sends words only with Other or an option asking for them", () => {
    const drafts = [{ label: "YAML", typed: "left over" }, { label: "Rename…", typed: " by notebook " }, { label: null, typed: "none" }];
    expect(draftAnswers(QUESTIONS, drafts)).toEqual([
      { header: "Tags", label: "YAML", text: "" },
      { header: "Folders", label: "Rename…", text: "by notebook" },
      { header: "Images", label: null, text: "none" },
    ]);
  });

  it("restores kept answers for the same key and drops them for an answered decision", () => {
    const store = new Map<string, SeveralDrafts>();
    const kept: SeveralDrafts = { drafts: [{ label: "YAML", typed: "" }, { label: "Flat", typed: "" }, null], current: 2 };
    store.set("owner:export", kept);
    expect(keptDrafts(store, { key: "owner:export", status: "open", questions: QUESTIONS })).toEqual(kept);
    expect(keptDrafts(store, { key: "owner:other", status: "open", questions: QUESTIONS })).toEqual(freshDrafts(3));
    // Asked again with another number of questions: its picks no longer fit.
    expect(keptDrafts(store, { key: "owner:export", status: "open", questions: QUESTIONS.slice(0, 2) })).toEqual(freshDrafts(2));
    expect(keptDrafts(store, { key: "owner:export", status: "answered", questions: QUESTIONS })).toEqual(freshDrafts(3));
    expect(store.has("owner:export")).toBe(false);
  });
});
