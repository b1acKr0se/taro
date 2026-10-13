import { describe, expect, it } from "vitest";

import { addableModelGroups, modelOptions, thinkingAfterModelChange, thinkingOptions, toggleSubagentModel, type PickerModel } from "./model-picker";

const models: PickerModel[] = [
  { id: "claude/opus", label: "Claude · Opus", thinkingOptions: ["low", "high"], defaultThinking: "high" },
  { id: "codex/gpt", label: "Codex · GPT", thinkingOptions: ["medium"], defaultThinking: "" },
  { id: "other/plain", label: "Other · Plain", thinkingOptions: [], defaultThinking: "" },
];

describe("modelOptions", () => {
  it("lists every model in order", () => {
    expect(modelOptions(models, ["claude/opus"]).map((option) => option.value)).toEqual(["claude/opus", "codex/gpt", "other/plain"]);
  });

  it("keeps saved models the list lacks, once each, and ignores empty ones", () => {
    expect(modelOptions(models, ["gone/x", "", "gone/x", "codex/gpt"]).slice(3)).toEqual([{ label: "gone/x (not listed)", value: "gone/x" }]);
  });

  it("shows only saved values when the list is empty", () => {
    expect(modelOptions([], ["claude/opus"])).toEqual([{ label: "claude/opus (not listed)", value: "claude/opus" }]);
    expect(modelOptions([], [])).toEqual([]);
  });
});

describe("thinkingOptions", () => {
  it("starts with the provider default, naming it when known", () => {
    expect(thinkingOptions(models, "claude/opus", "")).toEqual([
      { label: "Default (high)", value: "" },
      { label: "low", value: "low" },
      { label: "high", value: "high" },
    ]);
    expect(thinkingOptions(models, "codex/gpt", "")[0]).toEqual({ label: "Default", value: "" });
  });

  it("offers only the default for a model without options or an unlisted model", () => {
    expect(thinkingOptions(models, "other/plain", "")).toEqual([{ label: "Default", value: "" }]);
    expect(thinkingOptions(models, "gone/x", "")).toEqual([{ label: "Default", value: "" }]);
  });

  it("keeps a saved value the model does not offer, marked", () => {
    expect(thinkingOptions(models, "gone/x", "max").at(-1)).toEqual({ label: "max (not listed)", value: "max" });
  });
});

describe("thinkingAfterModelChange", () => {
  it("keeps a value the new model offers", () => {
    expect(thinkingAfterModelChange(models, "claude/opus", "low")).toBe("low");
  });

  it("resets a value the new model does not offer", () => {
    expect(thinkingAfterModelChange(models, "codex/gpt", "low")).toBe("");
    expect(thinkingAfterModelChange(models, "other/plain", "low")).toBe("");
  });

  it("keeps the default and leaves an unlisted model's value alone", () => {
    expect(thinkingAfterModelChange(models, "codex/gpt", "")).toBe("");
    expect(thinkingAfterModelChange(models, "gone/x", "max")).toBe("max");
  });
});

describe("toggleSubagentModel", () => {
  it("adds at the end and removes in place", () => {
    expect(toggleSubagentModel([], "a")).toEqual(["a"]);
    expect(toggleSubagentModel(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleSubagentModel(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("addableModelGroups", () => {
  const options = [
    { label: "Claude · Opus", value: "claude/opus" },
    { label: "Codex · GPT", value: "codex/gpt" },
    { label: "Claude · Haiku", value: "claude/haiku" },
    { label: "gone/x (not listed)", value: "gone/x" },
  ];

  it("groups by provider in first-seen order, labels without the provider", () => {
    expect(addableModelGroups(options, [], "")).toEqual([
      { provider: "Claude", options: [{ label: "Opus", value: "claude/opus" }, { label: "Haiku", value: "claude/haiku" }] },
      { provider: "Codex", options: [{ label: "GPT", value: "codex/gpt" }] },
      { provider: "gone", options: [{ label: "gone/x (not listed)", value: "gone/x" }] },
    ]);
  });

  it("leaves out the chosen models and drops a group they empty", () => {
    expect(addableModelGroups(options, ["codex/gpt", "claude/opus", "gone/x"], "").map((group) => group.provider)).toEqual(["Claude"]);
    expect(addableModelGroups(options, ["codex/gpt", "claude/opus", "gone/x"], "")[0]?.options).toEqual([{ label: "Haiku", value: "claude/haiku" }]);
  });

  it("matches every word of the query, in any case, against label and id", () => {
    expect(addableModelGroups(options, [], "  CLAUDE   hai ")).toEqual([{ provider: "Claude", options: [{ label: "Haiku", value: "claude/haiku" }] }]);
    expect(addableModelGroups(options, [], "codex/")).toEqual([{ provider: "Codex", options: [{ label: "GPT", value: "codex/gpt" }] }]);
    expect(addableModelGroups(options, [], "opus gpt")).toEqual([]);
  });

  it("is empty for no options or everything chosen", () => {
    expect(addableModelGroups([], [], "")).toEqual([]);
    expect(addableModelGroups(options, options.map((option) => option.value), "")).toEqual([]);
  });
});
