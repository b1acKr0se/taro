import { describe, expect, it } from "vitest";

import { milestoneRowId, milestoneRows, recentMilestoneRows } from "./milestone-rows";

// Built from local dates so the test holds in any time zone.
const now = new Date(2026, 9, 13, 18, 0).getTime();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

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

describe("recentMilestoneRows", () => {
  const records = (n: number) => Array.from({ length: n }, (_, index) => ({ kind: "MILESTONE", time: at(13, 9, index), text: `m${index}` }));

  it("has nothing for zero records", () => {
    expect(recentMilestoneRows([], false, now)).toEqual({ rows: [], older: 0 });
  });

  it("shows exactly 3 newest first, nothing folded", () => {
    const { rows, older } = recentMilestoneRows(records(3), false, now);
    expect(rows.map((row) => row.text)).toEqual(["m2", "m1", "m0"]);
    expect(older).toBe(0);
  });

  it("folds the oldest of 4, and shows it when asked", () => {
    expect(recentMilestoneRows(records(4), false, now)).toMatchObject({ older: 1 });
    expect(recentMilestoneRows(records(4), false, now).rows.map((row) => row.text)).toEqual(["m3", "m2", "m1"]);
    expect(recentMilestoneRows(records(4), true, now).rows.map((row) => row.text)).toEqual(["m3", "m2", "m1", "m0"]);
  });

  it("heads the newest day first", () => {
    const rows = recentMilestoneRows([{ kind: "MILESTONE", time: at(12, 9), text: "a" }, { kind: "MILESTONE", time: at(13, 9), text: "b" }], false, now).rows;
    expect(rows.map((row) => row.day)).toEqual(["Today", "Yesterday"]);
  });

  it("keeps each record's id when a newer record arrives, though every row moves down", () => {
    const before = recentMilestoneRows(records(4), true, now).rows;
    const after = recentMilestoneRows(records(5), true, now).rows;
    const idOf = (rows: typeof before, text: string) => rows.find((row) => row.text === text)?.id;
    // m2 was the second row and is now the third: an index key would open m3 instead.
    expect(before.findIndex((row) => row.text === "m2")).toBe(1);
    expect(after.findIndex((row) => row.text === "m2")).toBe(2);
    expect(idOf(after, "m2")).toBe(idOf(before, "m2"));
    expect(new Set(after.map((row) => row.id)).size).toBe(5);
  });

  it("keeps the ids of folded and shown rows the same", () => {
    expect(recentMilestoneRows(records(5), false, now).rows.map((row) => row.id)).toEqual(recentMilestoneRows(records(5), true, now).rows.slice(0, 3).map((row) => row.id));
  });
});

describe("milestoneRowId", () => {
  it("is the position from the oldest, the kind and the time", () => {
    expect(milestoneRowId(0, { kind: "MILESTONE", time: "2026-10-13T09:00:00Z" })).toBe("0:MILESTONE:2026-10-13T09:00:00Z");
    expect(milestoneRowId(3, { kind: "FINAL", time: null })).toBe("3:FINAL:");
  });

  it("tells apart two records of one kind and time", () => {
    const record = { kind: "MILESTONE", time: null };
    expect(milestoneRowId(1, record)).not.toBe(milestoneRowId(2, record));
  });
});
