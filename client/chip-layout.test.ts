/**
 * Chips, pills and badges show their whole label on one centre line with their icon and count, and a
 * card's bordered actions start at its left edge (TR-089). The components are React Native that vitest
 * cannot render, so this checks the shared measurement and reads their source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FONT_SIZE, labelLineHeightFor } from "./type-scale";

const source = (name: string) => readFileSync(join(__dirname, name), "utf8");
const between = (text: string, start: string, end: string) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

describe("chip labels", () => {
  it("get a line with room below the baseline at every label size", () => {
    for (const size of [FONT_SIZE.micro, FONT_SIZE.caption, FONT_SIZE.small, FONT_SIZE.body]) {
      expect(labelLineHeightFor(size)).toBeGreaterThanOrEqual(size * 1.3);
      expect(Number.isInteger(labelLineHeightFor(size))).toBe(true);
    }
  });

  // Each label style a chip, pill, badge or tab draws its text with; the regression was board.tsx's chipText.
  const labels: Array<[file: string, start: string]> = [
    ["board.tsx", "chipText:"],
    ["board.tsx", "pillText:"],
    ["badges.tsx", "<Text style={{ flexShrink: 1, color"],
    ["ui.tsx", "text: { color: theme.colors.foreground, fontSize: FONT_SIZE.caption"],
    ["option-chips.tsx", "label: { flexShrink: 1"],
    ["ticket-card.tsx", "actionText:"],
    ["question-card.tsx", "actionText:"],
    ["permission-card.tsx", "tabText:"],
    ["taro-screen.tsx", "tabText:"],
    ["taro-screen.tsx", "tabMuted:"],
    ["taro-screen.tsx", "badgeText:"],
    ["sidebar.tsx", "{ color: theme.colors.surface0, fontSize: FONT_SIZE.micro"],
    ["agent-chat.tsx", "toolTitle:"],
    ["agent-chips.tsx", "fontSize: FONT_SIZE.caption"],
  ];
  it.each(labels)("%s %s sets its fixed label line", (file, start) => {
    const text = source(file);
    expect(text).toContain(start);
    const style = between(text, start, "}");
    const size = /fontSize: (FONT_SIZE\.\w+)/.exec(style)?.[1];
    expect(size).toBeDefined();
    expect(style).toContain(`lineHeight: labelLineHeightFor(${size})`);
  });

  it("never fixes a chip's height, so a larger system font grows it", () => {
    const chip = between(source("board.tsx"), "chip: {", "chipText:");
    expect(chip).not.toMatch(/\bheight:/);
    const segmented = between(source("ui.tsx"), "export function Segmented", "export function JumpToEnd");
    expect(segmented).not.toMatch(/[^a-zA-Z]height: BUTTON\.height/);
  });
});

describe("card actions", () => {
  it("start at a ticket card's left edge, outside the indented status text", () => {
    const row = between(source("ticket-card.tsx"), "function nowRow", "const asked =");
    const text = between(row, "<View style={styles.lineText}>", "</View>");
    for (const action of ["<OptionChips", "<AcceptancePair", "<IconButton", "styles.action"]) {
      expect(row).toContain(action);
      expect(text).not.toContain(action);
    }
  });

  it("start at a Manager question card's left edge, outside the indented question", () => {
    const card = source("question-card.tsx");
    const text = between(card, "<View style={styles.lineText}>", "</View>");
    expect(card).toContain("<OptionChips");
    expect(text).not.toContain("<OptionChips");
    expect(text).not.toContain("styles.action");
  });
});
