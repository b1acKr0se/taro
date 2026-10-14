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
import { TARO_LABELS } from "./project";
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
  /** Queued tickets that already have a live owner (paused back to Backlog, or an owner not yet past it): they count, and are not startable. */
  owned: string[];
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
  const owned = new Set(
    input.queued
      .filter((ticket) => input.owners.some((owner) => owner.status !== "closed" && owner.labels[TARO_LABELS.role] === "owner" && dependsOn([owner.labels[TARO_LABELS.ticket] ?? ""], ticket.id)))
      .map((ticket) => ticket.id),
  );
  // An owner whose label differs from the ticket's id in case counts once, under the ticket's id.
  const others = ticketsCountingTowardsCap(input.owners, input.tickets).filter((id) => ![...owned].some((ticket) => dependsOn([id], ticket)));
  const counting = [...others, ...owned].sort();
  const result: Recount = {
    counting,
    cap: input.cap,
    threads: input.threads,
    freeSlot: counting.length < input.cap && hasHeadroom(input.threads),
    startable: [],
    waiting: [],
    held: [],
    owned: [...owned],
  };
  for (const ticket of input.queued) {
    if (owned.has(ticket.id)) continue;
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
  /** Tickets whose restart the hourly limit withheld, logged once. */
  withheld: Set<string>;
  /** When the user last sent the Manager a message from Taro; acting on an alert that way stops the restart. */
  userToldManagerAt: number | null;
  restarts: number[];
}

export function emptyQueueWatch(): QueueWatch {
  return { queuedAt: new Map(), wokenAt: new Map(), wokenFor: null, dismissed: new Set(), alerted: new Set(), withheld: new Set(), userToldManagerAt: null, restarts: [] };
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
    watch.alerted.delete(id);
    watch.withheld.delete(id);
  }
  // Dismissals are kept on disk across reloads (the ladder itself is not): pruned against the queue, not the ladder.
  for (const id of [...watch.dismissed]) if (!on.has(id)) watch.dismissed.delete(id);
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

/**
 * The project's one board and Inbox alert for the tickets queued with a free slot ten minutes after
 * the Manager was told (TR-064: one card naming them all, not one per ticket), or none. The text
 * follows the Manager's condition at the last minute check (TR-066): with none running, nothing will
 * tell or restart it, so the alert says so and where to start one.
 */
export function queuedAlerts(watch: QueueWatch, now: number, condition: ManagerCondition): BoardAlert[] {
  const tickets = alertedTickets(watch, now).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (tickets.length === 0) return [];
  const alert = (text: string): BoardAlert[] => [{ id: QUEUED_ALERT_ID, tickets, text }];
  if (condition === "missing") {
    return alert(
      `${listed(tickets)} queued with a free slot, but no Manager is running, so nothing dispatches ${tickets.length > 1 ? "them" : "it"}. Start one from the project's settings (⚙): a new Manager checks the tracker when it starts.`,
    );
  }
  const told = tickets.filter((id) => watch.wokenAt.has(id));
  const untold = tickets.filter((id) => !watch.wokenAt.has(id));
  // The longest wait is the one to act on.
  const minutes = (ids: readonly string[]): number => Math.floor((now - Math.min(...ids.map((id) => ladderStart(watch, id) ?? now))) / 60_000);
  const restartIn = Math.round(QUEUED_RESTART_AFTER_MS / 60_000);
  const limited = restartLimited(watch, now);
  if (told.length === 0) {
    if (condition === "unresponsive") {
      const next = limited
        ? "The plugin already restarted the Manager within the hour, so it leaves this to you."
        : `Unless you dismiss this, the plugin restarts the Manager ${restartIn} minutes after ${tickets.length > 1 ? "the first ticket" : "the ticket"} was queued.`;
      return alert(`${listed(tickets)} queued with a free slot: the Manager has stopped responding, so the plugin could not tell it for ${minutes(tickets)} minutes. Open the Manager's tab to see what happened. ${next}`);
    }
    if (condition === "idle") {
      return alert(`${listed(tickets)} queued with a free slot: the plugin has not been able to tell the Manager for ${minutes(tickets)} minutes, though it is idle now. Open the Manager's tab and ask it to dispatch ${tickets.length > 1 ? "the tickets" : "the ticket"}.`);
    }
    return alert(`${listed(tickets)} queued with a free slot: the Manager has been busy for ${minutes(tickets)} minutes, so the plugin could not tell it yet. It tells the Manager once it is idle, and restarts it only if it hangs. Open the Manager's tab to see what it is doing.`);
  }
  const several = told.length > 1;
  const about = untold.length === 0 ? "" : ` about ${listed(told)}`;
  const notYet = untold.length === 0 ? "" : `; ${condition === "busy" ? "it was too busy to be told" : "it has not been told"} about ${listed(untold)} yet`;
  const next = limited
    ? "The plugin already restarted the Manager within the hour, so it leaves this to you."
    : `Unless you dismiss this or tell the Manager something, the plugin restarts the Manager ${restartIn} minutes after it was told.`;
  return alert(
    `${listed(tickets)} queued with a free slot: the plugin told the Manager${about} ${minutes(told)} minutes ago, and it has not dispatched ${several ? "them" : "it"}${notYet}. Open the Manager's tab to see why, or ask it to dispatch ${several ? "the tickets" : "the ticket"}. ${next}`,
  );
}

