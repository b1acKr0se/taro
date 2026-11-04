import { describe, expect, it } from "vitest";
import { acceptHandoffOpen, acceptStallReason } from "./accept-stall";

const ACCEPTED = "ACCEPTED 2026-11-04T01:05Z — I accept TR-9; merging: yes";
const HANDOFF = "ACCEPT-HANDOFF 2026-11-04T01:05Z — Same owner: the plugin stopped";

describe("acceptHandoffOpen", () => {
  it("is open while a hand-off is the newest Accept record", () => {
    expect(acceptHandoffOpen(`${ACCEPTED}\n\n${HANDOFF}`)).toBe(true);
    expect(acceptHandoffOpen(`${ACCEPTED}\n\n${HANDOFF}\n\nMILESTONE 2026-11-04T01:06Z — pushed`)).toBe(true);
  });

  it("closes on an outcome, a new Accept, changes or a new delivery", () => {
    for (const later of ["ACCEPTANCE 2026-11-04T01:09Z — merged", "NOT-MERGED 2026-11-04T01:09Z — why", "CHANGES-REQUESTED 2026-11-04T01:09Z — more", "ACCEPTED 2026-11-04T01:09Z — again"])
      expect(acceptHandoffOpen(`${ACCEPTED}\n\n${HANDOFF}\n\n${later}`)).toBe(false);
  });

  it("is closed with no hand-off or no notes", () => {
    expect(acceptHandoffOpen(ACCEPTED)).toBe(false);
    expect(acceptHandoffOpen(null)).toBe(false);
  });
});

describe("acceptStallReason", () => {
  it("names the turns and the pull request", () => {
    expect(acceptStallReason(3, "Pull request https://example.com/pull/1 now reads OPEN")).toMatch(/ended 3 turns.*OPEN.*Accept/);
  });
});
