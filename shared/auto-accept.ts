/**
 * The project-wide auto-accept switch (TR-257): when the plugin may accept a ticket for the user, and
 * the list of tickets it never takes. Pure; the server reads the facts and acts.
 */
import { deliveryOnOffer } from "./delivery-end";
import { deliveryGaps, roundRecords } from "./execution";

export interface AutoAcceptTicket {
  status: string;
  labels: readonly string[];
  notes: string | null;
  finalSummary: string | null;
  /** What Accept needs recorded to merge (the project's own settings). */
  config: { acceptAlsoMerges: boolean; delivery: string };
  /** What the evidence still lacks (empty when complete). */
  evidenceMissing: readonly string[];
  /** The owner's status; null when no owner is alive. */
  ownerStatus: string | null;
  /** An owner's question or plan approval waits for the user. */
  decisionOpen: boolean;
}

/** A record that means an Accept already ran for this delivery, so the plugin must not start another. */
const SPENT_RECORD = /^(?:ACCEPTED|ACCEPT-HANDOFF|NOT-MERGED|NOT-SYNCED|AUTO-ACCEPT(?!-))\b/;
const PRESENTED_RECORD = /^(?:EVIDENCE|CHANGES-REQUESTED)\b/;

/**
 * Why the plugin may not accept the ticket for the user, or null when it may. Every reason leaves the
 * normal Accept card in place: nothing here retries or hands over.
 */
export function autoAcceptBlock(ticket: AutoAcceptTicket): string | null {
  if (ticket.status !== "Awaiting acceptance") return "it is not awaiting acceptance";
  if (!deliveryOnOffer({ status: ticket.status, notes: ticket.notes })) return "its Accept is already under way";
  if (spentSinceDelivery(ticket.notes)) return "an Accept already ran for this delivery";
  if (ticket.ownerStatus === null) return "it has no live owner";
  if (ticket.ownerStatus === "running" || ticket.ownerStatus === "initializing") return "its owner is still delivering";
  if (ticket.evidenceMissing.length > 0) return `the evidence is missing ${ticket.evidenceMissing.join("; ")}`;
  if ((ticket.finalSummary ?? "").trim() === "") return "it has no FINAL summary";
  const gaps = deliveryGaps(ticket.config, ticket.labels.includes("investigation"), ticket.notes, ticket.finalSummary);
  if (gaps.length > 0) return gaps.join("; ");
  if (ticket.decisionOpen) return "a question or plan approval is still open";
  return reviewBlock(ticket.labels, ticket.notes);
}

/** Whether an Accept, a hand-off or a failed merge came after the newest evidence or presented review head. */
function spentSinceDelivery(notes: string | null): boolean {
  const records = roundRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (SPENT_RECORD.test(record)) return true;
    if (PRESENTED_RECORD.test(record) || (/^EXECUTION\b/.test(record) && /\breview[ _-]?head\b/i.test(record))) return false;
  }
  return false;
}

const COMPLEXITY_NEEDING_REVIEW = /^complexity-(?:medium|high)$/;
const BLOCKERS_OPEN = /^[-*\s]*blockers-open\s*[:=]\s*(\d+)\b/im;

/**
 * A REVIEW record states `blockers-open: N`. The newest one decides: any open blocker, or a review that
 * does not say, keeps the ticket on the Accept card. A medium or high ticket with no review at all is not
 * taken either, since its independent review is what the user relies on.
 */
function reviewBlock(labels: readonly string[], notes: string | null): string | null {
  const reviews = roundRecords(notes).filter((record) => /^REVIEW\b/.test(record));
  const newest = reviews[reviews.length - 1];
  if (newest === undefined) return labels.some((label) => COMPLEXITY_NEEDING_REVIEW.test(label)) ? "it has no REVIEW record" : null;
  const open = BLOCKERS_OPEN.exec(newest)?.[1];
  if (open === undefined) return "its newest REVIEW record does not say `blockers-open: N`";
  return Number.parseInt(open, 10) === 0 ? null : `its newest REVIEW record leaves ${open} blocker${open === "1" ? "" : "s"} open`;
}

const HOLD_ID = /^[A-Z][A-Z0-9]*-\d+(?:\.\d+)*$/;

/** The hold list as typed (one id per line or comma-separated): the ids, upper-case and once each, and the words that are no ticket id. */
export function parseHoldList(text: string): { ids: string[]; invalid: string[] } {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const word of text.split(/[\s,;]+/).filter((each) => each !== "")) {
    const id = word.toUpperCase();
    if (!HOLD_ID.test(id)) invalid.push(word);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, invalid };
}

export function holdListText(ids: readonly string[]): string {
  return ids.join("\n");
}

/** The record a ticket gets when the user holds it back from auto-accept. */
export function autoAcceptHoldRecord(at: string): string {
  return `AUTO-ACCEPT-HOLD ${at} — held by the user: auto-accept leaves this ticket to the Accept button`;
}

/** The record the plugin writes when it accepts a ticket for the user. */
export function autoAcceptRecord(at: string): string {
  return `AUTO-ACCEPT ${at} — auto-accept was on`;
}

