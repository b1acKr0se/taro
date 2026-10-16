/**
 * Park (once Pause, TR-088, renamed by TR-166) and Resume a ticket. Park asks the owner for a HANDOFF
 * (a PAUSE-REQUESTED record marks when), then archives the ticket's agents and appends a HOLD whose
 * reason starts with "parked by the user" (older ones say "paused by the user"); the ticket keeps its
 * status, so a fresh owner knows the phase. A Queued ticket nobody started is parked at once, and
 * Resume puts it back in the queue for the manager. A started one's Resume appends RELEASE and
 * relaunches at once with a free slot; without one the RELEASE says "queued to resume" and the plugin
 * relaunches it when a slot frees, oldest first with the Queued tickets, and marks that with a
 * RESUMED record. Everything here reads the ticket's notes, which are append-only, so record order
 * is time order. Pure.
 */
import { z } from "zod";

import { noteRecords } from "./execution";
import { TICKET_STATUSES } from "./project";
import { holdReason } from "./queue-check";

/** How long Pause waits for the owner's HANDOFF before pausing without one. */
export const PAUSE_HANDOFF_TIMEOUT_MS = 10 * 60_000;

/** A HOLD whose reason starts with this is a park; the manager's own holds never do. */
export const PARKED_REASON = "parked by the user";
/** What a park's HOLD said before TR-166: still read as one, so no ticket needs rewriting. */
export const PAUSED_REASON = "paused by the user";
/** The HOLD of a Queued ticket parked before anyone started it: its Resume returns it to the queue. */
const BEFORE_IT_STARTED = "before it started";
const QUEUED_TO_RESUME = "queued to resume";

const QUEUED_STATUS = TICKET_STATUSES[0];

export interface PausedHold {
  /** The HOLD record's time as written, or null when it has none. */
  at: string | null;
  /** The pause went ahead without a HANDOFF (the owner did not answer, or had already gone). */
  withoutHandoff: boolean;
  /** Parked while Queued with no owner: nothing to hand off, and Resume returns it to the queue. */
  notStarted: boolean;
}

/** Whether a HOLD's reason is the user's park, in its current or its pre-TR-166 words. */
export function isParkReason(reason: string): boolean {
  const lower = reason.toLowerCase();
  return lower.startsWith(PARKED_REASON) || lower.startsWith(PAUSED_REASON);
}

function recordTime(record: string): string | null {
  return /^[A-Z][A-Z-]+\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(record)?.[1] ?? null;
}

function lastHoldOrRelease(notes: string | null): string | null {
  const records = noteRecords(notes).filter((record) => /^(?:HOLD|RELEASE)\b/.test(record));
  return records[records.length - 1] ?? null;
}

/** The pause in force: the newest HOLD or RELEASE record is a HOLD paused by the user. */
export function pausedHold(notes: string | null): PausedHold | null {
  const reason = holdReason(notes);
  if (reason === null || !isParkReason(reason)) return null;
  const record = lastHoldOrRelease(notes) ?? "";
  const notStarted = reason.toLowerCase().includes(BEFORE_IT_STARTED);
  return { at: recordTime(record), withoutHandoff: !notStarted && /\bno handoff\b/i.test(reason), notStarted };
}

/**
 * Whether the pause in force was Taro's own: a PAUSE-REQUESTED record comes before its HOLD with no
 * other HOLD or RELEASE between. Only such a pause may have its leftover agents archived (a pause
 * cut short by a reload or a failed archive); a hold the user wrote by hand is left alone.
 */
export function pausedByTaro(notes: string | null): boolean {
  if (pausedHold(notes) === null) return false;
  const records = noteRecords(notes);
  let seenHold = false;
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (/^PAUSE-REQUESTED\b/.test(record)) return seenHold;
    if (/^(?:HOLD|RELEASE)\b/.test(record)) {
      if (seenHold) return false;
      seenHold = true;
    }
  }
  return false;
}

/**
 * Whether the user resumed this ticket with no free slot and nothing has started it since: the
 * newest HOLD or RELEASE is a RELEASE queued to resume, with no RESUMED or EXECUTION record after it.
 * Whether an owner is alive is the caller's to check.
 */
export function queuedToResume(notes: string | null): boolean {
  const records = noteRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (/^(?:RESUMED|EXECUTION|HOLD)\b/.test(record)) return false;
    if (/^RELEASE\b/.test(record)) return record.includes(QUEUED_TO_RESUME);
  }
  return false;
}

