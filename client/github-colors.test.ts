import { describe, expect, it } from "vitest";

import { GITHUB_MERGED, mergedPurple } from "./github-colors";

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
});
