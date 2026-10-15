import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CONTROL_BORDER_CONTRAST, contrastRatio, controlColors, over, rgbOf, type Rgb } from "./control-colors";

/** Paseo's own themes (0.11.2), the tokens a plugin is given. */
const THEMES = {
  light: { surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", border: "#e4e4e7", foreground: "#1a1a1e", accent: "#20744A" },
  dark: { surface0: "#181B1A", surface1: "#1E2120", surface2: "#272A29", border: "#252B2A", foreground: "#e6e6e6", accent: "#20744A" },
  zinc: { surface0: "#18181b", surface1: "#1f1f22", surface2: "#27272a", border: "#27272a", foreground: "#e6e6e6", accent: "#e4e4e7" },
  midnight: { surface0: "#161820", surface1: "#1c1e27", surface2: "#252731", border: "#242636", foreground: "#e6e6e6", accent: "#3b6fcf" },
  claude: { surface0: "#1f1f1e", surface1: "#262523", surface2: "#2f2d2b", border: "#2c2a27", foreground: "#e6e6e6", accent: "#d97757" },
  slate: { surface0: "#282c34", surface1: "#2f333d", surface2: "#383c48", border: "#353a47", foreground: "#e6e6e6", accent: "#89b4fa" },
  black: { surface0: "#000000", surface1: "#0a0a0a", surface2: "#111111", border: "#1c1c1c", foreground: "#e6e6e6", accent: "#20744A" },
};

/** A `#rrggbbaa` colour drawn over an opaque one. */
function shown(color: string, under: Rgb): Rgb {
  const alpha = parseInt(color.slice(7, 9), 16) / 255;
  return over(rgbOf(color.slice(0, 7)) as Rgb, under, alpha);
}

const SURFACES = ["surface0", "surface1", "surface2"] as const;

describe("controlColors", () => {
  it("reproduces TR-093: the old fill and border vanish on the summary panel (surface1)", () => {
    const theme = THEMES.claude;
    const panel = rgbOf(theme.surface1) as Rgb;
    expect(contrastRatio(rgbOf(theme.surface1) as Rgb, panel)).toBeLessThan(1.05);
    expect(contrastRatio(rgbOf(theme.border) as Rgb, panel)).toBeLessThan(1.1);
  });

  for (const [name, theme] of Object.entries(THEMES)) {
    it(`gives the border at least 3:1 and a visible fill on every surface of the ${name} theme`, () => {
      const { fill, border } = controlColors(theme);
      for (const surface of SURFACES) {
        const under = rgbOf(theme[surface]) as Rgb;
        // Measured over the bare surface: the fill under it only adds contrast.
        expect(contrastRatio(shown(border, under), under)).toBeGreaterThanOrEqual(CONTROL_BORDER_CONTRAST);
        expect(contrastRatio(shown(fill, under), under)).toBeGreaterThanOrEqual(1.15);
      }
    });

    it(`gives an accent outline at least 3:1 and a chosen tab more lift than a plain one in the ${name} theme`, () => {
      const { fill, selectedFill, accentBorder } = controlColors(theme);
      for (const surface of SURFACES) {
        const under = rgbOf(theme[surface]) as Rgb;
        expect(contrastRatio(rgbOf(accentBorder) as Rgb, under)).toBeGreaterThanOrEqual(CONTROL_BORDER_CONTRAST);
        expect(contrastRatio(shown(selectedFill, under), under)).toBeGreaterThan(contrastRatio(shown(fill, under), under) + 0.1);
      }
    });
  }

  it("takes the least border alpha that reaches 3:1, so the outline is no heavier than needed", () => {
    for (const theme of Object.values(THEMES)) {
      const alpha = parseInt(controlColors(theme).border.slice(7, 9), 16) / 255;
      const lighter = alpha - 0.03;
      const worst = Math.min(...SURFACES.map((surface) => contrastRatio(over(rgbOf(theme.foreground) as Rgb, rgbOf(theme[surface]) as Rgb, lighter), rgbOf(theme[surface]) as Rgb)));
      if (lighter >= 0.3) expect(worst).toBeLessThan(CONTROL_BORDER_CONTRAST);
    }
  });

  it("keeps the theme's accent where it already reaches 3:1, and lifts Paseo's default dark accent only as far as needed", () => {
    expect(controlColors(THEMES.claude).accentBorder).toBe(THEMES.claude.accent);
    expect(controlColors(THEMES.light).accentBorder).toBe(THEMES.light.accent);
    const lifted = controlColors(THEMES.dark).accentBorder;
    expect(lifted).not.toBe(THEMES.dark.accent);
    const worst = Math.min(...SURFACES.map((surface) => contrastRatio(rgbOf(lifted) as Rgb, rgbOf(THEMES.dark[surface]) as Rgb)));
    expect(worst).toBeLessThan(CONTROL_BORDER_CONTRAST + 0.15);
  });

  it("falls back to fixed colours when the theme's colours are not hex", () => {
    const colors = controlColors({ surface0: "rgb(0, 0, 0)", surface1: "#111111", surface2: "#222222", foreground: "#eeeeee", accent: "#3366ff" });
    expect(colors.border).toBe("#eeeeee73");
    expect(colors.accentBorder).toBe("#3366ff");
    expect(controlColors({ surface0: "#000000", surface1: "#111111", surface2: "#222222", foreground: "white", accent: "green" })).toEqual({
      fill: "white",
      selectedFill: "white",
      border: "white",
      accentBorder: "green",
    });
  });
});

/** The style object named `key` in a file's source, from its brace to the matching one. */
function styleBlock(file: string, key: string): string {
  const text = readFileSync(join(__dirname, file), "utf8");
  const start = text.indexOf(`${key}: {`);
  if (start < 0) throw new Error(`${file} has no style ${key}`);
  let depth = 0;
  for (let index = text.indexOf("{", start); index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  throw new Error(`${file}: ${key} never closes`);
}

describe("outlined controls", () => {
  // Each control's own style takes its outline and fill from controlColors, never the panel's tokens (TR-093).
  const controls: ReadonlyArray<[file: string, key: string]> = [
    ["ui.tsx", "button"],
    ["ui.tsx", "frame"],
    ["ui.tsx", "selected"],
    ["option-chips.tsx", "chip"],
    ["suggestion-pills.tsx", "suggestion"],
    ["board.tsx", "chip"],
    ["sync-problem-card.tsx", "ticket"],
    ["sync-problem-card.tsx", "option"],
    ["permission-card.tsx", "tab"],
  ];
  for (const [file, key] of controls) {
    it(`${file} draws ${key} with the control colours`, () => {
      const style = styleBlock(file, key);
      expect(style).toMatch(/borderColor: (tone === "accent" \? colors\.accent : )?control\.border/);
      expect(style).not.toMatch(/colors\.(border|surface1|surface2)\b/);
    });
  }

  it("draws the agent chips' outline from the control colours, chosen or not", () => {
    const source = readFileSync(join(__dirname, "agent-chips.tsx"), "utf8");
    expect(source.match(/borderColor: selected \? control\.accentBorder : control\.border/g)).toHaveLength(2);
    expect(source).not.toMatch(/colors\.(border|surface1)\b/);
  });

  for (const [file, key] of [["ticket-card.tsx", "action"], ["question-card.tsx", "action"], ["option-chips.tsx", "recommended"]] as const) {
    it(`${file} outlines ${key} with the 3:1 accent`, () => {
      expect(styleBlock(file, key)).toMatch(/borderColor: (controlColors\(colors\)|control)\.accentBorder/);
    });
  }

  it("raises a chosen permission tab above the others", () => {
    expect(styleBlock("permission-card.tsx", "tabActive")).toContain("control.selectedFill");
  });

  for (const file of ["agent-chat.tsx", "owner-pane.tsx"]) {
    it(`${file} draws its row's button with rowButtonStyle`, () => {
      expect(readFileSync(join(__dirname, file), "utf8")).toContain("rowButtonStyle(");
    });
  }
});
