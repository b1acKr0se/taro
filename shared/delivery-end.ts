/**
 * An owner that asks a blocking question while its ticket awaits acceptance went back to work (TR-130):
 * the user chatted instead of pressing Request changes. The delivery ends as Send changes ends it
 * (TR-131), so the board and the chat show the question alone; the owner's next delivery brings the
 * acceptance card back. Pure.
 */
import { acceptedRecord, notMergedRecord } from "./execution";

/** An investigation delivers by asking this (roles/owner.md): its question is the delivery itself. */
const DELIVERING_QUESTION = "investigation-done";

/** The first newly opened question that ends a delivery: blocking, and not the one an investigation delivers with. */
export function questionEndingDelivery<D extends { id: string; blocking: boolean }>(opened: readonly D[]): D | null {
  return opened.find((decision) => decision.blocking && decision.id !== DELIVERING_QUESTION) ?? null;
}

/**
 * The owner's question still open while its delivery is on offer (TR-146): the user answers every
 * question before Accept, so the plugin takes such a delivery back. Not the question an investigation
 * delivers with.
 */
export function questionOpenAtDelivery<D extends { id: string; agentId: string; status: string }>(decisions: readonly D[], agentId: string): D | null {
  return decisions.find((decision) => decision.agentId === agentId && decision.status === "open" && decision.id !== DELIVERING_QUESTION) ?? null;
}

/** The owner's open question that holds Accept back (TR-146): the user answers it first. Pass one ticket's decisions. */
export function questionHoldingAccept<D extends { id: string; agentRole: string; status: string }>(decisions: readonly D[]): D | null {
  return decisions.find((decision) => decision.agentRole === "owner" && decision.status === "open" && decision.id !== DELIVERING_QUESTION) ?? null;
}

/**
 * Whether a ticket's delivery is still on offer: Awaiting acceptance, not accepted (once accepted, the
 * owner is merging), and its pull request not already merged (NOT-SYNCED: only the local base branch is behind).
 */
export function deliveryOnOffer(ticket: { status: string; notes: string | null }): boolean {
  return ticket.status === "Awaiting acceptance" && acceptedRecord(ticket.notes) === null && notMergedRecord(ticket.notes)?.merged !== true;
}

export function deliveryEndedRecord(at: string, question: string): string {
  return `DELIVERY-ENDED ${at} — the owner asked \`${question}\` while awaiting acceptance: back to In Progress until it delivers again`;
}

export function deliveryTakenBackRecord(at: string, question: string): string {
  return `DELIVERY-ENDED ${at} — the owner delivered with \`${question}\` still open: back to In Progress until it is answered and the owner delivers again`;
}
