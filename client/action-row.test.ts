/**
 * The Manager's action row (TR-057) is React Native that vitest cannot render, so these read its
 * source: one sideways scroll for the buttons and the pills, no scrollbar, no lightbulb.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(join(__dirname, name), "utf8");

describe("the Manager's action row", () => {
  it("never shows a scrollbar, on any platform", () => {
    const row = source("action-row.tsx");
    expect(row).toContain("showsHorizontalScrollIndicator={false}");
    expect(row).not.toMatch(/showsHorizontalScrollIndicator=\{(?!false\})/);
  });

  it("scrolls the buttons and the suggestions together", () => {
    expect(source("agent-chat.tsx")).toMatch(/<ActionRow theme=\{theme\}>\s*\{actions\}\s*\{suggestions\}\s*<\/ActionRow>/);
    const pills = source("suggestion-pills.tsx");
    expect(pills).not.toContain("ScrollView");
  });

  it("puts no lightbulb before the suggestions", () => {
    expect(source("suggestion-pills.tsx")).not.toContain("Lightbulb");
    expect(source("action-row.tsx")).not.toContain("Lightbulb");
  });
});
