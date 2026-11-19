import { describe, expect, it } from "vitest";

import { checkEvidenceLine, checkLogLine, checksAtHead, parseCheckLog, reusableCheck, strayChanges, strayWarning, summaryLine, ticketFromBranch, type CheckEntry } from "./check-log";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);

function entry(overrides: Partial<CheckEntry> = {}): CheckEntry {
  return { at: "2026-11-12T07:00:00.000Z", command: "npm test", exitCode: 0, summary: "Tests 12 passed", head: HEAD, dirty: false, untracked: false, prefix: "", ...overrides };
}

describe("summaryLine", () => {
  it("takes the runner's last summary line, colour codes removed", () => {
    const vitest = "\u001b[32m✓\u001b[39m a.test.ts (3)\n\n Test Files  4 passed (4)\n      Tests  12 passed (12)\n   Duration  1.2s\n";
    expect(summaryLine(vitest, "")).toBe("Tests 12 passed (12)");
  });

  it("falls back to standard error, then to the last line printed", () => {
    expect(summaryLine("", "src/a.ts(3,1): error TS2322: nope\nFound 1 error.\n")).toBe("Found 1 error.");
    expect(summaryLine("built in 3s\n", "")).toBe("built in 3s");
    expect(summaryLine("", "")).toBe("");
  });

  it("clips a long line", () => {
    expect(summaryLine(`${"x".repeat(300)} passed`, "").length).toBe(200);
  });
});

describe("ticketFromBranch", () => {
  it("reads Taro's branches, a reopened round's included", () => {
    expect(ticketFromBranch("taro/tr-263")).toBe("TR-263");
    expect(ticketFromBranch("taro/tr-263.04")).toBe("TR-263.04");
    expect(ticketFromBranch("taro/sh-12-2")).toBe("SH-12");
    expect(ticketFromBranch("main")).toBeNull();
    expect(ticketFromBranch("feature/tr-1")).toBeNull();
  });
});

describe("the check log", () => {
  it("round-trips entries and skips broken lines", () => {
    const text = `${checkLogLine(entry())}not json\n${checkLogLine(entry({ exitCode: null, head: null }))}`;
    expect(parseCheckLog(text)).toEqual([entry(), entry({ exitCode: null, head: null })]);
  });

  it("writes an EVIDENCE check line with the exit code and summary", () => {
    expect(checkEvidenceLine(entry())).toBe("check: npm test — exit 0; Tests 12 passed");
    expect(checkEvidenceLine(entry({ exitCode: 1, summary: "" }))).toBe("check: npm test — exit 1");
    expect(checkEvidenceLine(entry({ exitCode: null }))).toBe("check: npm test — killed; Tests 12 passed");
  });

  it("offers the newest run of each command at the head, leaving out other commits and uncommitted runs", () => {
    const entries = [
      entry({ summary: "first" }),
      entry({ command: "npm run typecheck", summary: "ok" }),
      entry({ summary: "second" }),
      entry({ command: "npm run lint", head: OTHER }),
      entry({ command: "npm run build", dirty: true }),
    ];
    const { offered, others } = checksAtHead(entries, HEAD);
    expect(offered.map((each) => `${each.command}: ${each.summary}`)).toEqual(["npm run typecheck: ok", "npm test: second"]);
    expect(others).toBe(2);
    expect(checksAtHead(entries, null).offered).toHaveLength(4);
  });
});

describe("reusableCheck", () => {
  it("answers with the newest clean pass of that command at that commit", () => {
    const pass = entry({ at: "2026-11-12T07:00:00.000Z" });
    expect(reusableCheck([pass], "npm test", HEAD)).toBe(pass);
  });

  it("never reuses a failed newest run, another commit, a dirty run, another command or no head", () => {
    expect(reusableCheck([entry(), entry({ exitCode: 1 })], "npm test", HEAD)).toBeNull();
    expect(reusableCheck([entry({ exitCode: null })], "npm test", HEAD)).toBeNull();
    expect(reusableCheck([entry()], "npm test", OTHER)).toBeNull();
    expect(reusableCheck([entry({ dirty: true })], "npm test", HEAD)).toBeNull();
    expect(reusableCheck([entry()], "npm run typecheck", HEAD)).toBeNull();
    expect(reusableCheck([entry({ head: null })], "npm test", null)).toBeNull();
  });

  it("never reuses a run made beside untracked files or from another directory", () => {
    expect(reusableCheck([entry({ untracked: true })], "npm test", HEAD)).toBeNull();
    expect(reusableCheck([entry({ prefix: "web/" })], "npm test", HEAD, "api/")).toBeNull();
    expect(reusableCheck([entry({ prefix: "web/" })], "npm test", HEAD, "web/")).not.toBeNull();
  });

  it("reuses a pass that came after an earlier failure", () => {
    const pass = entry({ at: "2026-11-12T08:00:00.000Z" });
    expect(reusableCheck([entry({ exitCode: 1 }), pass], "npm test", HEAD)).toBe(pass);
  });
});

describe("strayChanges and strayWarning", () => {
  it("splits tracked changes from untracked files", () => {
    expect(strayChanges(" M frontend/tsconfig.tsbuildinfo\n?? notes.txt\nA  src/a.ts\n")).toEqual({ tracked: ["frontend/tsconfig.tsbuildinfo", "src/a.ts"], untracked: ["notes.txt"] });
    expect(strayChanges("")).toEqual({ tracked: [], untracked: [] });
  });

  it("warns by name, shortens a long list and stays silent on a clean tree", () => {
    expect(strayWarning({ tracked: [], untracked: [] })).toBeNull();
    expect(strayWarning({ tracked: ["a", "b", "c", "d", "e"], untracked: [] })).toContain("a, b, c, 2 more");
    expect(strayWarning({ tracked: [], untracked: ["x.log"] })).toContain("x.log");
  });
});
