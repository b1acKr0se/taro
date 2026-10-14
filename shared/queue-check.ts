/**
 * The plugin's own recount of a project's queue (TR-062): the Manager once left a ticket in Backlog
 * with a free slot because it counted from memory, and nothing woke it. The plugin owns the count:
 * every wake-up carries this recount, and a new ticket or an idle Manager with startable tickets wakes
 * it. When the Manager still does not dispatch, a ladder escalates: an alert ten minutes after the
 * wake-up, a fresh Manager twenty minutes after it. A deliberate hold is a HOLD record on the ticket,
 * lifted by a later RELEASE record; a held ticket is never woken for. Pure.
 */
import { noteRecords } from "./execution";
import { dependsOn, ticketsCountingTowardsCap, type CapOwner, type CapTicket } from "./owner-cap";
import { hasHeadroom, type BoardAlert } from "./recovery";

/** How long the Manager must have been idle before the minute check wakes it. */
export const MANAGER_IDLE_BEFORE_WAKE_MS = 2 * 60_000;
/** How long after the wake-up a ticket still queued with a free slot becomes an alert. */
export const QUEUED_ALERT_AFTER_MS = 10 * 60_000;
/** How long after the wake-up the Manager is restarted when the ticket is still queued. */
export const QUEUED_RESTART_AFTER_MS = 20 * 60_000;
/** At most one ladder restart per project in this window, as crash recovery limits itself. */
export const RESTART_WINDOW_MS = 60 * 60_000;
/** A turn with no activity for this long counts as hung. */
export const MANAGER_HUNG_AFTER_MS = 30 * 60_000;

export interface QueuedTicket {
  id: string;
  dependencies: readonly string[];
  notes: string | null;
}

export interface Recount {
  counting: string[];
  cap: number;
  /** Threads in use and the limit, or null where the host publishes none. */
  threads: { current: number; max: number } | null;
  /** Under the cap and under the thread limit: a queued ticket could start now. */
  freeSlot: boolean;
  /** Top-level Backlog tickets with no unmet dependency and no hold, in the order given (oldest first). */
  startable: string[];
  /** Queued tickets with a dependency not yet Done, with those dependencies. */
  waiting: { id: string; on: string[] }[];
  /** Queued tickets the Manager holds, with the reason from the HOLD record. */
  held: { id: string; reason: string }[];
}

/**
 * The newest HOLD record's reason when no RELEASE record follows it, else null. A record reads
 * `HOLD <time> — <reason>`; the reason is what follows the first dash, or the whole record.
 */
export function holdReason(notes: string | null): string | null {
  const records = noteRecords(notes).filter((record) => /^(?:HOLD|RELEASE)\b/.test(record));
  const last = records[records.length - 1];
  if (last === undefined || !last.startsWith("HOLD")) return null;
  const body = last.replace(/^HOLD\b\s*/, "");
  const reason = /\s(?:—|--|-)\s+([\s\S]+)$/.exec(body)?.[1] ?? body;
  return reason.replace(/\s+/g, " ").trim() || "no reason given";
}

/** The ids this ticket depends on whose tickets are not Done; a dependency the tracker does not list cannot hold it up. */
export function unmetDependencies(dependencies: readonly string[], tickets: readonly CapTicket[]): string[] {
  return dependencies.filter((dependency) => tickets.some((ticket) => dependsOn([dependency], ticket.id) && ticket.status !== "Done"));
}

/** The top-level Backlog tickets, oldest first as the tracker lists them. */
export function queuedTickets<T extends CapTicket>(tickets: readonly T[]): T[] {
  return tickets.filter((ticket) => ticket.status === "Backlog" && ticket.parentTaskId === null);
}

export function recount(input: {
  owners: readonly CapOwner[];
  tickets: readonly CapTicket[];
  queued: readonly QueuedTicket[];
  cap: number;
  threads: { current: number; max: number } | null;
}): Recount {
  const counting = ticketsCountingTowardsCap(input.owners, input.tickets);
  const result: Recount = {
    counting,
    cap: input.cap,
    threads: input.threads,
    freeSlot: counting.length < input.cap && hasHeadroom(input.threads),
    startable: [],
    waiting: [],
    held: [],
  };
  for (const ticket of input.queued) {
    const reason = holdReason(ticket.notes);
    const unmet = unmetDependencies(ticket.dependencies, input.tickets);
    if (reason !== null) result.held.push({ id: ticket.id, reason });
    else if (unmet.length > 0) result.waiting.push({ id: ticket.id, on: unmet });
    else result.startable.push(ticket.id);
  }
  return result;
}

/** What makes two looks the same situation: the Manager is woken once per situation, not every minute. */
export function situationKey(count: Recount): string {
  return `${count.startable.join(",")}|${count.counting.join(",")}|${count.cap}`;
}

