import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blendToWhite, SHIMMER_COPY_LIMIT, shimmerBandLevel, shimmerCopyText, shimmerMetrics, shimmerRuns, fadeColour, visibleLetters, WEB_SHIMMER_COPY_BOX, webShimmerTrack } from "./shimmer";

describe("shimmerMetrics (TR-246)", () => {
  it("runs the band from a band before the words to a band past them, in letters", () => {
    const metrics = shimmerMetrics(30);
    expect(metrics.from).toBe(-metrics.peakLetters);
    expect(metrics.to).toBe(30 + metrics.peakLetters);
  });

  it("sizes the band at 28% of the words, between 32 and 120 px of letters", () => {
    expect(shimmerMetrics(30).peakLetters).toBeCloseTo(8.4);
    expect(shimmerMetrics(2).peakLetters).toBeCloseTo(32 / 7);
    expect(shimmerMetrics(1000).peakLetters).toBeCloseTo(120 / 7);
    expect(shimmerMetrics(0).peakLetters).toBeCloseTo(32 / 7);
  });

  it("takes Paseo's time: quicker for short text, between 1 and 2.3 seconds, however wide the row", () => {
    expect(shimmerMetrics(4).durationMs).toBe(1032);
    expect(shimmerMetrics(13).durationMs).toBe(1354);
    expect(shimmerMetrics(0).durationMs).toBe(1000);
    expect(shimmerMetrics(500).durationMs).toBe(2300);
  });

  it("crosses a short text's own length, not the row's (it ran too fast over a whole row)", () => {
    const short = shimmerMetrics(4);
    expect(short.to - short.from).toBeLessThan(20);
  });

  it("never travels backwards for empty or negative words", () => {
    expect(shimmerMetrics(-5).to).toBe(shimmerMetrics(-5).peakLetters);
  });
});

describe("webShimmerTrack (TR-184)", () => {
  it("runs from a band before the first letter to the last letter, as Paseo's web track", () => {
    expect(webShimmerTrack(20, 520)).toEqual({ peakWidth: 110, trackStart: -90, trackEnd: 520 });
  });

  it("sizes the band at 22% of the words, between 42 and 120", () => {
    expect(webShimmerTrack(0, 100).peakWidth).toBe(42);
    expect(webShimmerTrack(0, 2000).peakWidth).toBe(120);
    expect(webShimmerTrack(0, 300).peakWidth).toBeCloseTo(66);
  });

  it("keeps a band for words not laid out yet or measured backwards", () => {
    expect(webShimmerTrack(0, 0).peakWidth).toBe(42);
    expect(webShimmerTrack(50, 10)).toEqual({ peakWidth: 42, trackStart: 8, trackEnd: 10 });
  });
});

describe("shimmerBandLevel (TR-246)", () => {
  it("is Paseo's gradient: clear at the edges, 45% at a quarter, white across the middle fifth", () => {
    expect(shimmerBandLevel(0)).toBe(0);
    expect(shimmerBandLevel(1)).toBe(0);
    expect(shimmerBandLevel(0.24)).toBeCloseTo(0.45);
    expect(shimmerBandLevel(0.4)).toBeCloseTo(1);
    expect(shimmerBandLevel(0.5)).toBe(1);
    expect(shimmerBandLevel(0.76)).toBeCloseTo(0.45);
  });

  it("rises and falls without a step, and is clear outside the band", () => {
    expect(shimmerBandLevel(-1)).toBe(0);
    expect(shimmerBandLevel(2)).toBe(0);
    expect(shimmerBandLevel(Number.NaN)).toBe(0);
    for (let across = 0.01; across < 0.4; across += 0.01) expect(shimmerBandLevel(across + 0.01)).toBeGreaterThanOrEqual(shimmerBandLevel(across));
  });
});

