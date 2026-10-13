/**
 * What a board card says is happening now (TR-026, TR-031): the first of why it stalled, what it asks
 * of you, that it was accepted and is merging, where a teammate's owner runs, the subagent the owner
 * waits on, or the owner's last status line. Each is a headline read whole (it wraps, never cut
 * mid-fact), a muted detail under it, and for an ask the action that opens it. Pure.
 */
import type { Card } from "../shared/contracts";
import type { StatusState } from "../shared/reports";
import { callAction, cardCalls, type CardCall } from "./card-calls";
import { formatTokenCount, relativeTime } from "./format";
import { waitingOn } from "./pane-agents";

interface Lines {
  headline: string;
  /** Muted, under the headline: evidence, what is missing, more asks, how long ago. */
  detail: string | null;
}

export type NowLine =
  | ({ kind: "stalled" } & Lines)
  | ({ kind: "call"; call: CardCall; action: string } & Lines)
  | ({ kind: "accepted" } & Lines)
  | ({ kind: "elsewhere" } & Lines)
  | ({ kind: "subagent" } & Lines)
  | ({ kind: "status"; state: StatusState } & Lines);

export function cardNowLine(card: Card, now: number): NowLine | null {
  if (card.column === "stalled") return { kind: "stalled", ...stalledLines(card, now) };
  const calls = cardCalls(card);
  const first = calls[0];
  if (first !== undefined) return { kind: "call", call: first, action: callAction(first), ...callLines(card, first, calls.slice(1)) };
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
  const last = card.lastStatus;
  if (last !== null) return { kind: "status", state: last.state, headline: capitalised(last.text), detail: joined([capitalised(last.state), ago(last.at, now)]) };
  return null;
}

function callLines(card: Card, call: CardCall, others: readonly CardCall[]): Lines {
  // Other asks beside the first: further questions, then acceptance or permissions in their own words.
  const also = [
    call.kind === "decision" && call.more > 0 ? `${call.more} more question${call.more === 1 ? "" : "s"}` : null,
    ...others.map((other) => (other.kind === "decision" ? `${other.more + 1} more question${other.more === 0 ? "" : "s"}` : `also ${lowercased(other.text)}`)),
  ];
  if (call.kind === "decision") return { headline: call.text, detail: joined([call.blocking ? "Blocking" : null, ...also]) };
  if (call.kind === "acceptance") {
    const evidence = card.evidence;
    const facts = evidence === null ? null : evidence.complete ? call.evidence : `Missing: ${evidence.missing.join(", ")}`;
    return { headline: call.text, detail: joined([facts, ...also]) };
  }
  return { headline: call.text, detail: joined(also) };
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

function joined(parts: readonly (string | null)[]): string | null {
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

/** Over this much context an idle owner offers Compact on its card. */
export const COMPACT_OFFER_TOKENS = 150_000;

/**
 * The card's muted footer, in order: complexity, investigation, context, subagents (where a teammate's
 * owner runs is the now line).
 * A child's owner is its parent's, so its context (and Compact) stay on the parent's card.
 */
export function cardFooterParts(card: Card): string[] {
  const parts: string[] = [];
  if (card.complexity !== null) parts.push(card.complexity);
  if (card.investigation) parts.push("investigation");
  const used = card.parent === null ? (card.owner?.contextUsedTokens ?? null) : null;
  if (used !== null) parts.push(`context ${formatTokenCount(used)}`);
  if (card.subagents.length > 0) parts.push(`${card.subagents.length} subagent${card.subagents.length === 1 ? "" : "s"}`);
  return parts;
}

export function offersCompact(card: Card): boolean {
  const owner = card.owner;
  return card.parent === null && owner !== null && owner.status === "idle" && (owner.contextUsedTokens ?? 0) > COMPACT_OFFER_TOKENS;
}
