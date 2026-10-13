import { describe, expect, it } from "vitest";

import { groupRows, toolRunSummary, type ToolRow } from "./tool-runs";
import type { TranscriptRow } from "./transcript-rows";

function tool(key: string, text: string, status: ToolRow["status"] = "completed"): ToolRow {
  return { key, kind: "tool", text, status };
}

describe("groupRows", () => {
  it("joins consecutive tool rows into one run and keeps other rows apart", () => {
    const rows: TranscriptRow[] = [
      { key: "1", kind: "captain", text: "hi" },
      tool("2", "Read a.ts"),
      tool("3", "$ npm test"),
      { key: "4", kind: "mate", text: "done" },
      tool("5", "Edit b.ts"),
    ];
    const groups = groupRows(rows);
    expect(groups.map((group) => ("tools" in group ? group.tools.map((row) => row.key) : group.key))).toEqual(["1", ["2", "3"], "4", ["5"]]);
    expect(groups[1]?.key).toBe("2");
  });

  it("has no groups for no rows", () => {
    expect(groupRows([])).toEqual([]);
  });
});

describe("toolRunSummary", () => {
  it("shows a lone call as itself", () => {
    expect(toolRunSummary([tool("1", "$ ls")])).toEqual({ title: "$ ls", latest: null, state: "done", failed: 0 });
  });

  it("counts a run and names its latest call", () => {
    expect(toolRunSummary([tool("1", "Read a"), tool("2", "Read b"), tool("3", "$ npm test")])).toEqual({
      title: "3 tool calls",
      latest: "$ npm test",
      state: "done",
      failed: 0,
    });
  });

  it("says a run with a running call is running, even when another failed", () => {
    expect(toolRunSummary([tool("1", "a", "failed"), tool("2", "b", "running")]).state).toBe("running");
  });

  it("says a finished run with a failure failed, and how many", () => {
    const summary = toolRunSummary([tool("1", "a", "failed"), tool("2", "b"), tool("3", "c", "failed")]);
    expect(summary.state).toBe("failed");
    expect(summary.failed).toBe(2);
  });
});
