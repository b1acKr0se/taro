import { describe, expect, it } from "vitest";

import { checkEvidenceLine, checkLogLine, checksAtHead, parseCheckLog, summaryLine, ticketFromBranch, type CheckEntry } from "./check-log";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);

function entry(overrides: Partial<CheckEntry> = {}): CheckEntry {
  return { at: "2026-11-12T07:00:00.000Z", command: "npm test", exitCode: 0, summary: "Tests 12 passed", head: HEAD, dirty: false, ...overrides };
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
