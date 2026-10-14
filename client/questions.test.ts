import { describe, expect, it } from "vitest";

import { allAnswered, buildAnswers, hasOtherRow, isAnswered, pickOption, pickOther, typingEnabled, type Question } from "./questions";

const question = (overrides: Partial<Question> = {}): Question => ({
  question: "Which storage?",
  header: "Storage",
  options: [{ label: "Per trade" }, { label: "Hourly" }],
  multiSelect: false,
  allowOther: true,
  allowEmpty: false,
  ...overrides,
});

describe("the Other row", () => {
  it("comes with a question that has options and takes words", () => {
    expect(hasOtherRow(question())).toBe(true);
    expect(hasOtherRow(question({ allowOther: false }))).toBe(false);
    expect(hasOtherRow(question({ options: [] }))).toBe(false);
  });

  it("opens the box only while picked; a question of words alone always takes them", () => {
    expect(typingEnabled(question(), 0, {})).toBe(false);
    expect(typingEnabled(question(), 0, { 0: true })).toBe(true);
    expect(typingEnabled(question({ options: [] }), 0, {})).toBe(true);
    expect(typingEnabled(question({ allowOther: false }), 0, { 0: true })).toBe(false);
  });
});

describe("picking", () => {
  it("unpicks Other on a single choice, and Other unpicks the option", () => {
    expect(pickOption(new Set(), true, 1, false)).toEqual({ selection: new Set([1]), otherPicked: false });
    expect(pickOther(new Set([1]), false, false)).toEqual({ selection: new Set(), otherPicked: true });
    expect(pickOther(new Set(), true, false)).toEqual({ selection: new Set(), otherPicked: false });
  });

  it("keeps ticks and Other side by side in a multi-select", () => {
    expect(pickOption(new Set([0]), true, 1, true)).toEqual({ selection: new Set([0, 1]), otherPicked: true });
    expect(pickOther(new Set([0]), false, true)).toEqual({ selection: new Set([0]), otherPicked: true });
  });
});

describe("answers", () => {
  it("sends the picked option and leaves out words kept greyed in the box", () => {
    expect(buildAnswers([question()], { 0: new Set([1]) }, { 0: "my own" }, {})).toEqual({ Storage: "Hourly" });
    expect(isAnswered(question(), 0, { 0: new Set([1]) }, { 0: "my own" }, {})).toBe(true);
  });

  it("sends the words typed under Other, trimmed, and needs them", () => {
    expect(buildAnswers([question()], {}, { 0: "  my own \n" }, { 0: true })).toEqual({ Storage: "my own" });
    expect(isAnswered(question(), 0, {}, { 0: "  " }, { 0: true })).toBe(false);
    expect(isAnswered(question(), 0, {}, { 0: "my own" }, {})).toBe(false);
  });

  it("joins ticks and Other's words in a multi-select, and Other needs its words there too", () => {
    const multi = question({ multiSelect: true });
    expect(buildAnswers([multi], { 0: new Set([0, 1]) }, { 0: "monthly" }, { 0: true })).toEqual({ Storage: "Per trade, Hourly, monthly" });
    expect(isAnswered(multi, 0, { 0: new Set([0]) }, {}, { 0: true })).toBe(false);
  });

  it("answers an optional question of words alone with nothing", () => {
    const optional = question({ options: [], allowEmpty: true });
    expect(buildAnswers([optional], {}, {}, {})).toEqual({ Storage: "" });
    expect(allAnswered([optional, question()], { 1: new Set([0]) }, {}, {})).toBe(true);
  });

  it("leaves an unanswered question out", () => {
    expect(buildAnswers([question()], {}, {}, {})).toEqual({});
    expect(allAnswered([question()], {}, {}, {})).toBe(false);
  });
});
