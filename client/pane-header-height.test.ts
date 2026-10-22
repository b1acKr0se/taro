import { describe, expect, it } from "vitest";

import { PANE_HEADER_HEIGHT, SPACE } from "./spacing";


describe("PANE_HEADER_HEIGHT", () => {
  it("holds a title over a subtitle with the pane's padding, so a ticket's header and the board's bar meet (TR-224)", () => {
    expect(PANE_HEADER_HEIGHT).toBeGreaterThan(2 * SPACE.md + 16 + 12);
  });
});
