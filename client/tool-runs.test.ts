import { describe, expect, it } from "vitest";

import { groupRows, toolRunSummary, type ToolRow } from "./tool-runs";
import type { TranscriptRow } from "./transcript-rows";
import type { ToolTally } from "./tool-wording";

function tool(key: string, status: ToolRow["status"] = "completed", tally: ToolTally = { kind: "command" }, alone = false): ToolRow {
  return { key, kind: "tool", text: `Shell ${key}`, label: "Shell", summary: key, icon: "SquareTerminal", tally, alone, status };
}

describe("groupRows", () => {
  it("joins consecutive tool rows into one run and keeps other rows apart", () => {
    const rows: TranscriptRow[] = [{ key: "1", kind: "user", text: "hi" }, tool("2"), tool("3"), { key: "4", kind: "agent", text: "done" }, tool("5")];
    const groups = groupRows(rows);
    expect(groups.map((group) => ("tools" in group ? group.tools.map((row) => row.key) : group.key))).toEqual(["1", ["2", "3"], "4", ["5"]]);
    expect(groups[1]?.key).toBe("2");
  });

  it("keeps a call Paseo shows alone (a plan) out of the runs on either side", () => {
    const groups = groupRows([tool("1"), tool("2", "completed", { kind: "other" }, true), tool("3"), tool("4")]);
    expect(groups.map((group) => ("tools" in group ? group.tools.map((row) => row.key) : group.key))).toEqual([["1"], ["2"], ["3", "4"]]);
  });

  it("has no groups for no rows", () => {
    expect(groupRows([])).toEqual([]);
  });
});

describe("toolRunSummary", () => {
  it("counts a run as Paseo does", () => {
    const run = [tool("1", "completed", { kind: "read", filePath: "/a.ts" }), tool("2"), tool("3", "completed", { kind: "read", filePath: "/b.ts" }), tool("4", "completed", { kind: "other" })];
    expect(toolRunSummary(run)).toEqual({ title: "Ran 1 command, read 2 files, and used 1 other tool", state: "done", failed: 0 });
  });

  it("says a run with a running call is running, even when another failed", () => {
    expect(toolRunSummary([tool("1", "failed"), tool("2", "running")]).state).toBe("running");
  });

  it("says a finished run with a failure failed, and how many", () => {
    const summary = toolRunSummary([tool("1", "failed"), tool("2"), tool("3", "failed")]);
    expect(summary.state).toBe("failed");
    expect(summary.failed).toBe(2);
  });
});
