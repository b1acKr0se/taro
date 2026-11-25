import { describe, expect, it } from "vitest";

import { shownAfter, SPINNER_DELAY_MS } from "./delayed-flag";

describe("shownAfter", () => {
  it("shows nothing while the flag is off", () => {
    expect(shownAfter(false, null, 1000)).toBe(false);
    // Turned off: whatever the time it was on since.
    expect(shownAfter(false, 1000, 5000)).toBe(false);
  });

  it("shows the flag only once it has been on for half a second", () => {
    expect(SPINNER_DELAY_MS).toBe(500);
    expect(shownAfter(true, 1000, 1000)).toBe(false);
    expect(shownAfter(true, 1000, 1499)).toBe(false);
    expect(shownAfter(true, 1000, 1500)).toBe(true);
  });

  it("follows the delay it is given", () => {
    expect(shownAfter(true, 1000, 1100, 100)).toBe(true);
    expect(shownAfter(true, 1000, 1099, 100)).toBe(false);
  });
});
