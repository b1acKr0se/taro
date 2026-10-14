/**
 * The Manager's action row (TR-057) is React Native that vitest cannot render, so these read its
 * source: one sideways scroll for the buttons and the pills, no scrollbar, no lightbulb, and every
 * button in it drawn alike (TR-070).
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

  it("labels Compact on every screen size, like Catch up", () => {
    const screen = source("taro-screen.tsx");
    for (const label of ["Catch up", "Compact"]) {
      expect(screen).toMatch(new RegExp(`label="${label}"\\s*showLabel\\s`));
    }
  });

  it("draws the suggestion chips with the buttons' measurements, not as pills", () => {
    const pills = source("suggestion-pills.tsx");
    expect(pills).not.toContain("999");
    expect(pills).toContain("minHeight: BUTTON.height");
    expect(pills).not.toContain("FONT_SIZE");
    expect(pills).not.toMatch(/size=\{\d+\}/);
    for (const measure of ["borderRadius", "fontSize", "lineHeight", "paddingVertical"]) {
      expect(pills).toMatch(new RegExp(`${measure}: BUTTON\\.`));
    }
    const ui = source("ui.tsx");
    const iconButton = ui.slice(ui.indexOf("export function IconButton"), ui.indexOf("export function AcceptancePair"));
    expect(iconButton).not.toMatch(/size=\{\d+\}/);
    for (const measure of ["borderRadius", "paddingVertical", "gap"]) {
      expect(iconButton).toMatch(new RegExp(`${measure}: BUTTON\\.${measure}`));
    }
  });
});
