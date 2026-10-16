/**
 * Tool calls between the agent's words (TR-018). A run of consecutive calls is the agent working,
 * not talking, so the chat folds it to one line of Paseo's counts, whether one runs or failed, and
 * the reader opens it for the calls, one line each, as Paseo shows them (TR-150). A lone call is its
 * own line, as in Paseo.
 */
import type { TranscriptRow } from "./transcript-rows";
import { toolRunTitle } from "./tool-wording";

export type ToolRow = Extract<TranscriptRow, { kind: "tool" }>;

export type Group = { key: string; row: TranscriptRow } | { key: string; tools: ToolRow[] };

/** Rows to groups: consecutive tool rows become one run, every other row (and a plan) stands alone. */
export function groupRows(rows: readonly TranscriptRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const run = last !== undefined && "tools" in last && last.tools.every((tool) => !tool.alone) ? last : undefined;
    if (row.kind === "tool" && !row.alone && run !== undefined) run.tools.push(row);
    else if (row.kind === "tool") groups.push({ key: row.key, tools: [row] });
    else groups.push({ key: row.key, row });
  }
  return groups;
}

export interface ToolRunSummary {
  /** Paseo's counts (TR-150): "Ran 2 commands, read 1 file, and used 1 other tool". */
  title: string;
  /** A running call wins over a failed one: the run is still going. */
  state: "running" | "failed" | "done";
  failed: number;
}

export function toolRunSummary(tools: readonly ToolRow[]): ToolRunSummary {
  const failed = tools.filter((tool) => tool.status === "failed").length;
  const state = tools.some((tool) => tool.status === "running") ? "running" : failed > 0 ? "failed" : "done";
  return { title: toolRunTitle(tools.map((tool) => tool.tally)), state, failed };
}
