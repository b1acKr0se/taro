import { describe, expect, it } from "vitest";

import { finalSections } from "./final-summary";

const BASE = `FINAL 2026-10-20T11:00Z

## What changed
- Notes export

## How it was verified
- Tests pass

## Limitations
- None known.`;

describe("finalSections", () => {
  it("reads Rulings after Limitations", () => {
    const sections = finalSections(`${BASE}\n\n## Rulings\n- Used YAML — the usual choice — rename the field\n- Kept the old flag — less churn — remove it later\n\nRevision: abc · PR: none`);
    expect(sections?.rulings).toEqual(["Used YAML — the usual choice — rename the field", "Kept the old flag — less churn — remove it later"]);
    expect(sections?.limitations).toEqual(["None known."]);
    expect(sections?.rest).toBe("Revision: abc · PR: none");
  });

  it("a FINAL without Rulings parses as before", () => {
    expect(finalSections(BASE)).toEqual({ changed: ["Notes export"], verified: ["Tests pass"], limitations: ["None known."], rest: "" });
  });
});
