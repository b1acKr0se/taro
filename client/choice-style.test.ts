import { describe, expect, it } from "vitest";

import { choiceContentOpacity, choiceListStyle, choiceRowStyle, chosenChipColors, radioStyle } from "./choice-style";
import { controlColors } from "./control-colors";

const LIGHT = { surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", foreground: "#09090b", foregroundMuted: "#71717a", accent: "#20744a", border: "#e4e4e7" };
const DARK = { surface0: "#181B1A", surface1: "#1f2120", surface2: "#272a29", foreground: "#fafafa", foregroundMuted: "#a1a1aa", accent: "#20744a", border: "#2e3230" };

describe("choice rows", () => {
  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ])("carry no accent and no fill of their own, chosen or not, in the %s theme", (_name, colors) => {
    const plain = choiceRowStyle(colors, false);
    const values = Object.values(plain).map(String);
    expect(values.some((value) => value.toLowerCase().startsWith(colors.accent.toLowerCase()))).toBe(false);
    expect(plain).not.toHaveProperty("backgroundColor");
  });

  it("puts a divider above every row but the first", () => {
    expect(choiceRowStyle(LIGHT, true).borderTopWidth).toBe(0);
    expect(choiceRowStyle(LIGHT, false)).toMatchObject({ borderTopWidth: 1, borderTopColor: LIGHT.border });
  });

  it("fades an unavailable option's content only, never the row and its divider", () => {
    expect(choiceContentOpacity(true)).toBe(0.6);
    expect(choiceContentOpacity(false)).toBe(1);
    expect(choiceRowStyle(LIGHT, false)).not.toHaveProperty("opacity");
  });

  it("holds the rows in one plain box like a text field", () => {
    expect(choiceListStyle(DARK)).toMatchObject({ borderWidth: 1, borderColor: DARK.border, backgroundColor: DARK.surface0 });
  });
});

describe("radio", () => {
  it("is the only place the accent marks the chosen option", () => {
    expect(radioStyle(LIGHT, true).borderColor).toBe(LIGHT.accent);
    expect(radioStyle(LIGHT, false).borderColor).toBe(LIGHT.foregroundMuted);
  });
});

describe("chosen model chip", () => {
  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ])("is an outlined control without accent in the %s theme", (_name, colors) => {
    const control = controlColors(colors);
    const chip = chosenChipColors(colors);
    expect(chip).toEqual({ borderColor: control.border, backgroundColor: control.fill });
    expect(chip.borderColor.toLowerCase().startsWith(colors.accent.toLowerCase())).toBe(false);
    expect(chip.backgroundColor.toLowerCase().startsWith(colors.accent.toLowerCase())).toBe(false);
  });
});
