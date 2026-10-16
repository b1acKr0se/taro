/**
 * Board columns (decision 9): live agent state wins for urgent facts, the
 * ticket's recorded status decides the rest, and "Stalled" is what only the
 * join can see — work under way with nobody on it. Pure.
 */
import { z } from "zod";

import { isSubagentRole, roleFromLabel, TARO_LABELS } from "./project";
import type { StatusState } from "./reports";

/**
 * Where a card is placed. Parked tickets (TR-166) are placed apart from Queued, so Queued means
 * "starts next", but the board draws them as a folded section at the end of the Queued column, not
 * as a column of their own: `BOARD_COLUMNS` are the columns it draws.
 */
export const COLUMN_IDS = ["needs-you", "working", "stalled", "queued", "parked", "done"] as const;
export const ColumnIdSchema = z.enum(COLUMN_IDS);
export type ColumnId = z.infer<typeof ColumnIdSchema>;
export const BOARD_COLUMNS = ["needs-you", "working", "stalled", "queued", "done"] as const satisfies readonly ColumnId[];
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const COLUMN_TITLES: Readonly<Record<ColumnId, string>> = {
  "needs-you": "Needs you",
  working: "Working",
  stalled: "Stalled",
  queued: "Queued",
  parked: "Parked",
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
  queued: { icon: "Clock", tone: "muted", hint: "starts next" },
  parked: { icon: "SquareParking", tone: "muted", hint: "until you resume" },
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
  /** Parked by the user (TR-088, TR-166): apart from Queued until Resume, never Stalled. */
  parked?: boolean;
  /** Resumed with no free slot (TR-088): queued again, never Stalled. */
  queuedToResume?: boolean;
}

const UNDER_WAY = new Set(["Planning", "In Progress", "Reviewing"]);

export function boardColumn(card: CardInputs): ColumnId {
  if (card.status === "Done" || card.status === "Cancelled") return "done";
  // Accepted, the delivery is the owner's to finish (TR-031): it no longer waits on the user, and is placed like work under way.
  const accepted = card.accepted === true && card.status === "Awaiting acceptance";
  const agent = card.agent;
  // A park is in the tracker, so it holds on every machine; a live agent here means it was started again.
  const idle = agent === null || agent.status === "closed";
  if (card.parked === true && idle) return "parked";
  if (card.queuedToResume === true && idle) return "queued";
  if (card.ownerElsewhere) return recordedColumn(card.status, accepted);

  if (agent !== null && agent.pendingPermissions > 0) return "needs-you";
  const running = agent !== null && (agent.status === "running" || agent.status === "initializing");
  // An open question stays the user's move while its owner replies to other messages (TR-134).
  if (running && card.openBlockingDecisions > 0) return "needs-you";
  if (running) return "working";
  if (card.parked === true) return "parked";
  if (card.queuedToResume === true) return "queued";
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
  /** The agents waiting on a permission for this ticket, the one the card shows first leading (TR-096). */
  askers: Agent[];
}

/**
 * The live agents on a ticket, from agents grouped by their ticket label. A child has no owner of
 * its own (decision 32): its parent's owner works it through subagents labelled with the child, or
 * labelled with the parent and titled with the child's id ("TR-1.01 · implementer: …"), and a busy
 * one of those places the card, so the child is Stalled only when none of them is alive. A child
 * not started yet (`status` Queued or Ready) is placed only by its own subagents, never by the
 * parent's owner busy with other work. Any of a ticket's agents asking permission places it (TR-096):
 * the owner's ask comes first, then its subagents', newest first.
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
  const asking = byNewest(subagents.filter(asks));
  if (parentId === null) {
    // A subagent titled for a child asks on the child's card alone, so one request is not counted twice.
    const forThis = asking.filter((agent) => titledTicket(agent.title) === null || titledTicket(agent.title) === ticketId);
    const askers = owner !== null && asks(owner) ? [owner, ...forThis] : forThis;
    return { owner, subagents, columnAgent: askers[0] ?? owner, askers };
  }
  const running = newest(subagents.filter((agent) => agent.status === "running" || agent.status === "initializing"));
  // A child not started yet is not what the parent's owner works on (TR-080): only its own subagents place it.
  const placing = status === undefined || hasStarted(status) ? owner : null;
  const columnAgent = asking[0] ?? running ?? placing;
  // The parent's owner asks about the child only while nothing else of the child's is under way.
  return { owner, subagents, columnAgent, askers: columnAgent !== null && columnAgent === placing && asks(placing) ? [placing] : asking };
}

/** The ticket id a title starts with ("TR-1.01 · implementer: …"), or null. */
function titledTicket(title: string | null | undefined): string | null {
  return /^([A-Z][A-Z0-9]*-\d+(?:\.\d+)*)\s/.exec(title ?? "")?.[1] ?? null;
}

