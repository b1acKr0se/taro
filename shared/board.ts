/**
 * Board columns (decision 9): live agent state wins for urgent facts, the
 * ticket's recorded status decides the rest, and "Stalled" is what only the
 * join can see — work under way with nobody on it. Pure.
 */
import { z } from "zod";

import type { StatusState } from "./reports";

export const COLUMN_IDS = ["needs-you", "working", "stalled", "queued", "done"] as const;
export const ColumnIdSchema = z.enum(COLUMN_IDS);
export type ColumnId = z.infer<typeof ColumnIdSchema>;

export const COLUMN_TITLES: Readonly<Record<ColumnId, string>> = {
  "needs-you": "Needs you",
  working: "Working",
  stalled: "Stalled",
  queued: "Queued",
  done: "Done",
};

export interface CardInputs {
  status: string;
  /** The owner runs on another machine (its EXECUTION record names another host). */
  ownerElsewhere: boolean;
  agent: { status: string; pendingPermissions: number } | null;
  lastStatus: StatusState | null;
  openBlockingDecisions: number;
  /** Two stalls in a row, the second after the plugin's nudge. */
  stalledAfterNudge: boolean;
  /** The owner crashed past the automatic recovery limit (TR-012): only the user can bring it back. */
  crashedOut?: boolean;
}

const UNDER_WAY = new Set(["Planning", "In Progress", "Reviewing"]);

export function boardColumn(card: CardInputs): ColumnId {
  if (card.status === "Done" || card.status === "Cancelled") return "done";
  if (card.ownerElsewhere) return recordedColumn(card.status);

  const agent = card.agent;
  if (agent !== null && agent.pendingPermissions > 0) return "needs-you";
  if (agent !== null && (agent.status === "running" || agent.status === "initializing")) return "working";
  if (card.crashedOut === true) return "stalled";

  if (card.openBlockingDecisions > 0) return "needs-you";
  if (card.status === "Awaiting acceptance" || card.status === "Blocked") return "needs-you";
  if (card.lastStatus === "blocked") return "needs-you";

  if (UNDER_WAY.has(card.status)) {
    if (agent === null || agent.status === "error" || agent.status === "closed") return "stalled";
    if (card.lastStatus === "failed" || card.stalledAfterNudge) return "stalled";
    return "working";
  }
  return "queued";
}

/** A teammate's owner is invisible to this daemon: never call it stalled. */
function recordedColumn(status: string): ColumnId {
  if (status === "Awaiting acceptance" || status === "Blocked") return "needs-you";
  if (UNDER_WAY.has(status)) return "working";
  return "queued";
}

/** The complexity label the owner set (`complexity-low` → `low`), or null. */
export function complexityOf(labels: readonly string[]): string | null {
  const label = labels.find((candidate) => candidate.startsWith("complexity-"));
  return label === undefined ? null : label.slice("complexity-".length);
}
