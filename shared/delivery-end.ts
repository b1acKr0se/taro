/**
 * An owner that asks a blocking question while its ticket awaits acceptance went back to work (TR-130):
 * the user chatted instead of pressing Request changes. The delivery ends as Send changes ends it
 * (TR-131), so the board and the chat show the question alone; the owner's next delivery brings the
 * acceptance card back. Pure.
 */
import { acceptedRecord } from "./execution";

/** An investigation delivers by asking this (roles/owner.md): its question is the delivery itself. */
const DELIVERING_QUESTION = "investigation-done";

/** The first newly opened question that ends a delivery: blocking, and not the one an investigation delivers with. */
export function questionEndingDelivery<D extends { id: string; blocking: boolean }>(opened: readonly D[]): D | null {
  return opened.find((decision) => decision.blocking && decision.id !== DELIVERING_QUESTION) ?? null;
}

/** Whether a ticket's delivery is still on offer: Awaiting acceptance and not accepted (once accepted, the owner is merging). */
export function deliveryOnOffer(ticket: { status: string; notes: string | null }): boolean {
  return ticket.status === "Awaiting acceptance" && acceptedRecord(ticket.notes) === null;
}

export function deliveryEndedRecord(at: string, question: string): string {
  return `DELIVERY-ENDED ${at} — the owner asked \`${question}\` while awaiting acceptance: back to In Progress until it delivers again`;
}
