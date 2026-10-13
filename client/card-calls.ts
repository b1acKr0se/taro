/**
 * What a board card asks of the user, one line each (TR-022). The card only names the call; it is
 * answered where its context is: pinned above the owner's chat. Pure.
 */
import type { Card } from "../shared/contracts";
import { evidenceSummary } from "../shared/evidence";
import { walkOrder } from "./walk-order";

export type CardCall =
  /** The first open decision in Walk me through order; `more` counts the rest. */
  | { kind: "decision"; text: string; blocking: boolean; more: number }
  /** Delivered and waiting for Accept / Request changes. `evidence` is the evidence in one line (TR-021). */
  | { kind: "acceptance"; text: string; evidence: string | null }
  /** The owner stopped on Paseo permission requests (a tool to run, a question form). */
  | { kind: "permission"; text: string };

export function cardCalls(card: Card): CardCall[] {
  const calls: CardCall[] = [];
  const open = walkOrder(card.decisions.filter((decision) => decision.status === "open"));
  const first = open[0];
  if (first !== undefined) calls.push({ kind: "decision", text: first.question, blocking: first.blocking, more: open.length - 1 });
  // Accepting messages the owner, so without one there is nothing to press.
  if (card.status === "Awaiting acceptance" && card.owner !== null) {
    calls.push({ kind: "acceptance", text: acceptanceReady(card) ? "Ready to accept" : "Not ready to accept", evidence: card.evidence === null ? null : evidenceSummary(card.evidence) });
  }
  const permissions = card.owner?.pendingPermissions ?? 0;
  if (permissions > 0) calls.push({ kind: "permission", text: permissions === 1 ? "Waiting on a permission" : `Waiting on ${permissions} permissions` });
  return calls;
}

/**
 * Whether Accept may be offered: incomplete evidence withholds it (the server refuses it too). One
 * test for the card's wording and icon and the composer row's Accept, so they cannot disagree.
 */
export function acceptanceReady(card: Pick<Card, "evidence">): boolean {
  return card.evidence === null || card.evidence.complete;
}

/** The link at the end of a call's line. */
export function callAction(call: CardCall): string {
  return call.kind === "decision" ? "Answer" : call.kind === "acceptance" ? "Review" : "Allow…";
}