describe("shimmerRuns (TR-246)", () => {
  const joined = (runs: { text: string }[]) => runs.map((run) => run.text).join("");

  it("keeps every letter in order, whatever the band does", () => {
    for (const position of [-20, -3, 0, 4.5, 9, 14, 40]) expect(joined(shimmerRuns("cd /root/app", 0, position, 8))).toBe("cd /root/app");
  });

  it("leaves letters out of the band as one clear run, however long", () => {
    const runs = shimmerRuns("x".repeat(500), 0, 100, 10);
    expect(runs[0]).toEqual({ text: "x".repeat(100), level: 0 });
    expect(runs.at(-1)?.level).toBe(0);
    expect(runs.length).toBeLessThan(14);
  });

  it("is white at the band's middle and clear at its ends", () => {
    const runs = shimmerRuns("abcdefghijklmnopqrst", 0, 5, 10);
    const levels = new Map(runs.flatMap((run) => Array.from(run.text, (letter) => [letter, run.level] as const)));
    expect(levels.get("j")).toBe(1);
    expect(levels.get("e")).toBe(0);
    expect(levels.get("p")).toBe(0);
  });

  it("is all clear when the band is before or past the words, and for empty text", () => {
    expect(shimmerRuns("abc", 0, -20, 5)).toEqual([{ text: "abc", level: 0 }]);
    expect(shimmerRuns("abc", 0, 30, 5)).toEqual([{ text: "abc", level: 0 }]);
    expect(shimmerRuns("", 0, 0, 5)).toEqual([]);
  });

  it("places a later text by its first letter's place in the words", () => {
    const label = shimmerRuns("Read", 0, 5, 6);
    const summary = shimmerRuns("file.ts", 4, 5, 6);
    expect(label.every((run) => run.level === 0)).toBe(true);
    expect(summary.some((run) => run.level > 0)).toBe(true);
  });

  it("does not split a letter outside the basic plane", () => {
    expect(joined(shimmerRuns("a😀b", 0, 0, 6))).toBe("a😀b");
  });
});

describe("blendToWhite (TR-246)", () => {
  it("leaves the colour alone at level 0 and gives white at level 1", () => {
    expect(blendToWhite("#808080", 0)).toBe("#808080");
    expect(blendToWhite("#808080", 1)).toBe("rgba(255, 255, 255, 1)");
  });

  it("mixes hex, short hex, rgb and rgba colours", () => {
    expect(blendToWhite("#000000", 0.5)).toBe("rgba(128, 128, 128, 1)");
    expect(blendToWhite("#000", 0.5)).toBe("rgba(128, 128, 128, 1)");
    expect(blendToWhite("rgb(0, 0, 0)", 0.5)).toBe("rgba(128, 128, 128, 1)");
    expect(blendToWhite("rgba(0, 0, 0, 0.5)", 1)).toBe("rgba(255, 255, 255, 1)");
    expect(blendToWhite("#00000080", 0.5)).toBe("rgba(128, 128, 128, 0.751)");
  });

  it("turns a colour it cannot read white only past one half", () => {
    expect(blendToWhite("tomato", 0.4)).toBe("tomato");
    expect(blendToWhite("tomato", 0.6)).toBe("#ffffff");
  });
});

describe("WEB_SHIMMER_COPY_BOX (TR-189)", () => {
  it("pins the web's copy to the words' edges, with no measured size to round down", () => {
    expect(WEB_SHIMMER_COPY_BOX).toEqual({ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 });
  });

  it("is where the web's copy sits: a width from layout (a whole pixel) wrapped the copy onto a second line, half a line up", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "loading.tsx"), "utf8");
    const copy = /function WebShimmerCopy[\s\S]*?\n}\n/.exec(source)?.[0] ?? "";
    expect(copy).toContain("WEB_SHIMMER_COPY_BOX");
    expect(copy).not.toMatch(/width: size\.width/);
  });
});

describe("shimmerCopyText", () => {
  it("keeps only the first line of a multi-line command", () => {
    expect(shimmerCopyText("cd app; t=$(date)\ntaro ticket edit\ngo test ./...")).toBe("cd app; t=$(date)");
    expect(shimmerCopyText("one\r\ntwo")).toBe("one");
  });

  it("cuts a very long line and leaves short text and the empty string alone", () => {
    expect(shimmerCopyText("x".repeat(SHIMMER_COPY_LIMIT + 50))).toHaveLength(SHIMMER_COPY_LIMIT);
    expect(shimmerCopyText("go vet")).toBe("go vet");
    expect(shimmerCopyText("")).toBe("");
  });
});

describe("visibleLetters (TR-246)", () => {
  it("crosses a cut-off command's visible row, not its hidden letters", () => {
    const metrics = shimmerMetrics(visibleLetters(120, 340));
    expect(metrics.to - metrics.from).toBeLessThan(340 / 7 + 2 * (120 / 7));
    expect(visibleLetters(120, 340)).toBeCloseTo(340 / 7);
  });

  it("keeps a short text's own length in a wide row, and all letters before the row is measured", () => {
    expect(visibleLetters(4, 340)).toBe(4);
    expect(visibleLetters(120, 0)).toBe(120);
  });
});

describe("fadeColour (TR-246)", () => {
  it("dims a colour by alpha, as the label's opacity did, so a white span on it is not dimmed too", () => {
    expect(fadeColour("#ffffff", 0.72)).toBe("rgba(255, 255, 255, 0.72)");
    expect(fadeColour("rgba(0, 0, 0, 0.5)", 0.5)).toBe("rgba(0, 0, 0, 0.25)");
    expect(fadeColour("tomato", 0.5)).toBe("tomato");
  });
});
