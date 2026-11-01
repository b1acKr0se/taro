import { describe, expect, it } from "vitest";

import { acceptHandedToOwner, acceptRefusal } from "./accept-guard";

const ticket = (notes: string, extra: Partial<{ status: string; parent: string | null }> = {}) => ({ id: "FF-5", status: "Awaiting acceptance", parent: null, notes, ...extra });
const FINAL = "EVIDENCE 2026-10-28T18:00Z — checks pass";
const HANDOFF = "ACCEPT-HANDOFF 2026-10-28T19:00Z — Same owner. The plugin stopped: a conflict";

describe("acceptRefusal (TR-237)", () => {
  it("refuses Done and an ACCEPTANCE record when the user pressed no Accept (the FF-005 case)", () => {
    const notes = `${FINAL}\nUSER-MESSAGE — contracts upgraded and prod deployed. can you do the verification?`;
    expect(acceptRefusal(ticket(notes), { status: "Done", appendNotes: [] })).toMatch(/only the user's press of Accept/);
    expect(acceptRefusal(ticket(notes), { status: undefined, appendNotes: ['ACCEPTANCE 2026-10-28T18:32Z — user: "since you merged"'] })).not.toBeNull();
  });

  it("lets an owner close once the plugin handed Accept over", () => {
    const notes = `${FINAL}\nACCEPTED 2026-10-28T19:00Z — the user accepted; merging: the pull request\n${HANDOFF}`;
    expect(acceptRefusal(ticket(notes), { status: "Done", appendNotes: ["ACCEPTANCE x; merge: merged abc"] })).toBeNull();
  });

  it("stops allowing it once the work is presented or changes are requested again", () => {
    for (const later of [FINAL, "CHANGES-REQUESTED x — the user: fix", "NOT-MERGED x — dirty checkout"]) {
      expect(acceptHandedToOwner(`${HANDOFF}\n${later}`)).toBe(false);
    }
    expect(acceptHandedToOwner(`${HANDOFF}\nACCEPTANCE x`)).toBe(true);
  });

  it("does not carry a hand-off over from before a reopen", () => {
    expect(acceptHandedToOwner(`${HANDOFF}\nREOPENED x — again`)).toBe(false);
  });

  it("never lets an agent write the plugin's proof", () => {
    for (const record of ["ACCEPTED x — the user accepted; merging: none", HANDOFF]) {
      expect(acceptRefusal(ticket(HANDOFF), { status: undefined, appendNotes: [record] })).toMatch(/plugin's proof/);
    }
  });

  it("leaves children, other statuses, ordinary notes and an already Done ticket alone", () => {
    expect(acceptRefusal(ticket("", { parent: "FF-1" }), { status: "Done", appendNotes: [] })).toBeNull();
    expect(acceptRefusal(ticket(""), { status: "In Progress", appendNotes: ["MILESTONE x"] })).toBeNull();
    expect(acceptRefusal(ticket("", { status: "Done" }), { status: "Done", appendNotes: [] })).toBeNull();
  });
});