/** The newest PAUSE-REQUESTED record's time, unless a HOLD or RELEASE since ended that pause. */
export function pauseRequestedAt(notes: string | null): string | null {
  const records = noteRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (/^(?:HOLD|RELEASE)\b/.test(record)) return null;
    if (/^PAUSE-REQUESTED\b/.test(record)) return recordTime(record);
  }
  return null;
}

/** Whether a HANDOFF record follows the newest PAUSE-REQUESTED record. */
export function handoffSincePauseRequest(notes: string | null): boolean {
  const records = noteRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (/^PAUSE-REQUESTED\b/.test(record)) return false;
    if (/^HANDOFF\b/.test(record)) return true;
  }
  return false;
}

export type PauseProgress = "waiting" | "handoff" | "timed-out" | "owner-gone";

/**
 * Where a requested pause stands: the HANDOFF is written and the owner's turn is over, the owner is
 * gone, the wait ran out, or still waiting. A HANDOFF while the owner is mid-turn waits for its end,
 * so the owner can finish stopping its test daemons.
 */
export function pauseProgress(input: { notes: string | null; requestedAt: number; now: number; ownerAlive: boolean; ownerMidTurn: boolean }): PauseProgress {
  if (!input.ownerAlive) return "owner-gone";
  if (handoffSincePauseRequest(input.notes) && !input.ownerMidTurn) return "handoff";
  if (input.now - input.requestedAt >= PAUSE_HANDOFF_TIMEOUT_MS) return "timed-out";
  return "waiting";
}

/** The HOLD record that completes a pause. */
export function pausedHoldText(at: string, progress: Exclude<PauseProgress, "waiting">, handoffWritten: boolean): string {
  if (handoffWritten) return `HOLD ${at} — ${PARKED_REASON}; resume from the latest HANDOFF`;
  const why = progress === "timed-out" ? `the owner did not write one within ${PAUSE_HANDOFF_TIMEOUT_MS / 60_000} minutes` : "the owner had already stopped";
  return `HOLD ${at} — ${PARKED_REASON}; no handoff (${why}): resume from the latest milestone`;
}

/** The HOLD that parks a Queued ticket nobody has started: the queue and the manager pass it by until Resume. */
export function parkedUnstartedHoldText(at: string): string {
  return `HOLD ${at} — ${PARKED_REASON} ${BEFORE_IT_STARTED}: never start it until the user resumes it`;
}

/** The RELEASE that Resume appends to a ticket parked before it started: queued like any other again, for the manager to start. */
export function unparkedReleaseText(at: string): string {
  return `RELEASE ${at} — resumed by the user: back in the queue, for the manager to start`;
}

/**
 * What Resume appends to a ticket parked before it started: the RELEASE above, or, when the manager
 * held it before the park (a HOLD of its own, not released), that hold again, so Resume never lifts it.
 */
export function unparkedRecordText(at: string, notes: string | null): string {
  const records = noteRecords(notes).filter((record) => /^(?:HOLD|RELEASE)\b/.test(record));
  const before = records.slice(0, -1);
  const earlier = holdReason(before.join("\n\n"));
  return earlier === null || isParkReason(earlier) ? unparkedReleaseText(at) : `HOLD ${at} — ${earlier}`;
}

/**
 * The HOLD that puts a ticket queued to resume back to Paused, before any owner started: it resumes
 * from what the earlier pause left, a HANDOFF or, without one, the latest milestone.
 */
export function pausedAgainHoldText(at: string, notes: string | null): string {
  const records = noteRecords(notes);
  const earlier = [...records].reverse().find((record) => /^HOLD\b/.test(record)) ?? "";
  const from = /\bno handoff\b/i.test(earlier) ? "no handoff: resume from the latest milestone" : "resume from the latest HANDOFF";
  return `HOLD ${at} — ${PARKED_REASON} again before it resumed; ${from}`;
}

/** The RELEASE record Resume appends: with `queued`, the plugin starts the owner when a slot frees. */
export function resumedReleaseText(at: string, queued: { counting: number; cap: number } | null): string {
  if (queued === null) return `RELEASE ${at} — resumed by the user: a fresh owner starts from the latest HANDOFF`;
  return `RELEASE ${at} — resumed by the user; ${QUEUED_TO_RESUME}: no free slot (owners ${queued.counting} of ${queued.cap})`;
}

export interface PauseTicket {
  id: string;
  status: string;
  parentTaskId: string | null;
  notes: string | null;
}

