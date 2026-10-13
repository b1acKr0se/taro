import { describe, expect, it } from "vitest";

import { kindLabel, milestoneRows } from "./milestone-rows";

// Built from local dates so the test holds in any time zone.
const now = new Date(2026, 9, 13, 18, 0).getTime();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

describe("kindLabel", () => {
  it("writes a record kind in plain words", () => {
    expect(kindLabel("MILESTONE")).toBe("Milestone");
    expect(kindLabel("DISPATCH-INTENT")).toBe("Dispatch intent");
    expect(kindLabel("")).toBe("");
  });
});

describe("milestoneRows", () => {
  it("heads the first row of each day and no other", () => {
    const rows = milestoneRows(
      [
        { kind: "DISPATCH-INTENT", time: at(12, 9), text: "a" },
        { kind: "EXECUTION", time: at(12, 9, 5), text: "b" },
        { kind: "APPROVAL", time: at(13, 10), text: "c" },
        { kind: "MILESTONE", time: at(13, 11), text: "d" },
      ],
      now,
    );
    expect(rows.map((row) => row.day)).toEqual(["Yesterday", null, "Today", null]);
    expect(rows.map((row) => row.clock)).toEqual(["09:00", "09:05", "10:00", "11:00"]);
  });

  it("keeps the current day across a record without a time", () => {
    const rows = milestoneRows(
      [
        { kind: "MILESTONE", time: at(13, 9), text: "a" },
        { kind: "MILESTONE", time: null, text: "b" },
        { kind: "MILESTONE", time: at(13, 10), text: "c" },
      ],
      now,
    );
    expect(rows.map((row) => row.day)).toEqual(["Today", null, null]);
    expect(rows[1]?.clock).toBeNull();
  });

  it("colours only the records a reader looks for", () => {
    const kinds = ["APPROVAL", "REVIEW", "FINAL", "ACCEPTANCE", "RECOVERY", "MILESTONE", "EXECUTION", "ANSWER", "HANDOFF", "DISPATCH-INTENT", "ODD"];
    const rows = milestoneRows(
      kinds.map((kind) => ({ kind, time: null, text: "" })),
      now,
    );
    expect(rows.filter((row) => row.key).map((row) => row.kind)).toEqual(["APPROVAL", "REVIEW", "FINAL", "ACCEPTANCE", "RECOVERY"]);
  });

  it("has no rows for no records", () => {
    expect(milestoneRows([], now)).toEqual([]);
  });
});
