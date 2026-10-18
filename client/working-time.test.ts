import { describe, expect, it } from "vitest";

import { workingElapsed } from "./working-time";

const START = "2026-01-01T12:00:00Z";
const at = (ms: number) => Date.parse(START) + ms;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe("workingElapsed", () => {
  it("reads <1m through the first minute and changes at its end", () => {
    expect(workingElapsed(START, at(0))).toEqual({ text: "<1m", nextChangeMs: MINUTE });
    expect(workingElapsed(START, at(59 * SECOND))).toEqual({ text: "<1m", nextChangeMs: SECOND });
  });

  it("counts whole minutes, rounded down, changing on each minute", () => {
    expect(workingElapsed(START, at(MINUTE))).toEqual({ text: "1m", nextChangeMs: MINUTE });
    expect(workingElapsed(START, at(MINUTE + 59 * SECOND))).toEqual({ text: "1m", nextChangeMs: SECOND });
    expect(workingElapsed(START, at(59 * MINUTE + 30 * SECOND))).toEqual({ text: "59m", nextChangeMs: 30 * SECOND });
  });

  it("counts whole hours from an hour, changing once an hour", () => {
    expect(workingElapsed(START, at(HOUR))).toEqual({ text: "1h", nextChangeMs: HOUR });
    expect(workingElapsed(START, at(2 * HOUR + 59 * MINUTE))).toEqual({ text: "2h", nextChangeMs: MINUTE });
    expect(workingElapsed(START, at(23 * HOUR + 59 * MINUTE))).toEqual({ text: "23h", nextChangeMs: MINUTE });
  });

  it("reads days and hours from a day", () => {
    expect(workingElapsed(START, at(24 * HOUR))).toEqual({ text: "1d 0h", nextChangeMs: HOUR });
    expect(workingElapsed(START, at(76 * HOUR + 10 * MINUTE))).toEqual({ text: "3d 4h", nextChangeMs: 50 * MINUTE });
  });

  it("reads <1m for a start ahead of this clock, until a minute past it", () => {
    expect(workingElapsed(START, at(-5 * SECOND))).toEqual({ text: "<1m", nextChangeMs: MINUTE + 5 * SECOND });
  });

  it("is null when the start is unknown or unreadable", () => {
    for (const started of [null, undefined, "", "garbage"]) expect(workingElapsed(started, at(MINUTE))).toBeNull();
  });
});
