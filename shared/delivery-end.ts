/**
 * An owner that asks a blocking question while its ticket awaits acceptance went back to work (TR-130):
 * the user chatted instead of pressing Request changes. The delivery ends as Send changes ends it
 * (TR-131), so the board and the chat show the question alone; the owner's next delivery brings the
 * acceptance card back. Pure.
 */
import { INVESTIGATION_DONE } from "./approval-gate";
import { acceptedRecord, notMergedRecord } from "./execution";
import { wentOnWithDefault } from "./planning-questions";

/** An investigation once delivered by asking this; it now delivers like any ticket, but one still open from before closes as it did. */
const DELIVERING_QUESTION = INVESTIGATION_DONE;

/**
 * A question that asks the user to accept or merge the ticket (TR-200). The delivery's Accept card does
 * both, so a second one would only be a button that merges nothing. Matches the id `merge`, `accept` or
 * `acceptance`, an id that starts with `accept-`, and a question that opens with Accept or Merge, on
 * a card asking several (TR-207) any of its questions.
 */
export function asksToAccept(decision: { id: string; question: string; questions?: readonly { question: string }[] | undefined }): boolean {
  const opensWithAccept = (question: string) => /^\s*(accept|merge)\b/i.test(question);
  return /^(merge|accept|acceptance)$|^accept-/i.test(decision.id) || opensWithAccept(decision.question) || (decision.questions ?? []).some((each) => opensWithAccept(each.question));
}

/** The first newly opened question that ends a delivery: blocking, and not the old investigation-done. */
export function questionEndingDelivery<D extends { id: string; blocking: boolean }>(opened: readonly D[]): D | null {
  return opened.find((decision) => decision.blocking && decision.id !== DELIVERING_QUESTION) ?? null;
}

/**
 * The owner's question still open while its delivery is on offer (TR-146): the user answers every
 * question before Accept, so the plugin takes such a delivery back. Not the question an investigation
 * delivers with, nor one the owner went on with by default after approval (TR-263): that one closes at delivery.
 */
export function questionOpenAtDelivery<D extends { id: string; agentId: string; status: string; madeNonBlocking?: boolean | undefined }>(decisions: readonly D[], agentId: string): D | null {
  return decisions.find((decision) => decision.agentId === agentId && decision.status === "open" && decision.id !== DELIVERING_QUESTION && !wentOnWithDefault(decision)) ?? null;
}

/** The owner's questions still open at delivery that it went on with by default after approval (TR-263): closed as decided. */
export function questionsDefaultedAtDelivery<D extends { agentId: string; status: string; madeNonBlocking?: boolean | undefined }>(decisions: readonly D[], agentId: string): D[] {
  return decisions.filter((decision) => decision.agentId === agentId && decision.status === "open" && wentOnWithDefault(decision));
}

/**
 * The owner's open question that holds Accept back (TR-146): the user answers it first. Pass one ticket's
 * decisions. Not one the owner went on with by default after approval (TR-263).
 */
export function questionHoldingAccept<D extends { id: string; agentRole: string; status: string; madeNonBlocking?: boolean | undefined }>(decisions: readonly D[]): D | null {
  return decisions.find((decision) => decision.agentRole === "owner" && decision.status === "open" && decision.id !== DELIVERING_QUESTION && !wentOnWithDefault(decision)) ?? null;
}

/**
 * Whether a ticket's delivery is still on offer: Awaiting acceptance, not accepted (once accepted, the
 * owner is merging), and its pull request not already merged (NOT-SYNCED: only the local base branch is behind).
 */
export function deliveryOnOffer(ticket: { status: string; notes: string | null }): boolean {
  return ticket.status === "Awaiting acceptance" && acceptedRecord(ticket.notes) === null && notMergedRecord(ticket.notes)?.merged !== true;
}

/**
 * The owner is still in a turn on a delivered ticket (TR-153): its delivery message, or its reply to the
 * user, is not written yet. The board places it in Working, so nothing offers Accept until the turn ends.
 */
export function stillDelivering(status: string, ownerStatus: string | null): boolean {
  return status === "Awaiting acceptance" && (ownerStatus === "running" || ownerStatus === "initializing");
}

export function deliveryEndedRecord(at: string, question: string): string {
  return `DELIVERY-ENDED ${at} — the owner asked \`${question}\` while awaiting acceptance: back to In Progress until it delivers again`;
}

export function deliveryTakenBackRecord(at: string, question: string): string {
  return `DELIVERY-ENDED ${at} — the owner delivered with \`${question}\` still open: back to In Progress until it is answered and the owner delivers again`;
}
