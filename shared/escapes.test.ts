import { describe, expect, it } from "vitest";

import { escapeLine, escapesReport, parseEscape, sortedEscapes } from "./escapes.ts";

describe("parseEscape", () => {
  it("reads the time as written and the text after the dash", () => {
    expect(parseEscape("NA-7", "ESCAPE 2026-01-06T09:00Z — fixed by NA-14; missed by: x")).toMatchObject({ ticket: "NA-7", time: "2026-01-06T09:00Z", text: "fixed by NA-14; missed by: x" });
  });
  it("treats a date alone as midnight UTC", () => {
    expect(parseEscape("A-1", "ESCAPE 2026-10-22 - text")?.instant).toBe(Date.UTC(2026, 9, 22));
  });
  it("has no time for a record without one", () => {
    expect(parseEscape("A-1", "ESCAPE should have caught it")).toMatchObject({ time: null, instant: null, text: "should have caught it" });
  });
  it("is not an escape when another record starts", () => {
    expect(parseEscape("A-1", "CORRECTION ESCAPE 2026-01-01 — x")).toBeNull();
  });
});

describe("sortedEscapes", () => {
  it("sorts instants newest first and unreadable times last in ticket order", () => {
    const notes = (text: string) => ({ notes: text });
    const sorted = sortedEscapes([
      { id: "A-1", ...notes("ESCAPE no time here") },
      { id: "A-2", ...notes("ESCAPE 2026-10-22 — a") },
      { id: "A-3", ...notes("ESCAPE 2026-11-12T10:10Z — b") },
      { id: "A-4", ...notes("ESCAPE 2026-10-23T09:57Z — c") },
      { id: "A-5", ...notes("ESCAPE 2026-13-45 — bad") },
    ]);
    expect(sorted.map((each) => each.ticket)).toEqual(["A-3", "A-4", "A-2", "A-1", "A-5"]);
  });
});

describe("escapeLine and report", () => {
  it("cuts to 300 characters ending in an ellipsis", () => {
    const line = escapeLine({ ticket: "A-1", time: "2026-01-01", instant: 0, text: "x".repeat(500) });
    expect([...line]).toHaveLength(300);
    expect(line.endsWith("…")).toBe(true);
  });
  it("says none when there are none", () => {
    expect(escapesReport([], 20, "notes-app")).toBe("No escapes recorded in notes-app.\n");
  });
});
