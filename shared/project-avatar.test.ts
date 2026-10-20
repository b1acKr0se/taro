import { describe, expect, it } from "vitest";

import { AVATAR_COLORS, avatarColor, avatarLetter, avatarRadius } from "./project-avatar";

describe("avatarColor", () => {
  it("is stable for a name and always one of the ten tones", () => {
    expect(avatarColor("notes-app")).toBe(avatarColor("notes-app"));
    for (const name of ["a", "billing-api", "mobile-client-redesign", "", "日本語"]) expect(AVATAR_COLORS).toContain(avatarColor(name));
  });

  it("matches Paseo's hash (31 * hash + char, 32 bits, modulo ten)", () => {
    // "a" = 97 -> 7 -> red; "ab" = 97 * 31 + 98 = 3105 -> 5 -> indigo; "" = 0 -> violet.
    expect(avatarColor("a")).toBe("#b06260");
    expect(avatarColor("ab")).toBe("#6a70b8");
    expect(avatarColor("")).toBe("#7a6aa8");
  });

  it("keeps a very long name inside the table", () => {
    expect(AVATAR_COLORS).toContain(avatarColor("x".repeat(5000)));
  });
});

describe("avatarLetter", () => {
  it("is the upper-cased first letter", () => {
    expect(avatarLetter("notes-app")).toBe("N");
    expect(avatarLetter("  docs")).toBe("D");
    expect(avatarLetter("3d-viewer")).toBe("3");
  });

  it("takes a whole character, not half of a surrogate pair, and shows ? for nothing", () => {
    expect(avatarLetter("😀fun")).toBe("😀");
    expect(avatarLetter("éclair")).toBe("É");
    expect(avatarLetter("")).toBe("?");
    expect(avatarLetter("   ")).toBe("?");
  });
});

describe("avatarRadius", () => {
  it("is a quarter of the box, rounded", () => {
    expect(avatarRadius(18)).toBe(5);
    expect(avatarRadius(40)).toBe(10);
  });
});
