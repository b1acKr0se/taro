import { describe, expect, it } from "vitest";

import { nodeCheck } from "./prerequisites";

describe("nodeCheck", () => {
  it("fails below 22.18, where the taro command cannot run TypeScript", () => {
    const check = nodeCheck("22.17.1");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("runs TypeScript directly");
    expect(nodeCheck("20.19.0").ok).toBe(false);
  });

  it("passes from 22.18 on", () => {
    expect(nodeCheck("22.18.0").ok).toBe(true);
    expect(nodeCheck("22.20.1").ok).toBe(true);
    expect(nodeCheck("24.3.0").ok).toBe(true);
  });
});