/** "NA-001", "NA-001 and NA-002", "NA-001, NA-002 and NA-003". */
function listed(ids: readonly string[]): string {
  return ids.length <= 1 ? (ids[0] ?? "") : `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1] ?? ""}`;
}

/** The id of the queued-with-a-free-slot alert; the tickets it names are in its `tickets`. */
export const QUEUED_ALERT_ID = "queued-free-slot";

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
 * Twenty minutes after the wake-up, with the ticket still startable, a free slot and threads under
 * the limit (both in `count`), the alert not dismissed or acted on (the user told the Manager
 * something after it went up), the Manager idle or unresponsive, and no ladder restart in the past
 * hour. A ticket the Manager was never told about is restarted for only when the Manager is
 * unresponsive (hung or given up by crash recovery), twenty minutes after it was first seen: a busy
 * Manager that turns idle is woken first. A Manager turn ending is no sign the user acted: the
 * plugin's own wake-ups for a changed queue end turns too.
 */
export function restartDue(watch: QueueWatch, count: Recount, condition: ManagerCondition, now: number): string[] {
  return restartRipe(watch, count, condition, now).filter(() => !restartLimited(watch, now));
}

function restartRipe(watch: QueueWatch, count: Recount, condition: ManagerCondition, now: number): string[] {
  if (!count.freeSlot || (condition !== "idle" && condition !== "unresponsive")) return [];
  const startable = new Set(count.startable);
  return [...watch.queuedAt.keys()].filter((id) => {
    if (!watch.wokenAt.has(id) && condition !== "unresponsive") return false;
    const start = ladderStart(watch, id);
    if (start === null || !startable.has(id) || watch.dismissed.has(id) || now - start < QUEUED_RESTART_AFTER_MS) return false;
    return watch.userToldManagerAt === null || watch.userToldManagerAt < start + QUEUED_ALERT_AFTER_MS;
  });
}

/** Whether a ladder restart happened in the past hour. */
export function restartLimited(watch: QueueWatch, now: number): boolean {
  return watch.restarts.some((at) => now - at < RESTART_WINDOW_MS);
}

/** The tickets whose restart is ripe but withheld by the hourly limit, not logged yet; marks them logged. */
export function newlyWithheld(watch: QueueWatch, count: Recount, condition: ManagerCondition, now: number): string[] {
  if (!restartLimited(watch, now)) return [];
  const fresh = restartRipe(watch, count, condition, now).filter((id) => !watch.withheld.has(id));
  for (const id of fresh) watch.withheld.add(id);
  return fresh;
}

/** When the alert for these tickets went up, the earliest: a user message after it acts on the alert. */
export function alertRaisedAt(watch: QueueWatch, tickets: readonly string[]): number | null {
  const starts = tickets.flatMap((id) => {
    const start = ladderStart(watch, id);
    return start === null ? [] : [start + QUEUED_ALERT_AFTER_MS];
  });
  return starts.length === 0 ? null : Math.min(...starts);
}

/**
 * A ladder restart, counted for the hourly limit whether or not it worked, so a failing one is not
 * retried every minute. A Manager actually replaced was told about the tickets in its first prompt:
 * their ladder starts again from now, and the minute check does not tell it the same again.
 */
export function markRestarted(watch: QueueWatch, tickets: readonly string[], count: Recount, now: number, replaced: boolean): void {
  watch.restarts = [...watch.restarts.filter((at) => now - at < RESTART_WINDOW_MS), now];
  if (!replaced) return;
  for (const id of tickets) {
    watch.wokenAt.set(id, now);
    watch.alerted.delete(id);
  }
  watch.wokenFor = situationKey(count);
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
    owned: list(count.owned),
  };
}
