/**
 * What a board card says is happening now (TR-026, TR-031): the first of why it stalled, what it asks
 * of you, that it was accepted and is merging, where a teammate's owner runs, the subagent the owner
 * waits on, what the running owner is doing (TR-080), or the idle owner's last status line or newer
 * milestone. Each is a headline read whole (it wraps, never cut
 * mid-fact), a muted detail under it, and for an ask the action that opens it. Pure.
 */
import type { Card } from "../shared/contracts";
import { PAUSE_HANDOFF_TIMEOUT_MS, type PauseView } from "../shared/pause";
import type { StatusState } from "../shared/reports";
import type { StoredDecision } from "../shared/state";
import { callAction, cardCalls, readinessText, waitingOnPermissions, type CardCall } from "./card-calls";
import { formatTokenCount, pullRequestNumberLabel, relativeTime } from "./format";
import { waitingOn } from "./pane-agents";

interface Lines {
  headline: string;
  /** Muted, under the headline: evidence, what is missing, more asks, how long ago. */
  detail: string | null;
}

export type NowLine =
  | ({ kind: "stalled" } & Lines)
  | ({ kind: "pause"; state: PauseView["state"] } & Lines)
  | ({ kind: "call"; call: CardCall; action: string } & Lines)
  | ({ kind: "accepted" } & Lines)
  | ({ kind: "elsewhere" } & Lines)
  | ({ kind: "subagent" } & Lines)
  | ({ kind: "working" } & Lines)
  | ({ kind: "milestone" } & Lines)
  | ({ kind: "status"; state: StatusState } & Lines);

export function cardNowLine(card: Card, now: number): NowLine | null {
  if (card.column === "stalled") return { kind: "stalled", ...stalledLines(card, now) };
  if (card.pause !== null) return { kind: "pause", state: card.pause.state, ...pauseLines(card.pause, now) };
  const calls = cardCalls(card);
  const first = calls[0];
  if (first !== undefined) return { kind: "call", call: first, action: callAction(first), ...callLines(first, calls.slice(1), now) };
  if (card.accepted !== null) {
    return {
      kind: "accepted",
      headline: card.accepted.merging === null ? "Accepted · closing the ticket" : `Accepted · merging ${card.accepted.merging}`,
      detail: ago(card.accepted.at, now),
    };
  }
  // Not started: a child's status line is its parent owner's, about other work.
  if (card.column === "queued") return null;
  if (card.ownerElsewhere !== null) return { kind: "elsewhere", headline: `Owner runs on ${card.ownerElsewhere}`, detail: null };
  const waiting = waitingOn(card, now);
  if (waiting !== null) {
    const parts = [waiting.running === null ? null : `running ${waiting.running}`, waiting.more > 0 ? `${waiting.more} more running` : null];
    return { kind: "subagent", headline: waiting.text, detail: joined(parts) };
  }
  const owner = card.owner;
  if (owner !== null && (owner.status === "running" || owner.status === "initializing")) return { kind: "working", ...workingLines(card, owner.turnStartedAt, now) };
  return restingLine(card, now);
}

/**
 * Mid-turn (TR-080): the end-of-turn status is the previous turn's, so the line is this turn's newest
 * milestone, else the latest tool call, else plain "Working", with its age.
 */
function workingLines(card: Card, turnStartedAt: string | null, now: number): Lines {
  // Without the turn's start, the previous turn ended no earlier than its status line.
  const since = turnStartedAt ?? card.lastStatus?.at ?? null;
  const milestone = card.latestMilestone;
  const milestoneNow = milestone !== null && milestone.time !== null && notBefore(milestone.time, since) ? { text: milestone.text, at: milestone.time } : null;
  const activity = card.activity !== null && notBefore(card.activity.at, since) ? card.activity : null;
  if (milestoneNow !== null) return { headline: capitalised(milestoneNow.text), detail: joined(["Working", ago(milestoneNow.at, now), activity === null ? null : `now ${activity.text}`]) };
  if (activity !== null) return { headline: capitalised(activity.text), detail: joined(["Working", ago(activity.at, now)]) };
  const started = turnStartedAt === null ? null : ago(turnStartedAt, now);
  return { headline: "Working", detail: started === null ? null : `started ${started}` };
}

