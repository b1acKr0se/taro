import { describe, expect, it } from "vitest";

import { futureRecordTime } from "./record-time";

const NOW = new Date("2026-10-14T16:45:23.000Z");

describe("futureRecordTime", () => {
  it("refuses a record stamped an hour ahead, naming it and the host's time (TR-069's REVIEW)", () => {
    const problem = futureRecordTime("REVIEW 2026-10-14T17:40Z — self-review, no findings", NOW);
    expect(problem).toContain("REVIEW 2026-10-14T17:40Z is later than the host clock (now 2026-10-14T16:45Z)");
    expect(problem).toContain("date -u +%Y-%m-%dT%H:%MZ");
  });

  it("refuses just past the two-minute tolerance, with seconds, milliseconds or no Z", () => {
    expect(futureRecordTime("MILESTONE 2026-10-14T16:47:24Z — x", NOW)).not.toBeNull();
    expect(futureRecordTime("MILESTONE 2026-10-14T16:48:00.001Z — x", NOW)).not.toBeNull();
    expect(futureRecordTime("MILESTONE 2026-10-14T16:48 — x", NOW)).not.toBeNull();
  });

  it("accepts now, a time within the tolerance, the past, and the plugin's own ISO times", () => {
    expect(futureRecordTime("MILESTONE 2026-10-14T16:45Z — x", NOW)).toBeNull();
    expect(futureRecordTime("MILESTONE 2026-10-14T16:47:23Z — x", NOW)).toBeNull();
    expect(futureRecordTime("EVIDENCE 2026-10-13T23:59Z — yesterday", NOW)).toBeNull();
    expect(futureRecordTime(`QUEUE-WAKE ${NOW.toISOString()} — the plugin told the Manager`, NOW)).toBeNull();
  });

  it("accepts text without a record time, and future times that are not at a record line's start", () => {
    expect(futureRecordTime("", NOW)).toBeNull();
    expect(futureRecordTime("plain note 2026-10-14T18:00Z", NOW)).toBeNull();
    expect(futureRecordTime("MILESTONE — no time", NOW)).toBeNull();
    const correction = "CORRECTION 2026-10-14T16:45Z — future-dated records:\n- REVIEW 2026-10-14T17:40Z was written at 16:43Z";
    expect(futureRecordTime(correction, NOW)).toBeNull();
  });

  it("checks every record line of a multi-record text and a bold FINAL heading", () => {
    expect(futureRecordTime("MILESTONE 2026-10-14T16:40Z — a\n\nEVIDENCE 2026-10-14T18:05Z — b", NOW)).toContain("EVIDENCE 2026-10-14T18:05Z");
    expect(futureRecordTime("**FINAL** 2026-10-14T17:40Z\n## What changed", NOW)).toContain("FINAL 2026-10-14T17:40Z");
  });
});
