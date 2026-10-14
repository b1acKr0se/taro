/**
 * A header row mixes icon buttons, labelled buttons and the Chat / Ticket switch; they must share one
 * height and one centre line (TR-077). The components are React Native that vitest cannot render, so
 * this checks the measurements they share and reads their source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BUTTON, SEGMENTED } from "./control-size";

const source = (name: string) => readFileSync(join(__dirname, name), "utf8");
const between = (text: string, start: string, end: string) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

describe("header controls", () => {
  it("fit an icon and a one-line label in the shared height, a label filling it exactly", () => {
    const frame = 2 * BUTTON.paddingVertical + 2 * BUTTON.borderWidth;
    expect(BUTTON.iconSize + frame).toBeLessThanOrEqual(BUTTON.height);
    expect(BUTTON.lineHeight + frame).toBe(BUTTON.height);
    // A segment inside the switch's track holds the same icon and label.
    const segment = BUTTON.height - 2 * SEGMENTED.padding - 2 * BUTTON.borderWidth;
    expect(segment).toBeGreaterThanOrEqual(BUTTON.lineHeight);
    expect(segment).toBeGreaterThanOrEqual(BUTTON.iconSize);
  });

  it("gives buttons and the switch that height, the label its fixed line, and never pins the switch to a row's top", () => {
    const ui = source("ui.tsx");
    const iconButton = between(ui, "export function IconButton", "export function AcceptancePair");
    expect(iconButton).toContain("minHeight: BUTTON.height");
    expect(iconButton).toContain("lineHeight: BUTTON.lineHeight");
    const segmented = between(ui, "export function Segmented", "export function JumpToEnd");
    expect(segmented).toContain("height: BUTTON.height");
    expect(segmented).toContain("lineHeight: BUTTON.lineHeight");
    expect(segmented).not.toContain("alignSelf");
    expect(segmented).not.toMatch(/(height|size|padding|paddingHorizontal|borderRadius): \d/);
  });

  it("draws a phone's Back as an icon alone that still names its target", () => {
    const pane = source("owner-pane.tsx");
    const leading = pane.slice(pane.indexOf("leading={compact"), pane.indexOf("\n", pane.indexOf("leading={compact")));
    expect(leading).toContain('icon="ArrowLeft"');
    expect(leading).toContain("label={backLabel}");
    expect(leading).not.toContain("showLabel");
    expect(pane).toContain("const backLabel = planOpen ? \"Back\" : `Back to ${backTo}`;");
  });
});
