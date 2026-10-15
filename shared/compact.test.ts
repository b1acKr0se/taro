import { describe, expect, it } from "vitest";

import { offersCompact } from "./compact";

const owner = { status: "idle", contextUsedTokens: 0 };

describe("offersCompact", () => {
  it("only for an idle owner past 150k", () => {
    expect(offersCompact({ parent: null, owner: { ...owner, contextUsedTokens: 150_001 } })).toBe(true);
    expect(offersCompact({ parent: null, owner: { ...owner, contextUsedTokens: 150_000 } })).toBe(false);
    expect(offersCompact({ parent: null, owner: { ...owner, status: "running", contextUsedTokens: 200_000 } })).toBe(false);
    expect(offersCompact({ parent: null, owner: { ...owner, contextUsedTokens: null } })).toBe(false);
    expect(offersCompact({ parent: null, owner: null })).toBe(false);
  });

  it("never for a child, whose owner is its parent's", () => {
    expect(offersCompact({ parent: "NA-027", owner: { ...owner, contextUsedTokens: 200_000 } })).toBe(false);
  });
});
