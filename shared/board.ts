/**
 * Board columns (decision 9): live agent state wins for urgent facts, the
 * ticket's recorded status decides the rest, and "Stalled" is what only the
 * join can see — work under way with nobody on it. Pure.
 */
import { z } from "zod";

import { isSubagentRole, roleFromLabel, TARO_LABELS } from "./project";
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

/** How a column's head is drawn: a Lucide icon, the tone it is coloured in, and a short hint of what its cards wait on. */
export interface ColumnMeta {
  icon: string;
  tone: "accent" | "success" | "warning" | "danger" | "muted";
  hint: string;
}

export const COLUMN_META: Readonly<Record<ColumnId, ColumnMeta>> = {
  "needs-you": { icon: "Hand", tone: "warning", hint: "your move" },
  working: { icon: "Activity", tone: "success", hint: "agent running" },
  stalled: { icon: "CircleAlert", tone: "danger", hint: "idle, no reason" },
  queued: { icon: "Clock", tone: "muted", hint: "not started" },
  done: { icon: "CircleCheck", tone: "success", hint: "accepted" },
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
  /** The user pressed Accept and the owner has not set Done yet (TR-031): it is merging, not waiting on the user. */
  accepted?: boolean;
}

const UNDER_WAY = new Set(["Planning", "In Progress", "Reviewing"]);

export function boardColumn(card: CardInputs): ColumnId {
  if (card.status === "Done" || card.status === "Cancelled") return "done";
  // Accepted, the delivery is the owner's to finish (TR-031): it no longer waits on the user, and is placed like work under way.
  const accepted = card.accepted === true && card.status === "Awaiting acceptance";
  if (card.ownerElsewhere) return recordedColumn(card.status, accepted);

  const agent = card.agent;
  if (agent !== null && agent.pendingPermissions > 0) return "needs-you";
  if (agent !== null && (agent.status === "running" || agent.status === "initializing")) return "working";
  if (card.crashedOut === true) return "stalled";

  if (card.openBlockingDecisions > 0) return "needs-you";
  if (waitsOnUser(card.status, accepted)) return "needs-you";
  if (card.lastStatus === "blocked") return "needs-you";

  if (UNDER_WAY.has(card.status) || accepted) {
    if (agent === null || agent.status === "error" || agent.status === "closed") return "stalled";
    if (card.lastStatus === "failed" || card.stalledAfterNudge) return "stalled";
    return "working";
  }
  return "queued";
}

function waitsOnUser(status: string, accepted: boolean): boolean {
  return (status === "Awaiting acceptance" && !accepted) || status === "Blocked";
}

/** A teammate's owner is invisible to this daemon: never call it stalled. */
function recordedColumn(status: string, accepted: boolean): ColumnId {
  if (waitsOnUser(status, accepted)) return "needs-you";
  if (UNDER_WAY.has(status) || accepted) return "working";
  return "queued";
}

/** The fields of a live agent the board joins a card on. */
export interface JoinedAgent {
  labels: Readonly<Record<string, string>>;
  title?: string | null;
  status: string;
  updatedAt: string;
  pendingPermissions: readonly unknown[];
}

export interface TicketAgents<Agent> {
  owner: Agent | null;
  subagents: Agent[];
  /** Whose live state places the card. */
  columnAgent: Agent | null;
}

/**
 * The live agents on a ticket, from agents grouped by their ticket label. A child has no owner of
 * its own (decision 32): its parent's owner works it through subagents labelled with the child, or
 * labelled with the parent and titled with the child's id ("TR-1.01 · implementer: …"), and a busy
 * one of those places the card, so the child is Stalled only when none of them is alive.
 */
export function ticketAgents<Agent extends JoinedAgent>(
  ticketId: string,
  parentId: string | null,
  byTicket: ReadonlyMap<string, readonly Agent[]>,
): TicketAgents<Agent> {
  const own = byTicket.get(ticketId) ?? [];
  const parents = parentId === null ? [] : byTicket.get(parentId) ?? [];
  const namedForChild = parents.filter((agent) => agent.title?.startsWith(`${ticketId} `) === true);
  const subagents = [...own, ...namedForChild].filter((agent) => {
    const role = roleFromLabel(agent.labels[TARO_LABELS.role]);
    return role !== null && isSubagentRole(role);
  });
  const owner = newestOwner(own) ?? newestOwner(parents);
  if (parentId === null) return { owner, subagents, columnAgent: owner };
  const asking = newest(subagents.filter((agent) => agent.pendingPermissions.length > 0));
  const running = newest(subagents.filter((agent) => agent.status === "running" || agent.status === "initializing"));
  return { owner, subagents, columnAgent: asking ?? running ?? owner };
}

function newestOwner<Agent extends JoinedAgent>(agents: readonly Agent[]): Agent | null {
  return newest(agents.filter((agent) => agent.labels[TARO_LABELS.role] === "owner" && agent.status !== "closed"));
}

function newest<Agent extends JoinedAgent>(agents: readonly Agent[]): Agent | null {
  return [...agents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

/** The complexity label the owner set (`complexity-low` → `low`), or null. */
export function complexityOf(labels: readonly string[]): string | null {
  const label = labels.find((candidate) => candidate.startsWith("complexity-"));
  return label === undefined ? null : label.slice("complexity-".length);
}

/** How many cards each column shows: its tickets, and in Needs you the Manager's open questions too (TR-045). */
export function columnCounts(cards: readonly { column: ColumnId }[], managerQuestions: number): Record<ColumnId, number> {
  const counts: Record<ColumnId, number> = { "needs-you": managerQuestions, working: 0, stalled: 0, queued: 0, done: 0 };
  for (const card of cards) counts[card.column] += 1;
  return counts;
}
