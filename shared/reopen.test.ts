import { describe, expect, it } from "vitest";

import { noteRecords } from "./execution";
import { closeRoundRefusal, currentRound, reopenedRecordText, reopenRefusal, reopenRound, roundBranch, roundClosedRecordText, roundNotes } from "./reopen";

const ROUND_ONE = "EXECUTION 2026-10-01T10:00Z — owner aaaaaaaa-1111-4111-8111-111111111111, branch taro/tr-9\n\nACCEPTANCE 2026-10-02T10:00Z — merge: merged 0a1b2c3";
const reopened = (round: number, note = "verify it on prod") => `REOPENED 2026-10-0${round + 2}T10:00Z — user: "${note}"; round ${round}; past owners: none`;

describe("reopenRefusal", () => {
  const facts = { status: "Done", parent: null, note: "verify it on prod" };
  it("offers Reopen on a Done top-level ticket with a note", () => {
    expect(reopenRefusal("TR-9", facts)).toBeNull();
  });
  it("refuses every other status", () => {
    for (const status of ["Queued", "In Progress", "Cancelled", "Awaiting acceptance"]) {
      expect(reopenRefusal("TR-9", { ...facts, status })).toBe(`TR-9 is ${status}: only a Done ticket can be reopened.`);
    }
  });
  it("refuses a child: its parent is reopened instead", () => {
    expect(reopenRefusal("TR-9.1", { ...facts, parent: "TR-9" })).toBe("TR-9.1 is part of TR-9; reopen TR-9 instead.");
  });
  it("refuses an empty or whitespace note", () => {
    expect(reopenRefusal("TR-9", { ...facts, note: "" })).toBe("Say what the owner should do first.");
    expect(reopenRefusal("TR-9", { ...facts, note: " \n\t " })).toBe("Say what the owner should do first.");
  });
});

describe("currentRound and reopenRound", () => {
  it("keeps the whole notes in round 1 when nothing reopened them", () => {
    expect(currentRound(ROUND_ONE)).toBe(ROUND_ONE);
    expect(roundNotes(ROUND_ONE)).toBe(ROUND_ONE);
    expect(reopenRound(ROUND_ONE)).toBe(1);
    expect(currentRound(null)).toBeNull();
    expect(reopenRound(null)).toBe(1);
  });
  it("starts the round at the one REOPENED record", () => {
    const notes = `${ROUND_ONE}\n\n${reopened(2)}\n\nMILESTONE 2026-10-04T10:00Z — reading the old transcript`;
    expect(currentRound(notes)).toBe(`${reopened(2)}\n\nMILESTONE 2026-10-04T10:00Z — reading the old transcript`);
    expect(roundNotes(notes)).toBe("MILESTONE 2026-10-04T10:00Z — reading the old transcript");
    expect(reopenRound(notes)).toBe(2);
  });
  it("starts it at the latest of two REOPENED records", () => {
    const notes = `${ROUND_ONE}\n\n${reopened(2)}\n\nACCEPTANCE 2026-10-05T10:00Z — merge: none\n\n${reopened(3)}`;
    expect(currentRound(notes)).toBe(reopened(3));
    expect(roundNotes(notes)).toBe("");
    expect(reopenRound(notes)).toBe(3);
  });
  it("reads notes that open with REOPENED", () => {
    expect(currentRound(reopened(2))).toBe(reopened(2));
    expect(roundNotes(`${reopened(2)}\n\nEVIDENCE 2026-10-04T10:00Z — x`)).toBe("EVIDENCE 2026-10-04T10:00Z — x");
  });
  it("does not take REOPENED inside a line for a record", () => {
    expect(reopenRound("MILESTONE 2026-10-04T10:00Z — REOPENED by hand")).toBe(1);
  });
});

describe("the REOPENED record", () => {
  it("names the round and the past owners", () => {
    expect(reopenedRecordText({ at: "2026-10-24T03:00:00.000Z", note: "  check it on prod  ", round: 2, pastOwners: ["a", "b"], finalSummary: null })).toBe(
      'REOPENED 2026-10-24T03:00:00.000Z — user: "check it on prod"; round 2; past owners: a, b',
    );
    expect(reopenedRecordText({ at: "2026-10-24T03:00Z", note: "x", round: 3, pastOwners: [], finalSummary: "" })).toBe('REOPENED 2026-10-24T03:00Z — user: "x"; round 3; past owners: none');
  });
  it("keeps the earlier FINAL and a many-line note indented, so they stay one record", () => {
    const finalSummary = "FINAL 2026-10-02T10:00Z — shipped the export\nPR: https://github.com/acme/notes-app/pull/12\n\nREVIEW clean";
    const text = reopenedRecordText({ at: "2026-10-24T03:00Z", note: "check prod\nEVIDENCE too", round: 2, pastOwners: [], finalSummary });
    expect(text).toBe(
      'REOPENED 2026-10-24T03:00Z — user: "check prod\n  EVIDENCE too"; round 2; past owners: none\nprevious FINAL:\n  FINAL 2026-10-02T10:00Z — shipped the export\n  PR: https://github.com/acme/notes-app/pull/12\n\n  REVIEW clean',
    );
    expect(noteRecords(text)).toHaveLength(1);
  });
});

describe("roundBranch", () => {
  it("names the first round's branch as before and later ones with their number", () => {
    expect(roundBranch("TR-229", 1)).toBe("taro/tr-229");
    expect(roundBranch("TR-229", 2)).toBe("taro/tr-229-2");
  });
});

describe("closeRoundRefusal", () => {
  const facts = { status: "In Progress", parent: null, round: 2 };
  it("allows every status of a reopened round not yet delivered, in round 2 and round 3", () => {
    for (const status of ["Queued", "Planning", "Ready", "In Progress", "Reviewing", "Blocked"]) {
      for (const round of [2, 3]) expect(closeRoundRefusal("TR-9", { ...facts, status, round })).toBeNull();
    }
  });
  it("refuses a round 1 ticket: it was never reopened", () => {
    expect(closeRoundRefusal("TR-9", { ...facts, round: 1 })).toBe("TR-9 was never reopened: there is no round to close.");
  });
  it("refuses a delivered, Done or Cancelled ticket", () => {
    expect(closeRoundRefusal("TR-9", { ...facts, status: "Awaiting acceptance" })).toBe("TR-9 is awaiting your acceptance: accept it or request changes instead.");
    expect(closeRoundRefusal("TR-9", { ...facts, status: "Done" })).toBe("TR-9 is Done: its round is over.");
    expect(closeRoundRefusal("TR-9", { ...facts, status: "Cancelled", round: 3 })).toBe("TR-9 is Cancelled: its round is over.");
  });
  it("refuses a child: its parent's round is closed instead", () => {
    expect(closeRoundRefusal("TR-9.1", { ...facts, parent: "TR-9" })).toBe("TR-9.1 is part of TR-9; close TR-9's round instead.");
  });
});

describe("the ROUND-CLOSED record", () => {
  it("names the branch kept unmerged", () => {
    expect(roundClosedRecordText({ at: "2026-10-24T03:00Z", round: 2, branch: "taro/tr-9-2" })).toBe(
      "ROUND-CLOSED 2026-10-24T03:00Z — round 2 closed by the user; nothing from this round was merged; branch taro/tr-9-2 kept unmerged",
    );
  });
  it("leaves out a branch no owner started", () => {
    expect(roundClosedRecordText({ at: "2026-10-24T03:00Z", round: 3, branch: null })).toBe("ROUND-CLOSED 2026-10-24T03:00Z — round 3 closed by the user; nothing from this round was merged");
  });
});
