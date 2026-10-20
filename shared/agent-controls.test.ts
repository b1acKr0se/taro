import { describe, expect, it } from "vitest";

import { controlLabels, effortOf, modelName, thinkingLabel } from "./agent-controls";

describe("thinkingLabel", () => {
  it("words the ids as Paseo's composer does", () => {
    expect(thinkingLabel("high")).toBe("High");
    expect(thinkingLabel("xhigh")).toBe("Extra high");
    expect(thinkingLabel("extra-high")).toBe("Extra high");
    expect(thinkingLabel("auto")).toBe("Auto");
    expect(thinkingLabel("ultra_think")).toBe("Ultra think");
    expect(thinkingLabel("budgetTokens")).toBe("Budget tokens");
    expect(thinkingLabel("")).toBe("");
  });
});

describe("modelName", () => {
  const models = [{ id: "claude/claude-sonnet-5-5", modelLabel: "Sonnet 5.5" }, { id: "codex/gpt-9", modelLabel: "" }];

  it("uses the provider's label for the model", () => {
    expect(modelName(models, { provider: "claude", model: "claude-sonnet-5-5" })).toBe("Sonnet 5.5");
  });

  it("falls back to the raw id when the model is unlisted or has no label", () => {
    expect(modelName(models, { provider: "claude", model: "claude-next" })).toBe("claude-next");
    expect(modelName(models, { provider: "codex", model: "gpt-9" })).toBe("gpt-9");
    expect(modelName([], { provider: "claude", model: "claude-sonnet-5-5" })).toBe("claude-sonnet-5-5");
  });

  it("is null while the agent's model is unknown", () => {
    expect(modelName(models, { provider: "claude", model: null })).toBeNull();
  });
});

describe("effortOf", () => {
  const models = [{ id: "claude/claude-sonnet-5-5", defaultThinking: "medium" }, { id: "codex/gpt-9", defaultThinking: "" }];

  it("is the effort the agent was started with", () => {
    expect(effortOf(models, { provider: "claude", model: "claude-sonnet-5-5", thinking: "high" })).toBe("high");
  });

  it("is the model's default when none was chosen", () => {
    expect(effortOf(models, { provider: "claude", model: "claude-sonnet-5-5", thinking: null })).toBe("medium");
    expect(effortOf(models, { provider: "claude", model: "claude-sonnet-5-5", thinking: "" })).toBe("medium");
  });

  it("is null when neither is known", () => {
    expect(effortOf(models, { provider: "codex", model: "gpt-9", thinking: null })).toBeNull();
    expect(effortOf(models, { provider: "claude", model: "claude-next", thinking: null })).toBeNull();
    expect(effortOf(models, { provider: "claude", model: null, thinking: null })).toBeNull();
  });
});

describe("controlLabels", () => {
  const models = [{ id: "claude/opus", modelLabel: "Opus 5", defaultThinking: "high" }];
  it("names the model and words its effort", () => {
    expect(controlLabels(models, { provider: "claude", model: "opus", thinking: "xhigh" })).toEqual({ name: "Opus 5", effort: "Extra high" });
  });
  it("falls back to the model's default effort", () => {
    expect(controlLabels(models, { provider: "claude", model: "opus", thinking: null })).toEqual({ name: "Opus 5", effort: "High" });
  });
  it("has no effort when none is known, and the provider when no model", () => {
    expect(controlLabels([], { provider: "claude", model: null, thinking: null })).toEqual({ name: "claude", effort: null });
  });
});
