import { describe, expect, it } from "vitest";

import { BLOCKED_GRACE_MS, ownerBlockedLine } from "./blocked";

const at = "2026-11-12T10:00:00Z";
const file = (state: string) => ({ agents: { owner1: { lastStatus: { state, text: "blocked: delivery reads local", at } } } });
const later = Date.parse(at) + BLOCKED_GRACE_MS;

describe("ownerBlockedLine", () => {
  it("returns the line once a blocked status has stood for the grace period", () => {
    expect(ownerBlockedLine(file("blocked"), "owner1", later)).toBe("blocked: delivery reads local");
  });

  it("waits out the grace period, and ignores other states, other agents and missing files", () => {
    expect(ownerBlockedLine(file("blocked"), "owner1", later - 1)).toBeNull();
    expect(ownerBlockedLine(file("waiting"), "owner1", later)).toBeNull();
    expect(ownerBlockedLine(file("blocked"), "other", later)).toBeNull();
    expect(ownerBlockedLine(null, "owner1", later)).toBeNull();
    expect(ownerBlockedLine({ agents: { owner1: { lastStatus: null } } }, "owner1", later)).toBeNull();
  });
});
