import { describe, expect, it } from "vitest";

import { parseSuggestions } from "./suggestions";

describe("parseSuggestions", () => {
  it("reads label :: prompt lines and skips notes", () => {
    const text = "<!-- - Not :: this -->\n- Accept SC-3 :: Accept SC-003\n* Review it :: Run a review on SC-004\nplain line\n";
    expect(parseSuggestions(text)).toEqual([
      { label: "Accept SC-3", prompt: "Accept SC-003" },
      { label: "Review it", prompt: "Run a review on SC-004" },
    ]);
  });
});
