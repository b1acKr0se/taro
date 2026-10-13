/**
 * Tool calls between the agent's words (TR-018). A run of consecutive calls is the agent working,
 * not talking, so the chat folds it to one line — how many calls, the latest, whether one runs or
 * failed — and the reader opens it only when they want the detail.
 */
import type { TranscriptRow } from "./transcript-rows";

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
  /** "3 tool calls", or the one call's own line when the run holds one. */
  title: string;
  /** The latest call, shown after the count; null when the title already is it. */
  latest: string | null;
  /** A running call wins over a failed one: the run is still going. */
  state: "running" | "failed" | "done";
  failed: number;
}

export function toolRunSummary(tools: readonly ToolRow[]): ToolRunSummary {
  const failed = tools.filter((tool) => tool.status === "failed").length;
  const state = tools.some((tool) => tool.status === "running") ? "running" : failed > 0 ? "failed" : "done";
  const last = tools[tools.length - 1];
  if (tools.length === 1 && last !== undefined) return { title: last.text, latest: null, state, failed };
  return { title: `${tools.length} tool calls`, latest: last?.text ?? null, state, failed };
}
