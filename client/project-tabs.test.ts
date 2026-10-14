/**
 * The project tab row (TR-071) is React Native that vitest cannot render, so these read its source:
 * New Project is a labelled button in the Catch up style, inside the scrolling row after the tabs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const screen = readFileSync(join(__dirname, "taro-screen.tsx"), "utf8");

describe("the New Project button in the project tab row", () => {
  it("is the Catch up button's kind, labelled New Project with a +, on phone and desktop", () => {
    expect(screen).toContain('<IconButton icon="Plus" label="New Project" showLabel theme={theme} onPress={() => choose(selected, "setup")} />');
    expect(screen).not.toMatch(/label="New project"|>New project</);
    expect(screen).not.toContain("newProjectRound");
  });

  it("follows the last tab inside both scrolling rows, phone and desktop", () => {
    const rows = screen.match(/<ScrollView horizontal contentContainerStyle=\{styles\.tabs\}[\s\S]*?<\/ScrollView>/g) ?? [];
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatch(/\)\}\s*\{newProject\}\s*<\/ScrollView>$/);
  });
});
