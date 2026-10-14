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
  /** Paused by the user or queued to resume (TR-088): queued again, never Stalled. */
  paused?: boolean;
}

const UNDER_WAY = new Set(["Planning", "In Progress", "Reviewing"]);

export function boardColumn(card: CardInputs): ColumnId {
  if (card.status === "Done" || card.status === "Cancelled") return "done";
  // Accepted, the delivery is the owner's to finish (TR-031): it no longer waits on the user, and is placed like work under way.
  const accepted = card.accepted === true && card.status === "Awaiting acceptance";
  const agent = card.agent;
  // A pause is in the tracker, so it holds on every machine; a live agent here means it was started again.
  if (card.paused === true && (agent === null || agent.status === "closed")) return "queued";
  if (card.ownerElsewhere) return recordedColumn(card.status, accepted);

  if (agent !== null && agent.pendingPermissions > 0) return "needs-you";
  if (agent !== null && (agent.status === "running" || agent.status === "initializing")) return "working";
  if (card.paused === true) return "queued";
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
 * one of those places the card, so the child is Stalled only when none of them is alive. A child
 * not started yet (`status` Queued or Ready) is placed only by its own subagents, never by the
 * parent's owner busy with other work.
 */
export function ticketAgents<Agent extends JoinedAgent>(
  ticketId: string,
  parentId: string | null,
  byTicket: ReadonlyMap<string, readonly Agent[]>,
  status?: string,
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
  // A child not started yet is not what the parent's owner works on (TR-080): only its own subagents place it.
  const placing = status === undefined || hasStarted(status) ? owner : null;
  return { owner, subagents, columnAgent: asking ?? running ?? placing };
}

/** A ticket some agent has taken up: under way, delivered, blocked or finished; Queued and Ready are not. */
export function hasStarted(status: string): boolean {
  return UNDER_WAY.has(status) || status === "Awaiting acceptance" || status === "Blocked" || status === "Done" || status === "Cancelled";
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

/**
 * What waits on the user besides the tickets (TR-064): the Manager's open questions, every board
 * alert and a paused ticket sync. The Needs you column counts them with its tickets.
 */
export function needsYouExtras(board: { managerDecisions: readonly unknown[]; alerts: readonly unknown[] } | null, syncPaused: boolean): number {
  return (board?.managerDecisions.length ?? 0) + (board?.alerts.length ?? 0) + (syncPaused ? 1 : 0);
}

/** A project's Inbox count, on the sidebar and the phone's Inbox tab: its Needs you, and its stalled tickets, which the Inbox lists too. */
export function inboxCount(
  board: { cards: readonly { column: ColumnId }[]; managerDecisions: readonly unknown[]; alerts: readonly unknown[] } | null,
  syncPaused: boolean,
): number {
  const counts = columnCounts(board?.cards ?? [], needsYouExtras(board, syncPaused));
  return counts["needs-you"] + counts.stalled;
}

/**
 * The columns that grow without end and are paged (TR-082): finished and not-started tickets.
 * Needs you, Working and Stalled are small by design and never hide a card.
 */
export const PAGED_COLUMNS = ["queued", "done"] as const satisfies readonly ColumnId[];
export type PagedColumn = (typeof PAGED_COLUMNS)[number];
/** Cards a paged column shows at first, and how many more each Load more adds (the user's sizes, TR-082). */
export const FIRST_PAGE = 5;
export const PAGE_STEP = 20;

export type ColumnLimits = Partial<Record<PagedColumn, number | undefined>>;

export function isPagedColumn(column: ColumnId): column is PagedColumn {
  return (PAGED_COLUMNS as readonly ColumnId[]).includes(column);
}

/** Newest first, the board's order: by last update, then by id so a page boundary is the same on every read. */
export function newestFirst(left: { id: string; updatedAt: string | null }, right: { id: string; updatedAt: string | null }): number {
  return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || right.id.localeCompare(left.id, undefined, { numeric: true });
}

export interface ColumnPage<Placed> {
  /** What to build cards for: every ticket of an unpaged column, each paged column's newest up to its limit, and the included tickets. */
  kept: Placed[];
  /** Each column's true ticket count, paged or not. */
  totals: Record<ColumnId, number>;
  /** Tickets kept only because they were asked for by id: the board leaves them out of their column. */
  offPage: string[];
}

/** Pages the placed tickets (TR-082): the server builds cards only for what this keeps. */
export function pageColumns<Placed extends { id: string; column: ColumnId; updatedAt: string | null }>(
  placed: readonly Placed[],
  limits: ColumnLimits = {},
  include: readonly string[] = [],
): ColumnPage<Placed> {
  const totals: Record<ColumnId, number> = { "needs-you": 0, working: 0, stalled: 0, queued: 0, done: 0 };
  for (const ticket of placed) totals[ticket.column] += 1;
  const onPage = new Set<string>();
  for (const column of PAGED_COLUMNS) {
    const limit = Math.max(0, limits[column] ?? FIRST_PAGE);
    for (const ticket of placed.filter((candidate) => candidate.column === column).sort(newestFirst).slice(0, limit)) onPage.add(ticket.id);
  }
  const wanted = new Set(include);
  const offPage: string[] = [];
  const kept = placed.filter((ticket) => {
    if (!isPagedColumn(ticket.column) || onPage.has(ticket.id)) return true;
    if (!wanted.has(ticket.id)) return false;
    offPage.push(ticket.id);
    return true;
  });
  return { kept, totals, offPage };
}

/** The board's head counts: each column's true total, and in Needs you what else waits on the user (TR-045, TR-064). */
export function boardCounts(totals: Readonly<Record<ColumnId, number>>, needsYouExtra: number): Record<ColumnId, number> {
  return { ...totals, "needs-you": totals["needs-you"] + needsYouExtra };
}