function asks(agent: JoinedAgent): boolean {
  return agent.pendingPermissions.length > 0;
}

/** A ticket some agent has taken up: under way, delivered, blocked or finished; Queued and Ready are not. */
export function hasStarted(status: string): boolean {
  return UNDER_WAY.has(status) || status === "Awaiting acceptance" || status === "Blocked" || status === "Done" || status === "Cancelled";
}

/** The live owner the board shows; the ticket view acts on the same one (TR-095). */
export function newestOwner<Agent extends JoinedAgent>(agents: readonly Agent[]): Agent | null {
  return newest(agents.filter((agent) => agent.labels[TARO_LABELS.role] === "owner" && agent.status !== "closed"));
}

function newest<Agent extends JoinedAgent>(agents: readonly Agent[]): Agent | null {
  return byNewest(agents)[0] ?? null;
}

function byNewest<Agent extends JoinedAgent>(agents: readonly Agent[]): Agent[] {
  return [...agents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** The complexity label the owner set (`complexity-low` → `low`), or null. */
export function complexityOf(labels: readonly string[]): string | null {
  const label = labels.find((candidate) => candidate.startsWith("complexity-"));
  return label === undefined ? null : label.slice("complexity-".length);
}

/** How many cards each column shows: its tickets, and in Needs you the manager's open questions too (TR-045). */
export function columnCounts(cards: readonly { column: ColumnId }[], managerQuestions: number): Record<ColumnId, number> {
  const counts: Record<ColumnId, number> = { "needs-you": managerQuestions, working: 0, stalled: 0, queued: 0, parked: 0, done: 0 };
  for (const card of cards) counts[card.column] += 1;
  return counts;
}

/**
 * What waits on the user besides the tickets (TR-064): the manager's open questions, a permission
 * the manager's side waits on (TR-096), every board alert and a paused ticket sync. The Needs you column counts them with its tickets.
 */
export function needsYouExtras(board: { managerDecisions: readonly unknown[]; managerPermission?: unknown; alerts: readonly unknown[] } | null, syncPaused: boolean): number {
  const managerAsks = board?.managerPermission === undefined || board.managerPermission === null ? 0 : 1;
  return (board?.managerDecisions.length ?? 0) + managerAsks + (board?.alerts.length ?? 0) + (syncPaused ? 1 : 0);
}

/** A ticket the Inbox lists as itself: one waiting on you with no question, which is drawn as that question instead, or a stalled one. */
export function isInboxTicket(card: { column: ColumnId; decisions: readonly unknown[] }): boolean {
  return (card.column === "needs-you" && card.decisions.length === 0) || card.column === "stalled";
}

/**
 * A project's Inbox count, on the sidebar, the project tabs and the Inbox tab (TR-064, TR-123): one for
 * each card the Inbox lists. Every open question counts, the manager's and those on tickets, blocking or
 * not, several on one ticket each; a ticket waiting on you with no question (acceptance, Blocked, a
 * permission) and a stalled ticket count once; so do each alert, the manager's waiting permission and a
 * paused sync.
 */
export function inboxCount(
  board: {
    cards: readonly { column: ColumnId; decisions: readonly unknown[] }[];
    managerDecisions: readonly unknown[];
    ticketQuestions?: number;
    managerPermission?: unknown;
    alerts: readonly unknown[];
  } | null,
  syncPaused: boolean,
): number {
  const waiting = (board?.cards ?? []).filter(isInboxTicket).length;
  return needsYouExtras(board, syncPaused) + (board?.ticketQuestions ?? 0) + waiting;
}

/**
 * The columns that grow without end and are paged (TR-082): finished, not-started and parked tickets.
 * Needs you, Working and Stalled are small by design and never hide a card.
 */
export const PAGED_COLUMNS = ["queued", "parked", "done"] as const satisfies readonly ColumnId[];
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
  const totals: Record<ColumnId, number> = emptyTotals();
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

/** Every placement at zero: a board read before its first answer, or a server that sends no parked total. */
export function emptyTotals(): Record<ColumnId, number> {
  return { "needs-you": 0, working: 0, stalled: 0, queued: 0, parked: 0, done: 0 };
}