/**
 * The minute check: wake the Manager when a ticket could start now, the Manager is idle and has been
 * for a while (its last turn ended at least two minutes ago), and it was not already woken for this
 * very situation. `lastTurnEndedAt` null means no turn end is known: it is not woken on a guess.
 */
export function shouldWakeIdleManager(input: {
  count: Recount;
  managerMidTurn: boolean;
  lastTurnEndedAt: number | null;
  lastWokenFor: string | null;
  now: number;
}): boolean {
  if (!input.count.freeSlot || input.count.startable.length === 0 || input.managerMidTurn) return false;
  if (input.lastTurnEndedAt === null || input.now - input.lastTurnEndedAt < MANAGER_IDLE_BEFORE_WAKE_MS) return false;
  return input.lastWokenFor !== situationKey(input.count);
}

/** The tickets new since the last look that could start now; with no last look, none are new. */
export function newlyQueuedStartable(previous: ReadonlyMap<string, string> | null, count: Recount): string[] {
  if (previous === null || !count.freeSlot) return [];
  return count.startable.filter((id) => !previous.has(id));
}

/**
 * The escalation ladder per project, kept in memory: when each startable ticket was first seen
 * queued with a free slot and first named in a wake-up, which alerts the user dismissed, when the
 * user last spoke to the Manager, and the ladder's own Manager restarts.
 */
export interface QueueWatch {
  queuedAt: Map<string, number>;
  wokenAt: Map<string, number>;
  /** The situation the Manager was last woken for (situationKey). */
  wokenFor: string | null;
  dismissed: Set<string>;
  /** Tickets whose alert went up and was logged; logged again only after the ticket left the ladder. */
  alerted: Set<string>;
  /** When the user last sent the Manager a message from Taro; acting on an alert that way stops the restart. */
  userToldManagerAt: number | null;
  restarts: number[];
}

export function emptyQueueWatch(): QueueWatch {
  return { queuedAt: new Map(), wokenAt: new Map(), wokenFor: null, dismissed: new Set(), alerted: new Set(), userToldManagerAt: null, restarts: [] };
}

/**
 * Brings the ladder up to this look: a ticket stays on it while it is startable with a free slot,
 * and leaves it (with its wake-up and dismissal) when it starts, is held, waits on a dependency, or
 * the slots fill. A ticket that comes back starts the ladder again.
 */
export function trackQueue(watch: QueueWatch, count: Recount, now: number): void {
  const on = new Set(count.freeSlot ? count.startable : []);
  for (const id of [...watch.queuedAt.keys()]) {
    if (on.has(id)) continue;
    watch.queuedAt.delete(id);
    watch.wokenAt.delete(id);
    watch.dismissed.delete(id);
    watch.alerted.delete(id);
  }
  for (const id of on) if (!watch.queuedAt.has(id)) watch.queuedAt.set(id, now);
}

/** A wake-up naming these startable tickets went out; returns the ones it named for the first time. */
export function markWoken(watch: QueueWatch, count: Recount, now: number): string[] {
  watch.wokenFor = situationKey(count);
  if (!count.freeSlot) return [];
  const first = count.startable.filter((id) => !watch.wokenAt.has(id));
  for (const id of first) {
    watch.wokenAt.set(id, now);
    if (!watch.queuedAt.has(id)) watch.queuedAt.set(id, now);
  }
  return first;
}

/** Where a ticket's ladder starts: its first wake-up, or when it was first seen queued if the Manager could never be woken. */
function ladderStart(watch: QueueWatch, id: string): number | null {
  return watch.wokenAt.get(id) ?? watch.queuedAt.get(id) ?? null;
}

/** The tickets whose alert is up: ten minutes up the ladder and not dismissed. */
export function alertedTickets(watch: QueueWatch, now: number): string[] {
  return [...watch.queuedAt.keys()].filter((id) => {
    const start = ladderStart(watch, id);
    return start !== null && now - start >= QUEUED_ALERT_AFTER_MS && !watch.dismissed.has(id);
  });
}

/** The tickets whose alert is up but not logged yet; marks them logged. */
export function newlyAlerted(watch: QueueWatch, now: number): string[] {
  const fresh = alertedTickets(watch, now).filter((id) => !watch.alerted.has(id));
  for (const id of fresh) watch.alerted.add(id);
  return fresh;
}

/** One board and Inbox alert per ticket queued with a free slot ten minutes after the Manager was told. */
export function queuedAlerts(watch: QueueWatch, now: number): BoardAlert[] {
  return alertedTickets(watch, now).map((id) => {
    const minutes = Math.floor((now - (ladderStart(watch, id) ?? now)) / 60_000);
    const told = watch.wokenAt.has(id) ? `the plugin told the Manager ${minutes} minutes ago` : `the Manager has been busy for ${minutes} minutes and could not be told`;
    const next = restartLimited(watch, now)
      ? "The plugin already restarted the Manager within the hour, so it leaves this to you."
      : `Unless you dismiss this or tell the Manager something, the plugin restarts the Manager ${Math.round(QUEUED_RESTART_AFTER_MS / 60_000)} minutes after it was told.`;
    return {
      id: `${QUEUED_ALERT_PREFIX}${id}`,
      text: `${id} queued with a free slot: ${told}, and it has not dispatched it. Open the Manager's tab to see why, or ask it to dispatch ${id}. ${next}`,
    };
  });
}