/** Idle: the last status line, unless a milestone written after it says something newer. */
function restingLine(card: Card, now: number): NowLine | null {
  const last = card.lastStatus;
  const milestone = card.latestMilestone;
  const newer = milestone !== null && milestone.time !== null && (last === null || after(milestone.time, last.at)) ? milestone : null;
  if (newer !== null && newer.time !== null) return { kind: "milestone", headline: capitalised(newer.text), detail: joined(["Idle", ago(newer.time, now)]) };
  if (last !== null) return { kind: "status", state: last.state, headline: capitalised(last.text), detail: joined([capitalised(last.state), ago(last.at, now)]) };
  return null;
}

// Milestones are stamped in whole minutes, so times compare by the minute: a milestone stamped in the
// minute a turn started belongs to that turn, one stamped in the minute a status was given does not
// replace it.
function minuteOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.NaN : Math.floor(at / 60_000);
}

function notBefore(at: string, since: string | null): boolean {
  return since === null || minuteOf(at) >= minuteOf(since);
}

function after(at: string, than: string): boolean {
  return minuteOf(at) > minuteOf(than);
}

function callLines(call: CardCall, others: readonly CardCall[], now: number): Lines {
  // Other asks beside the first, counted or named in a few words: the card shows only the first.
  const also = others.map((other) =>
    other.kind === "decision"
      ? `${other.more + 1} more question${other.more === 0 ? "" : "s"}`
      : other.kind === "acceptance"
        ? `also ${lowercased(readinessText(other.ready))}`
        : `also ${lowercased(waitingOnPermissions(other.count))}`,
  );
  if (call.kind === "decision") {
    const more = call.more > 0 ? `${call.more} more question${call.more === 1 ? "" : "s"}` : null;
    return { headline: call.decision.question, detail: joined([questionContext(call.decision, now), more, ...also]) };
  }
  if (call.kind === "acceptance") {
    const readiness = readinessText(call.ready);
    // Accepted once and not merged (TR-109): why is what the user must act on before accepting again.
    if (call.notMerged !== null) return { headline: notMergedText(call.notMerged), detail: joined([call.delivered, readiness, call.evidence, ...also]) };
    // Incomplete evidence names what is missing, which is what holds Accept back.
    return call.delivered === null ? { headline: readiness, detail: joined([call.evidence, ...also]) } : { headline: call.delivered, detail: joined([readiness, call.evidence, ...also]) };
  }
  const more = call.count > 1 ? `${call.count - 1} more permission${call.count === 2 ? "" : "s"}` : null;
  if (call.title === null) return { headline: waitingOnPermissions(call.count), detail: joined(also) };
  return { headline: call.asker === null ? call.title : `${call.asker}: ${call.title}`, detail: joined([call.detail, more, ...also]) };
}

/** Why an accepted delivery did not merge (TR-109), or merged without the local base branch following it (TR-110), as the card's headline. */
export function notMergedText(notMerged: { reason: string; merged: boolean }): string {
  return notMerged.merged ? `Merged; the local base branch was not updated: ${notMerged.reason}` : `Not merged: ${notMerged.reason}`;
}

/** What a question card says under the question: whether it blocks and how long ago it was asked (TR-045). */
export function questionContext(decision: Pick<StoredDecision, "blocking" | "askedAt">, now: number): string | null {
  const asked = ago(decision.askedAt, now);
  return joined([decision.blocking ? "Blocking" : null, asked === null ? null : `asked ${asked}`]);
}

