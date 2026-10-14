/**
 * Pause and Resume a ticket (TR-088). Pause asks the owner for a HANDOFF (a PAUSE-REQUESTED record
 * marks when), then archives the ticket's agents and appends a HOLD whose reason starts with
 * "paused by the user"; the ticket keeps its status, so a fresh owner knows the phase. Resume
 * appends RELEASE and relaunches at once with a free slot; without one the RELEASE says "queued to
 * resume" and the plugin relaunches it when a slot frees, oldest first with the Queued tickets, and
 * marks that with a RESUMED record. Everything here reads the ticket's notes, which are append-only,
 * so record order is time order. Pure.
 */
import { z } from "zod";

import { noteRecords } from "./execution";
import { TICKET_STATUSES } from "./project";
import { holdReason } from "./queue-check";

/** How long Pause waits for the owner's HANDOFF before pausing without one. */
export const PAUSE_HANDOFF_TIMEOUT_MS = 10 * 60_000;

/** A HOLD whose reason starts with this is a pause; the Manager's own holds never do. */
export const PAUSED_REASON = "paused by the user";
const QUEUED_TO_RESUME = "queued to resume";

const QUEUED_STATUS = TICKET_STATUSES[0];

export interface PausedHold {
  /** The HOLD record's time as written, or null when it has none. */
  at: string | null;
  /** The pause went ahead without a HANDOFF (the owner did not answer, or had already gone). */
  withoutHandoff: boolean;
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
  if (reason === null || !reason.toLowerCase().startsWith(PAUSED_REASON)) return null;
  const record = lastHoldOrRelease(notes) ?? "";
  return { at: recordTime(record), withoutHandoff: /\bno handoff\b/i.test(reason) };
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
  if (handoffWritten) return `HOLD ${at} — ${PAUSED_REASON}; resume from the latest HANDOFF`;
  const why = progress === "timed-out" ? `the owner did not write one within ${PAUSE_HANDOFF_TIMEOUT_MS / 60_000} minutes` : "the owner had already stopped";
  return `HOLD ${at} — ${PAUSED_REASON}; no handoff (${why}): resume from the latest milestone`;
}

/**
 * The HOLD that puts a ticket queued to resume back to Paused, before any owner started: it resumes
 * from what the earlier pause left, a HANDOFF or, without one, the latest milestone.
 */
export function pausedAgainHoldText(at: string, notes: string | null): string {
  const records = noteRecords(notes);
  const earlier = [...records].reverse().find((record) => /^HOLD\b/.test(record)) ?? "";
  const from = /\bno handoff\b/i.test(earlier) ? "no handoff: resume from the latest milestone" : "resume from the latest HANDOFF";
  return `HOLD ${at} — ${PAUSED_REASON} again before it resumed; ${from}`;
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

/** Why Pause is refused for this ticket, in words for the user, or null when it may pause. */
export function pauseRefusal(ticket: PauseTicket, merging: boolean): string | null {
  if (ticket.parentTaskId !== null) return `${ticket.id} is a child: pause its parent ${ticket.parentTaskId} instead.`;
  if (ticket.status === "Awaiting acceptance") {
    return merging ? `${ticket.id} is merging: wait for it to finish.` : `${ticket.id} is awaiting your acceptance: accept it or request changes instead.`;
  }
  if (ticket.status === "Done" || ticket.status === "Cancelled") return `${ticket.id} is ${ticket.status}: there is nothing to pause.`;
  if (ticket.status === QUEUED_STATUS) return `${ticket.id} has not started: it is ${QUEUED_STATUS.toLowerCase()} and has no owner to pause.`;
  if (pausedHold(ticket.notes) !== null) return `${ticket.id} is already paused.`;
  if (pauseRequestedAt(ticket.notes) !== null) return `${ticket.id} is already pausing: its owner is writing a handoff.`;
  return null;
}

/** Why Resume is refused, in words for the user, or null when it may resume. */
export function resumeRefusal(ticket: PauseTicket, merging: boolean, ownerAlive: boolean): string | null {
  if (ticket.status === "Awaiting acceptance") {
    return merging ? `${ticket.id} is merging: wait for it to finish.` : `${ticket.id} is awaiting your acceptance: accept it or request changes instead.`;
  }
  if (pausedHold(ticket.notes) === null) return queuedToResume(ticket.notes) ? `${ticket.id} is already queued to resume.` : `${ticket.id} is not paused.`;
  if (ownerAlive) return `${ticket.id} still has a live owner: it was not paused by Taro.`;
  return null;
}

/**
 * Whether a ticket queued to resume takes a free slot now: oldest first with the Queued tickets
 * (the tracker's order), so it starts only when the free slots outnumber the startable Queued
 * tickets ahead of it. A slot the Manager is filling for an older ticket stays its own.
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
});
export type PauseView = z.infer<typeof PauseViewSchema>;

/** What the card and the ticket view say about a pause; a live owner means it was started again (or never paused by Taro). */
export function pauseView(notes: string | null, ownerAlive: boolean): PauseView | null {
  const requested = pauseRequestedAt(notes);
  if (requested !== null) return { state: "pausing", since: requested, withoutHandoff: false };
  if (ownerAlive) return null;
  const paused = pausedHold(notes);
  if (paused !== null) return { state: "paused", since: paused.at, withoutHandoff: paused.withoutHandoff };
  if (queuedToResume(notes)) return { state: "queued-to-resume", since: recordTime(lastHoldOrRelease(notes) ?? ""), withoutHandoff: false };
  return null;
}
