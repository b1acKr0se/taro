import { describe, expect, it } from "vitest";

import { remindsAtCount, waitsForAcceptance, waitsPrematurely } from "./premature-wait";

describe("waitsForAcceptance", () => {
  it("reads a waiting status line that mentions accepting or merging", () => {
    expect(waitsForAcceptance({ state: "waiting", text: "user's accept" })).toBe(true);
    expect(waitsForAcceptance({ state: "waiting", text: "PR #11 open, waiting for acceptance" })).toBe(true);
    expect(waitsForAcceptance({ state: "waiting", text: "user to merge" })).toBe(true);
  });
  it("ignores other waits and states", () => {
    expect(waitsForAcceptance({ state: "waiting", text: "implementer SC-1.2" })).toBe(false);
    expect(waitsForAcceptance({ state: "working", text: "accept card" })).toBe(false);
    expect(waitsForAcceptance(null)).toBe(false);
  });
});

describe("waitsPrematurely", () => {
  const status = { state: "waiting", text: "user's accept" };
  it("is true while the ticket is still being worked on", () => {
    expect(waitsPrematurely(status, "Planning")).toBe(true);
    expect(waitsPrematurely(status, "In progress")).toBe(true);
  });
  it("is false when delivered or closed", () => {
    expect(waitsPrematurely(status, "Awaiting acceptance")).toBe(false);
    expect(waitsPrematurely(status, "Done")).toBe(false);
  });
});

describe("remindsAtCount", () => {
  it("backs off", () => {
    expect([1, 2, 3, 4, 5, 8, 9].map(remindsAtCount)).toEqual([true, true, false, true, false, true, false]);
    expect(remindsAtCount(0)).toBe(false);
  });
});
