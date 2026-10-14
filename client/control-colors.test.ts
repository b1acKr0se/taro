import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CONTROL_BORDER_CONTRAST, contrastRatio, controlColors, over, rgbOf, type Rgb } from "./control-colors";

/** Paseo's own themes (0.11.2), the tokens a plugin is given. */
const THEMES = {
  light: { surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", border: "#e4e4e7", foreground: "#1a1a1e" },
  dark: { surface0: "#181B1A", surface1: "#1E2120", surface2: "#272A29", border: "#252B2A", foreground: "#e6e6e6" },
  zinc: { surface0: "#18181b", surface1: "#1f1f22", surface2: "#27272a", border: "#27272a", foreground: "#e6e6e6" },
  midnight: { surface0: "#161820", surface1: "#1c1e27", surface2: "#252731", border: "#242636", foreground: "#e6e6e6" },
  claude: { surface0: "#1f1f1e", surface1: "#262523", surface2: "#2f2d2b", border: "#2c2a27", foreground: "#e6e6e6" },
  slate: { surface0: "#282c34", surface1: "#2f333d", surface2: "#383c48", border: "#353a47", foreground: "#e6e6e6" },
  black: { surface0: "#000000", surface1: "#0a0a0a", surface2: "#111111", border: "#1c1c1c", foreground: "#e6e6e6" },
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
  }

  it("takes the least border alpha that reaches 3:1, so the outline is no heavier than needed", () => {
    for (const theme of Object.values(THEMES)) {
      const alpha = parseInt(controlColors(theme).border.slice(7, 9), 16) / 255;
      const lighter = alpha - 0.03;
      const worst = Math.min(...SURFACES.map((surface) => contrastRatio(over(rgbOf(theme.foreground) as Rgb, rgbOf(theme[surface]) as Rgb, lighter), rgbOf(theme[surface]) as Rgb)));
      if (lighter >= 0.3) expect(worst).toBeLessThan(CONTROL_BORDER_CONTRAST);
    }
  });

  it("falls back to a fixed alpha when the theme's colours are not hex", () => {
    const colors = controlColors({ surface0: "rgb(0, 0, 0)", surface1: "#111111", surface2: "#222222", foreground: "#eeeeee" });
    expect(colors.border).toBe("#eeeeee73");
    expect(controlColors({ surface0: "#000000", surface1: "#111111", surface2: "#222222", foreground: "white" })).toEqual({ fill: "white", border: "white" });
  });
});

describe("outlined controls", () => {
  // Every outlined control takes its fill and border from controlColors, not from the panel's own tokens.
  const files = ["ui.tsx", "option-chips.tsx", "suggestion-pills.tsx", "agent-chips.tsx", "board.tsx", "sync-problem-card.tsx", "permission-card.tsx"];
  for (const file of files) {
    it(`${file} draws its controls with controlColors`, () => {
      expect(readFileSync(join(__dirname, file), "utf8")).toContain("controlColors(");
    });
  }
  for (const file of ["agent-chat.tsx", "owner-pane.tsx"]) {
    it(`${file} draws its row's button with rowButtonStyle`, () => {
      expect(readFileSync(join(__dirname, file), "utf8")).toContain("rowButtonStyle(");
    });
  }
});
