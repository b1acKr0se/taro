import { describe, expect, it } from "vitest";

import { modelOptions, thinkingAfterModelChange, thinkingOptions, toggleHelper, type PickerModel } from "./model-picker";

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
      { label: "Provider default (high)", value: "" },
      { label: "low", value: "low" },
      { label: "high", value: "high" },
    ]);
    expect(thinkingOptions(models, "codex/gpt", "")[0]).toEqual({ label: "Provider default", value: "" });
  });

  it("offers only the default for a model without options or an unlisted model", () => {
    expect(thinkingOptions(models, "other/plain", "")).toEqual([{ label: "Provider default", value: "" }]);
    expect(thinkingOptions(models, "gone/x", "")).toEqual([{ label: "Provider default", value: "" }]);
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

describe("toggleHelper", () => {
  it("adds at the end and removes in place", () => {
    expect(toggleHelper([], "a")).toEqual(["a"]);
    expect(toggleHelper(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleHelper(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});