/** Pausing, paused or queued to resume (TR-088): what happens next, and since when. */
function pauseLines(pause: PauseView, now: number): Lines {
  const since = pause.since === null ? null : ago(pause.since, now);
  if (pause.state === "pausing") {
    return { headline: "Pausing: the owner is writing its handoff", detail: joined([since === null ? null : `asked ${since}`, `pauses without one after ${PAUSE_HANDOFF_TIMEOUT_MS / 60_000} min`]) };
  }
  if (pause.state === "queued-to-resume") return { headline: "Queued to resume", detail: joined(["a fresh owner starts when a slot frees", since === null ? null : `Resume pressed ${since}`]) };
  return {
    headline: "Paused by you",
    detail: joined([since, pause.withoutHandoff ? "no handoff: resumes from the latest milestone" : "resumes from its handoff"]),
  };
}

/** The ticket view's pause row: its label says the state, so the value does not say it again. */
export function pauseRow(pause: PauseView, now: number): { label: string; value: string } {
  const since = pause.since === null ? null : ago(pause.since, now);
  if (pause.state === "pausing") {
    return { label: "Pausing:", value: joined(["the owner is writing its handoff", since === null ? null : `asked ${since}`, `pauses without one after ${PAUSE_HANDOFF_TIMEOUT_MS / 60_000} min`]) ?? "" };
  }
  if (pause.state === "queued-to-resume") {
    return { label: "Resuming:", value: joined(["queued: a fresh owner starts when a slot frees", since === null ? null : `Resume pressed ${since}`]) ?? "" };
  }
  return { label: "Paused:", value: joined(["by you", since, pause.withoutHandoff ? "no handoff: resumes from the latest milestone" : "resumes from its handoff"]) ?? "" };
}

/** Why a stalled card stopped, from the plugin's reason or else from the owner's Paseo status and last words. */
function stalledLines(card: Card, now: number): Lines {
  const last = card.lastStatus;
  const when = last === null ? null : ago(last.at, now);
  if (card.stalledReason !== null) return { headline: card.stalledReason, detail: when };
  if (card.owner === null) return { headline: "No owner is running", detail: null };
  if (card.owner.status === "error") return { headline: "The owner stopped with an error", detail: when };
  if (card.owner.status === "closed") return { headline: "The owner was closed", detail: when };
  if (last !== null && last.state === "failed") return { headline: `Failed: ${last.text}`, detail: when };
  return { headline: "Still idle after a nudge", detail: last === null ? null : joined([`Last said: ${last.text}`, when]) };
}

export function joined(parts: readonly (string | null)[]): string | null {
  const kept = parts.filter((part): part is string => part !== null && part !== "");
  return kept.length === 0 ? null : kept.join(" · ");
}

function ago(at: string, now: number): string | null {
  const text = relativeTime(at, now);
  return text === "" ? null : text;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowercased(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The card's muted footer, in order: complexity, investigation, context, subagents (where a teammate's
 * owner runs is the now line).
 * A child's owner is its parent's, so its context stays on the parent's card.
 */
/** A no-break space before each dot: a wrapped meta line never starts with "·" (TR-095). */
export const FOOTER_SEPARATOR = "\u00a0· ";

/**
 * The footer: the meta parts joined, ending with the dot before the PR mark when there is one (so a mark
 * wrapped onto its own line does not start with it), then the PR mark's "PR #N" (null without a PR).
 */
export function cardFooterLine(card: Card): { meta: string; pullRequest: string | null } {
  const parts = cardFooterParts(card);
  const pullRequest = card.pullRequest === null ? null : pullRequestNumberLabel(card.pullRequest);
  return { meta: parts.join(FOOTER_SEPARATOR) + (parts.length > 0 && pullRequest !== null ? FOOTER_SEPARATOR.trimEnd() : ""), pullRequest };
}

export function cardFooterParts(card: Card): string[] {
  const parts: string[] = [];
  if (card.complexity !== null) parts.push(card.complexity);
  if (card.investigation) parts.push("investigation");
  const used = card.parent === null ? (card.owner?.contextUsedTokens ?? null) : null;
  if (used !== null) parts.push(`context ${formatTokenCount(used)}`);
  if (card.subagents.length > 0) parts.push(`${card.subagents.length} subagent${card.subagents.length === 1 ? "" : "s"}`);
  return parts;
}
