import { describe, expect, it } from "vitest";

import { judgeEvidence, parseEvidence } from "./evidence";

const record = (...lines: string[]) => ["EXECUTION 2026-10-13T10:00Z — owner o", "", "EVIDENCE 2026-10-13T11:00Z — before FINAL", ...lines].join("\n");
const change = (files: string[] = []) => ({ investigation: false, existingFiles: new Set(files) });
const judge = (notes: string | null, options = change()) => judgeEvidence(parseEvidence(notes), options);

describe("parseEvidence and judgeEvidence", () => {
  it("asks for an EVIDENCE record when there are no notes or none of that kind", () => {
    expect(parseEvidence(null)).toBeNull();
    expect(judge(null).missing).toEqual(["an EVIDENCE record"]);
    expect(judge("MILESTONE 2026-10-13T10:00Z — check: npm test — ok").missing).toEqual(["an EVIDENCE record"]);
    expect(judge(null).complete).toBe(false);
  });

  it("completes a change with a check, a review and an existing screenshot", () => {
    const judged = judge(
      record("check: npm test — 37 files, 360 passed", "review: one independent round (Sonnet) — 1 blocker, fixed", "screenshot: board-phone.png — the board on a phone"),
      change(["board-phone.png"]),
    );
    expect(judged).toEqual({
      checks: [{ command: "npm test", result: "37 files, 360 passed" }],
      review: "one independent round (Sonnet) — 1 blocker, fixed",
      screenshots: [{ file: "board-phone.png", caption: "the board on a phone", present: true }],
      screenshotsNone: null,
      missing: [],
      complete: true,
    });
  });

  it("lets the newest record win over an older complete one", () => {
    const older = record("check: npm test — ok", "review: self", "screenshots: none — no visible change");
    const notes = `${older}\n\nEVIDENCE 2026-10-13T12:00Z — again\ncheck: npm run typecheck — clean`;
    expect(judge(notes).missing).toEqual(["the review outcome", "screenshots (or screenshots: none with a reason)"]);
  });

  it("accepts each separator, any label case and a bullet", () => {
    for (const separator of [" — ", " -- ", " - "]) {
      const judged = judge(record(`- CHECK: npm test${separator}12 passed`, `Review: self${separator}clean`, `Screenshots: none${separator}no visible change`));
      expect(judged.checks).toEqual([{ command: "npm test", result: "12 passed" }]);
      expect(judged.screenshotsNone).toBe("no visible change");
      expect(judged.complete).toBe(true);
    }
  });

  it("prefers the em dash, so a command may hold dashes", () => {
    expect(judge(record("check: npm test -- --run — 3 passed")).checks).toEqual([{ command: "npm test -- --run", result: "3 passed" }]);
  });

  it("needs only a check for an investigation", () => {
    const investigation = { investigation: true, existingFiles: new Set<string>() };
    expect(judge(record("check: grep -rn foo src — 2 hits"), investigation).complete).toBe(true);
    expect(judge(record("review: self"), investigation).missing).toEqual(["a check with its result"]);
  });

  it("names a missing screenshot file, and requires every listed one", () => {
    const notes = record("check: npm test — ok", "review: self", "screenshot: a.png — one", "screenshot: b.png — two");
    expect(judge(notes, change(["a.png"])).missing).toEqual(["screenshot file b.png"]);
    expect(judge(notes, change(["a.png", "b.png"])).complete).toBe(true);
  });

  it("rejects a file name with a folder or `..`", () => {
    for (const file of ["sub/a.png", "..\\a.png", "../a.png", "a..png"]) {
      const judged = judge(record("check: x — ok", "review: self", `screenshot: ${file} — c`), change([file, "a.png"]));
      expect(judged.complete).toBe(false);
      expect(judged.screenshots[0]?.present).toBe(false);
      expect(judged.missing[0]).toContain("plain file name");
    }
  });

  it("does not take `screenshots: none` without a reason", () => {
    for (const line of ["screenshots: none", "screenshots: none — "]) {
      const judged = judge(record("check: x — ok", "review: self", line));
      expect(judged.complete).toBe(false);
      expect(judged.screenshotsNone).toBeNull();
      expect(judged.missing).toEqual(["a reason after screenshots: none"]);
    }
  });

  it("holds a listed screenshot to its file even beside `none`", () => {
    const notes = record("check: x — ok", "review: self", "screenshots: none — headless", "screenshot: a.png — c");
    expect(judge(notes).missing).toEqual(["screenshot file a.png"]);
    expect(judge(notes, change(["a.png"])).complete).toBe(true);
  });

  it("does not count a check without a result", () => {
    for (const line of ["check: npm test", "check: npm test — ", "check: npm test -"]) {
      const judged = judge(record(line, "review: self", "screenshots: none — x"));
      expect(judged.checks).toEqual([]);
      expect(judged.missing).toEqual(["a check with its result"]);
    }
  });

  it("ignores other lines", () => {
    expect(judge(record("some prose", "note: x", "check: a — b")).checks).toHaveLength(1);
  });
});