export const QUEUED_ALERT_PREFIX = "queued-free-slot:";

/** The ticket a queued-with-a-free-slot alert is about, or null for any other alert. */
export function queuedAlertTicket(alertId: string): string | null {
  return alertId.startsWith(QUEUED_ALERT_PREFIX) ? alertId.slice(QUEUED_ALERT_PREFIX.length) : null;
}

/** How the Manager is, for the ladder: only an idle or unresponsive one may be restarted. */
export type ManagerCondition = "idle" | "busy" | "unresponsive" | "missing";

/**
 * A Manager mid-turn is busy unless its turn has shown no activity for half an hour (hung); one in
 * error is unresponsive only once crash recovery gave up on it (stalled), as recovery owns it before.
 */
export function managerCondition(manager: { status: string; updatedAt: string; stalled: boolean } | null, now: number): ManagerCondition {
  if (manager === null) return "missing";
  if (manager.status === "running" || manager.status === "initializing") {
    const since = Date.parse(manager.updatedAt);
    return !Number.isNaN(since) && now - since >= MANAGER_HUNG_AFTER_MS ? "unresponsive" : "busy";
  }
  if (manager.status === "error") return manager.stalled ? "unresponsive" : "busy";
  if (manager.status === "closed") return "missing";
  return "idle";
}

/**
 * The ladder's last step: the tickets that warrant restarting the Manager now, or an empty list.
 * Twenty minutes after the wake-up (or after the first look, if it was never woken), with the
 * ticket still startable, a free slot and threads under the limit (both in `count`), the alert not
 * dismissed or acted on, the Manager idle or unresponsive, and no ladder restart in the past hour.
 * Acted on: the user told the Manager something from Taro, or a Manager turn ended after the alert
 * went up (the plugin sends nothing more for the same situation, so someone engaged it, perhaps in
 * its own tab, which the plugin does not see).
 */
export function restartDue(watch: QueueWatch, count: Recount, condition: ManagerCondition, now: number, managerTurnEndedAt: number | null = null): string[] {
  if (!count.freeSlot || (condition !== "idle" && condition !== "unresponsive")) return [];
  if (watch.restarts.some((at) => now - at < RESTART_WINDOW_MS)) return [];
  const startable = new Set(count.startable);
  return [...watch.queuedAt.keys()].filter((id) => {
    const start = ladderStart(watch, id);
    if (start === null || !startable.has(id) || watch.dismissed.has(id) || now - start < QUEUED_RESTART_AFTER_MS) return false;
    const engaged = Math.max(watch.userToldManagerAt ?? -Infinity, managerTurnEndedAt ?? -Infinity);
    return engaged < start + QUEUED_ALERT_AFTER_MS;
  });
}

/** Whether the hourly limit is what stops a restart that is otherwise due (for the log, once). */
export function restartLimited(watch: QueueWatch, now: number): boolean {
  return watch.restarts.some((at) => now - at < RESTART_WINDOW_MS);
}

/**
 * A ladder restart, counted for the hourly limit whether or not it worked, so a failing one is not
 * retried every minute. A Manager actually replaced was told about the tickets, so their ladder
 * starts again from now; after a failure the alert stays up.
 */
export function markRestarted(watch: QueueWatch, tickets: readonly string[], now: number, replaced: boolean): void {
  watch.restarts = [...watch.restarts.filter((at) => now - at < RESTART_WINDOW_MS), now];
  if (!replaced) return;
  for (const id of tickets) {
    watch.wokenAt.set(id, now);
    watch.alerted.delete(id);
  }
  watch.wokenFor = null;
}

/** The recount as the lines a wake-up message carries. */
export function recountFields(count: Recount): Record<string, string> {
  const list = (items: readonly string[]): string => (items.length === 0 ? "none" : items.join(", "));
  const threads = count.threads === null ? "no limit published" : `${count.threads.current} of ${count.threads.max} (${Math.round((count.threads.current / count.threads.max) * 100)}%)`;
  return {
    counting: String(count.counting.length),
    cap: String(count.cap),
    countingTickets: list(count.counting),
    freeSlots: String(Math.max(0, count.cap - count.counting.length)),
    threads,
    startable: list(count.startable),
    waiting: list(count.waiting.map((ticket) => `${ticket.id} (on ${ticket.on.join(", ")})`)),
    held: list(count.held.map((ticket) => `${ticket.id} (${ticket.reason})`)),
  };
}
