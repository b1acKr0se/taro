/**
 * Tool calls between the agent's words (TR-018). A run of consecutive calls is the agent working,
 * not talking, so the chat folds it to one line — what it did in plain words, whether one runs or
 * failed — and the reader opens it for the raw calls, one line each (TR-144).
 */
import type { TranscriptRow } from "./transcript-rows";
import { toolTally } from "./tool-wording";

export type ToolRow = Extract<TranscriptRow, { kind: "tool" }>;

export type Group = { key: string; row: TranscriptRow } | { key: string; tools: ToolRow[] };

/** Rows to groups: consecutive tool rows become one run, every other row stands alone. */
export function groupRows(rows: readonly TranscriptRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (row.kind === "tool" && last !== undefined && "tools" in last) last.tools.push(row);
    else if (row.kind === "tool") groups.push({ key: row.key, tools: [row] });
    else groups.push({ key: row.key, row });
  }
  return groups;
}

export interface ToolRunSummary {
  /** What the run did in plain words (TR-144): "Searched twice, read 4 files", or a lone call's own words. */
  title: string;
  /** A running call wins over a failed one: the run is still going. */
  state: "running" | "failed" | "done";
  failed: number;
}

export function toolRunSummary(tools: readonly ToolRow[]): ToolRunSummary {
  const failed = tools.filter((tool) => tool.status === "failed").length;
  const state = tools.some((tool) => tool.status === "running") ? "running" : failed > 0 ? "failed" : "done";
  const only = tools.length === 1 ? tools[0] : undefined;
  return { title: only !== undefined ? only.plain : toolTally(tools.map((tool) => tool.category)), state, failed };
}
