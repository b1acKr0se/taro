/**
 * What a board card asks of the user (TR-022), each in the asker's own words (TR-045): the question
 * itself with its options, what a permission asks to do, the delivery's summary. The card draws the
 * first; answering in full happens where its context is, in the owner's chat. Pure.
 */
import type { Card } from "../shared/contracts";
import { evidenceSummary } from "../shared/evidence";
import { askerPrefix } from "../shared/needs-you";
import type { StoredDecision } from "../shared/state";
import { walkOrder } from "./walk-order";

export type CardCall =
  /** The first open decision in Walk me through order; `more` counts the rest. */
  | { kind: "decision"; decision: StoredDecision; more: number }
  /** Delivered and waiting for Accept / Request changes: the delivery in a line and the evidence in one (TR-021); why an earlier Accept did not merge (TR-109). */
  | { kind: "acceptance"; ready: boolean; delivered: string | null; evidence: string | null; notMerged: string | null }
  /** The owner or a subagent stopped on Paseo permission requests: who asks first (null for the owner), what, and how many wait (TR-096). */
  | { kind: "permission"; asker: string | null; title: string | null; detail: string | null; count: number };

export function cardCalls(card: Card): CardCall[] {
  const calls: CardCall[] = [];
  const open = walkOrder(card.decisions.filter((decision) => decision.status === "open"));
  const first = open[0];
  if (first !== undefined) calls.push({ kind: "decision", decision: first, more: open.length - 1 });
  // Accepting messages the owner, so without one there is nothing to press; once accepted, nothing is left to press.
  if (card.status === "Awaiting acceptance" && card.owner !== null && card.accepted === null) {
    calls.push({ kind: "acceptance", ready: acceptanceReady(card), delivered: card.delivered, evidence: card.evidence === null ? null : evidenceSummary(card.evidence), notMerged: card.notMerged?.reason ?? null });
  }
  const ask = card.permission;
  if (ask !== null) calls.push({ kind: "permission", asker: askerPrefix(ask.role), title: ask.title, detail: ask.detail, count: Math.max(ask.count, 1) });
  return calls;
}

/** An acceptance's readiness in words. */
export function readinessText(ready: boolean): string {
  return ready ? "Ready to accept" : "Not ready to accept";
}

/** How a permission call reads when it cannot say what is asked. */
export function waitingOnPermissions(count: number): string {
  return count === 1 ? "Waiting on a permission" : `Waiting on ${count} permissions`;
}

/**
 * Whether Accept may be offered: incomplete evidence withholds it (the server refuses it too). One
 * test for the card's wording and icon and the composer row's Accept, so they cannot disagree.
 */
export function acceptanceReady(card: Pick<Card, "evidence">): boolean {
  return card.evidence === null || card.evidence.complete;
}

/** The link that opens the call where it is answered in full. */
export function callAction(call: CardCall): string {
  return call.kind === "decision" ? "Answer" : call.kind === "acceptance" && call.ready ? "Request changes" : "Review";
}