/** Why Park is refused for this ticket, in words for the user, or null when it may be parked; a Queued one may (TR-166). */
export function pauseRefusal(ticket: PauseTicket, merging: boolean): string | null {
  if (ticket.parentTaskId !== null) return `${ticket.id} is a child: park its parent ${ticket.parentTaskId} instead.`;
  if (ticket.status === "Awaiting acceptance") {
    return merging ? `${ticket.id} is merging: wait for it to finish.` : `${ticket.id} is awaiting your acceptance: accept it or request changes instead.`;
  }
  if (ticket.status === "Done" || ticket.status === "Cancelled") return `${ticket.id} is ${ticket.status}: there is nothing to park.`;
  if (pausedHold(ticket.notes) !== null) return `${ticket.id} is already parked.`;
  if (pauseRequestedAt(ticket.notes) !== null) return `${ticket.id} is already being parked: its owner is writing a handoff.`;
  return null;
}

/** How long a DISPATCH-INTENT with no EXECUTION after it counts as the manager starting the owner now. */
export const DISPATCH_PENDING_MS = 10 * 60_000;

/**
 * Whether the manager is starting this ticket's owner right now: its newest DISPATCH-INTENT has no
 * EXECUTION after it and is recent. Parking then would hold a ticket its owner is about to work under,
 * never told (TR-166); an older intent is a launch that failed, and parking is safe.
 */
export function dispatchPending(notes: string | null, now: number): boolean {
  const records = noteRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (/^EXECUTION\b/.test(record)) return false;
    if (/^DISPATCH-INTENT\b/.test(record)) {
      const at = Date.parse(recordTime(record) ?? "");
      return Number.isFinite(at) && now - at < DISPATCH_PENDING_MS;
    }
  }
  return false;
}

/** Whether Park holds this ticket at once, with no handoff to wait for: Queued, and nobody has started it. */
export function parksBeforeStart(status: string, ownerAlive: boolean): boolean {
  return status === QUEUED_STATUS && !ownerAlive;
}

/** Why Resume is refused, in words for the user, or null when it may resume. */
export function resumeRefusal(ticket: PauseTicket, merging: boolean, ownerAlive: boolean): string | null {
  if (ticket.status === "Awaiting acceptance") {
    return merging ? `${ticket.id} is merging: wait for it to finish.` : `${ticket.id} is awaiting your acceptance: accept it or request changes instead.`;
  }
  if (pausedHold(ticket.notes) === null) return queuedToResume(ticket.notes) ? `${ticket.id} is already queued to resume.` : `${ticket.id} is not parked.`;
  if (ownerAlive) return `${ticket.id} still has a live owner: it was not parked by Taro.`;
  return null;
}

/**
 * Whether a ticket queued to resume takes a free slot now: oldest first with the Queued tickets
 * (the tracker's order), so it starts only when the free slots outnumber the startable Queued
 * tickets ahead of it. A slot the manager is filling for an older ticket stays its own.
 */
export function resumesNow(input: { ticket: string; order: readonly string[]; startable: readonly string[]; counting: number; cap: number; headroom: boolean }): boolean {
  if (!input.headroom) return false;
  const position = input.order.indexOf(input.ticket);
  const ahead = input.startable.filter((id) => {
    const index = input.order.indexOf(id);
    return index !== -1 && (position === -1 || index < position);
  }).length;
  return input.cap - input.counting > ahead;
}

export const PauseViewSchema = z.object({
  state: z.enum(["pausing", "paused", "queued-to-resume"]),
  /** When it asked for the handoff, paused, or was resumed into the queue, as recorded. */
  since: z.string().nullable(),
  /** Paused without a HANDOFF: the next owner starts from the latest milestone. */
  withoutHandoff: z.boolean(),
  /** Parked while Queued, before any owner (TR-166): Resume returns it to the queue. */
  notStarted: z.boolean().default(false),
});
export type PauseView = z.infer<typeof PauseViewSchema>;

/** What the card and the ticket view say about a pause; a live owner means it was started again (or never paused by Taro). */
export function pauseView(notes: string | null, ownerAlive: boolean): PauseView | null {
  const requested = pauseRequestedAt(notes);
  if (requested !== null) return { state: "pausing", since: requested, withoutHandoff: false, notStarted: false };
  if (ownerAlive) return null;
  const paused = pausedHold(notes);
  if (paused !== null) return { state: "paused", since: paused.at, withoutHandoff: paused.withoutHandoff, notStarted: paused.notStarted };
  if (queuedToResume(notes)) return { state: "queued-to-resume", since: recordTime(lastHoldOrRelease(notes) ?? ""), withoutHandoff: false, notStarted: false };
  return null;
}
