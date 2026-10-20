/**
 * Owners the daemon closed (TR-217). A Paseo update or restart closes agent processes; a ticket
 * still being worked then shows "No owner is running". The minute check starts a fresh owner from
 * the latest HANDOFF for each such ticket, within the cap. Parked tickets are the user's, an
 * Awaiting acceptance ticket needs no owner to accept, and a ticket whose fresh owners keep
 * closing is left for the user. Pure.
 */
import { noteRecords } from "./execution";
import { dependsOn } from "./owner-cap";
import { pausedHold, queuedToResume } from "./pause";
import { TARO_LABELS } from "./project";

/** Statuses whose owner is expected to be running. */
const WORKED_STATUSES: ReadonlySet<string> = new Set(["Planning", "In Progress", "Reviewing"]);

/** At most this many automatic relaunches of one ticket within the window; past it the user decides. */
export const MAX_AUTO_RELAUNCHES = 2;
export const AUTO_RELAUNCH_WINDOW_MS = 60 * 60_000;

export interface ClosedOwnerTicket {
  id: string;
  status: string;
  parentTaskId: string | null;
  notes: string | null;
}

export interface ClosedOwnerAgent {
  status: string;
  labels: Readonly<Record<string, string>>;
}

/** The ticket's OWNER-RELAUNCHED records within the window. */
export function recentAutoRelaunches(notes: string | null, now: number): number {
  return noteRecords(notes).filter((record) => {
    const at = /^OWNER-RELAUNCHED\s+(\S+)/.exec(record)?.[1];
    return at !== undefined && now - Date.parse(at) < AUTO_RELAUNCH_WINDOW_MS;
  }).length;
}

/** Tickets (in the given order) that need a fresh owner because their owner is closed and none is live. */
export function ticketsWithClosedOwner(tickets: readonly ClosedOwnerTicket[], owners: readonly ClosedOwnerAgent[], now: number): string[] {
  const ownersOf = (id: string) => owners.filter((owner) => owner.labels[TARO_LABELS.role] === "owner" && dependsOn([owner.labels[TARO_LABELS.ticket] ?? ""], id));
  return tickets
    .filter((ticket) => {
      if (ticket.parentTaskId !== null || !WORKED_STATUSES.has(ticket.status)) return false;
      if (pausedHold(ticket.notes) !== null || queuedToResume(ticket.notes)) return false;
      const mine = ownersOf(ticket.id);
      if (mine.length === 0 || mine.some((owner) => owner.status !== "closed")) return false;
      return recentAutoRelaunches(ticket.notes, now) < MAX_AUTO_RELAUNCHES;
    })
    .map((ticket) => ticket.id);
}

export function ownerRelaunchedText(at: string, previous: string, agentId: string): string {
  return `OWNER-RELAUNCHED ${at} — Paseo closed the owner ${previous} (a daemon update or restart); the plugin started a fresh owner ${agentId} from the latest HANDOFF`;
}
