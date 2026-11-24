/**
 * Owners the daemon closed (TR-217). A Paseo restart or crash closes agent processes mid-turn; a ticket
 * still being worked then shows "No owner is running". The minute check starts a fresh owner from
 * the latest HANDOFF for each such ticket, within the cap. Paseo also frees any agent idle for an hour:
 * it lists as closed too, but it finished its turn and a message wakes it, so it is left alone (a fresh
 * owner each hour was the relaunch loop). Parked tickets are the user's, an Awaiting acceptance ticket
 * needs no owner to accept, and a ticket whose fresh owners keep closing is left for the user. Pure.
 */
import { noteRecords } from "./execution";
import { dependsOn } from "./owner-cap";
import { pausedHold, queuedToResume } from "./pause";
import { TARO_LABELS } from "./project";

/** Statuses whose owner is expected to be running. */
const WORKED_STATUSES: ReadonlySet<string> = new Set(["Planning", "In Progress", "Reviewing"]);

/** At most this many automatic relaunches of one ticket within the window; past it the user decides. */
export const MAX_AUTO_RELAUNCHES = 3;
export const AUTO_RELAUNCH_WINDOW_MS = 24 * 60 * 60_000;

/** An owner closed longer ago than this was likely closed on purpose, so it is left to the user. */
export const RECENTLY_CLOSED_MS = 6 * 60 * 60_000;

export interface ClosedOwnerTicket {
  id: string;
  status: string;
  parentTaskId: string | null;
  notes: string | null;
}

export interface ClosedOwnerAgent {
  status: string;
  /** When Paseo last touched the agent; for a closed one, about when it closed. */
  updatedAt: string;
  labels: Readonly<Record<string, string>>;
  /** Whether it finished its last turn before closing (`ownerRested`); left out counts as cut off. */
  rested?: boolean;
}

/**
 * An owner closed after its turn ended was freed by Paseo's idle cleanup, not cut off. With a turn start
 * recorded, its latest end must come at or after it; without one (a record from before starts were kept),
 * the end must come at or after the agent's last activity, with a minute of slack for the clocks.
 */
export function ownerRested(turns: { lastTurnEndedAt: string | null; lastTurnStartedAt?: string | null } | null, updatedAt: string): boolean {
  if (turns === null || turns.lastTurnEndedAt === null) return false;
  const ended = Date.parse(turns.lastTurnEndedAt);
  if (!Number.isFinite(ended)) return false;
  const started = turns.lastTurnStartedAt === null || turns.lastTurnStartedAt === undefined ? Number.NaN : Date.parse(turns.lastTurnStartedAt);
  if (Number.isFinite(started)) return ended >= started;
  const active = Date.parse(updatedAt);
  return Number.isFinite(active) && ended >= active - 60_000;
}

/** The ticket's OWNER-RELAUNCHED and OWNER-RELAUNCH-FAILED records within the window. */
export function recentAutoRelaunches(notes: string | null, now: number): number {
  return noteRecords(notes).filter((record) => {
    const at = /^OWNER-RELAUNCH(?:ED|-FAILED)\s+(\S+)/.exec(record)?.[1];
    return at !== undefined && now - Date.parse(at) < AUTO_RELAUNCH_WINDOW_MS;
  }).length;
}

/**
 * Tickets (in the given order) that need a fresh owner because their owner is closed and none is live.
 * `waitingOnUser` holds ids (upper case) whose owner left a question to the user unanswered: Paseo frees
 * an idle owner's runtime about an hour after its last turn, and a fresh owner would only ask it again,
 * so the answer is delivered to the ticket's owner as a message instead.
 */
export function ticketsWithClosedOwner(tickets: readonly ClosedOwnerTicket[], owners: readonly ClosedOwnerAgent[], now: number, waitingOnUser: ReadonlySet<string> = new Set()): string[] {
  const ownersOf = (id: string) => owners.filter((owner) => owner.labels[TARO_LABELS.role] === "owner" && dependsOn([owner.labels[TARO_LABELS.ticket] ?? ""], id));
  return tickets
    .filter((ticket) => {
      if (ticket.parentTaskId !== null || !WORKED_STATUSES.has(ticket.status)) return false;
      if (pausedHold(ticket.notes) !== null || queuedToResume(ticket.notes)) return false;
      if (waitingOnUser.has(ticket.id.toUpperCase())) return false;
      const mine = ownersOf(ticket.id);
      if (mine.length === 0 || mine.some((owner) => owner.status !== "closed")) return false;
      // The newest owner decides: an older one cut off is long replaced.
      const newestOwner = [...mine].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (newestOwner?.rested === true) return false;
      const closedAt = Math.max(...mine.map((owner) => Date.parse(owner.updatedAt)));
      if (!(now - closedAt < RECENTLY_CLOSED_MS)) return false;
      return recentAutoRelaunches(ticket.notes, now) < MAX_AUTO_RELAUNCHES;
    })
    .map((ticket) => ticket.id);
}

export function ownerRelaunchedText(at: string, previous: string, agentId: string): string {
  return `OWNER-RELAUNCHED ${at} — Paseo closed the owner ${previous} (cut off mid-turn, as by a daemon restart or crash); the plugin started a fresh owner ${agentId} from the latest HANDOFF`;
}

export function ownerRelaunchFailedText(at: string, reason: string): string {
  const flat = reason.replace(/\s+/g, " ").trim().slice(0, 200);
  return `OWNER-RELAUNCH-FAILED ${at} — the plugin could not start a fresh owner after Paseo closed the old one (${flat}); Relaunch it from the board`;
}
