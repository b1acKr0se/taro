import { describe, expect, it } from "vitest";

import { PHONE_LIST_END, SPACE } from "./spacing";

describe("PHONE_LIST_END", () => {
  it("leaves a gap above an iPhone's home indicator, the deepest bottom inset", () => {
    expect(PHONE_LIST_END).toBeGreaterThanOrEqual(34 + SPACE.md);
  });

  it("is more than the list's side padding, so the end reads as the end", () => {
    expect(PHONE_LIST_END).toBeGreaterThan(SPACE.md);
  });
});
