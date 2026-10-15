/**
 * A board card's stats line keeps the clock icon beside its "wall · active · turns" text and the coins
 * icon beside its cost: in a narrow column the text wraps beside its icon, never under it (TR-103). The
 * card is React Native that vitest cannot render, so this reads its source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "ticket-card.tsx"), "utf8");
const between = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const styleOf = (name: string) => between(`${name}: {`, "},");

describe("the card's stats line", () => {
  const statsLine = between("const statsLine", "// A finished ticket");

  it("puts each icon in one group with its text", () => {
    for (const icon of ["Timer", "Coins"]) {
      expect(statsLine).toMatch(new RegExp(`<View style={styles\\.stat}>\\s*<View style={styles\\.statIcon}>\\s*<Icon name="${icon}"[^>]*/>\\s*</View>\\s*<Text style={\\[styles\\.muted, styles\\.statText\\]}>`));
    }
  });

  it("keeps a group on one line and lets its text shrink and wrap beside the icon", () => {
    expect(styleOf("stat")).toContain('flexDirection: "row"');
    expect(styleOf("stat")).not.toContain("flexWrap");
    expect(styleOf("stat")).toContain("flexShrink: 1");
    expect(styleOf("statText")).toContain("flexShrink: 1");
    expect(statsLine).not.toContain("numberOfLines");
  });
});
