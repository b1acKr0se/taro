import { describe, expect, it } from "vitest";

import { contrastRatio, rgbOf, type Rgb } from "./control-colors";
import { GITHUB_MERGED, mergedPurple, pullRequestColor } from "./github-colors";

// Card surfaces (`surface0`) of Paseo 0.11.2's themes: light; dark, zinc, midnight, claude, ghostty, pure black.
const LIGHT_CARDS = ["#ffffff"];
const DARK_CARDS = ["#181B1A", "#18181b", "#161820", "#1f1f1e", "#282c34", "#000000"];

function rgb(color: string): Rgb {
  const value = rgbOf(color);
  if (value === null) throw new Error(color);
  return value;
}

describe("mergedPurple", () => {
  it("takes GitHub's dark purple when the foreground is light", () => {
    expect(mergedPurple({ foreground: "#fafafa" })).toBe(GITHUB_MERGED.dark);
    expect(mergedPurple({ foreground: "#fff" })).toBe(GITHUB_MERGED.dark);
  });

  it("takes GitHub's light purple when the foreground is dark", () => {
    expect(mergedPurple({ foreground: "#09090b" })).toBe(GITHUB_MERGED.light);
    expect(mergedPurple({ foreground: "#000000" })).toBe(GITHUB_MERGED.light);
  });

  it("falls back to the light purple for a colour it cannot read", () => {
    expect(mergedPurple({ foreground: "rgb(250, 250, 250)" })).toBe(GITHUB_MERGED.light);
    expect(mergedPurple({ foreground: "" })).toBe(GITHUB_MERGED.light);
  });

  // The purple is the merged icon's alone (TR-119): an icon needs WCAG's 3:1 against the card.
  it("keeps the merged icon at 3:1 on every theme's card", () => {
    for (const card of LIGHT_CARDS) expect(contrastRatio(rgb(mergedPurple({ foreground: "#09090b" })), rgb(card))).toBeGreaterThanOrEqual(3);
    for (const card of DARK_CARDS) expect(contrastRatio(rgb(mergedPurple({ foreground: "#fafafa" })), rgb(card))).toBeGreaterThanOrEqual(3);
  });
});

describe("pullRequestColor (TR-152)", () => {
  const colors = { foreground: "#09090b", foregroundMuted: "#71717a", statusSuccess: "#16a34a", statusDanger: "#dc2626" };

  it("is grey for a draft or an unknown state, the theme's green when ready, its red when closed, GitHub's purple when merged", () => {
    expect(pullRequestColor("muted", colors)).toBe(colors.foregroundMuted);
    expect(pullRequestColor("open", colors)).toBe(colors.statusSuccess);
    expect(pullRequestColor("closed", colors)).toBe(colors.statusDanger);
    expect(pullRequestColor("merged", colors)).toBe(GITHUB_MERGED.light);
    expect(pullRequestColor("merged", { ...colors, foreground: "#fafafa" })).toBe(GITHUB_MERGED.dark);
  });
});
