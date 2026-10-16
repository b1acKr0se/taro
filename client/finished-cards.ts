/**
 * What a finished card says (TR-149): the outcome, its tone, its time and the user's words, for a
 * past plan and a past delivery. Parts for questions and permission asks add theirs beside. Pure.
 */
import { SCOPE_APPROVAL } from "../shared/decision-view";
import { parseDecisionBlocks, parseStatusLine } from "../shared/reports";
import type { StoredDecision } from "../shared/state";
import type { PlanLine } from "./plan-lines";

/** How the outcome reads: positive (accepted), warning (changes asked for), negative (denied), neutral (closed). */
export type FinishedTone = "positive" | "warning" | "negative" | "neutral";

export interface FinishedView {
  outcome: string;
  tone: FinishedTone;
  /** The outcome's time, formatted; null when unknown. */
  time: string | null;
  /** What the user typed with it; null without. */
  words: string | null;
}

const REPLACED = "replaced by the plan below";

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** A past plan's card: "Changes requested · replaced by the plan below" at 08:10, with the user's words. `clock` formats a time. */
export function planCardView(line: PlanLine, clock: (iso: string) => string | null): FinishedView {
  const parts = [line.outcome ?? line.closed, line.replaced ? REPLACED : null].filter((part) => part !== null);
  const changes = line.outcome === "changes requested";
  return {
    outcome: capitalized(parts.length === 0 ? "closed" : parts.join(" · ")),
    tone: line.outcome === "approved" ? "positive" : changes ? "warning" : "neutral",
    time: line.at === null ? null : clock(line.at),
    // Words on an approval are only its label: shown for changes.
    words: changes ? line.words : null,
  };
}

/** One record of a delivered ticket's acceptance, from its notes. */
export interface DeliveryRecord {
  at: string;
  kind: "changes requested" | "accepted" | "ended";
  /** The user's words with their changes; null for the others. */
  words: string | null;
}

const DELIVERY_RECORD = /^(CHANGES-REQUESTED|ACCEPTED|DELIVERY-ENDED) (\S+) — (.*)$/;

/** The acceptance records in a ticket's notes, oldest first. */
export function deliveryRecords(notes: string | null): DeliveryRecord[] {
  if (notes === null) return [];
  const lines = notes.split("\n");
  return lines
    .flatMap((line, index): DeliveryRecord[] => {
      const match = DELIVERY_RECORD.exec(line.trim());
      if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined || Number.isNaN(Date.parse(match[2]))) return [];
      if (match[1] === "ACCEPTED") return [{ at: match[2], kind: "accepted", words: null }];
      if (match[1] === "DELIVERY-ENDED") return [{ at: match[2], kind: "ended", words: null }];
      // The user's words may run over several lines: up to the blank line that ends the note.
      const rest = lines.slice(index + 1);
      const blank = rest.findIndex((each) => each.trim() === "");
      const more = blank === -1 ? rest : rest.slice(0, blank);
      const quoted = [match[3].replace(/^the user:\s*"?/, ""), ...more].join("\n").replace(/"$/, "").trim();
      return [{ at: match[2], kind: "changes requested", words: quoted === "" ? null : quoted }];
    })
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

/**
 * The record that closed each past delivery, by the row key of its `done:` message: the newest record
 * from that message's time up to the next `done:` message's. `liveRow` (the delivery under an open
 * acceptance card) gets none. Rows without a time are skipped.
 */
export function deliveryCards(
  rows: readonly { key: string; text: string; at?: string | undefined }[],
  records: readonly DeliveryRecord[],
  liveRow: string | null,
): Map<string, DeliveryRecord> {
  const cards = new Map<string, DeliveryRecord>();
  if (records.length === 0) return cards;
  const deliveries = rows.flatMap((row) => {
    const at = row.at === undefined ? Number.NaN : Date.parse(row.at);
    return Number.isNaN(at) || parseStatusLine(row.text)?.state !== "done" ? [] : [{ key: row.key, at }];
  });
  deliveries.forEach((delivery, position) => {
    if (delivery.key === liveRow) return;
    const end = deliveries[position + 1]?.at ?? Number.POSITIVE_INFINITY;
    const newest = records
      .filter((record) => Date.parse(record.at) >= delivery.at && Date.parse(record.at) < end)
      .reduce<DeliveryRecord | null>((best, record) => (best === null || Date.parse(record.at) >= Date.parse(best.at) ? record : best), null);
    if (newest !== null) cards.set(delivery.key, newest);
  });
  return cards;
}

/** A past delivery's card; "Changes requested" is a warning, as the owner has work to do again. */
export function deliveryCardView(record: DeliveryRecord, clock: (iso: string) => string | null): FinishedView {
  const time = clock(record.at);
  switch (record.kind) {
    case "accepted":
      return { outcome: "Accepted", tone: "positive", time, words: null };
    case "ended":
      return { outcome: "Delivery ended: the owner asked a question", tone: "neutral", time, words: null };
    default:
      return { outcome: "Changes requested", tone: "warning", time, words: record.words };
  }
}

/** Whether two records say the same, for a memoised row. */
export function sameAcceptanceRecord(left: DeliveryRecord | undefined, right: DeliveryRecord | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.at === right.at && left.kind === right.kind && left.words === right.words;
}

/** A question's card: what was asked and how it ended. */
export interface QuestionCardView extends FinishedView {
  subject: string;
  /** The block's id, to tell a plan (`scope-approval`) from a question. */
  id: string;
}

/** The store keeps a closed decision 14 days (`CLOSED_RETENTION_MS`); older messages have no record to find. */
const RECORD_KEPT_MS = 14 * 24 * 60 * 60 * 1000;

/** How a stored decision ended; null while it is open. A typed answer reads "Answered: “words”", a picked option's typed words come beside it. */
export function storedDecisionView(decision: StoredDecision, clock: (iso: string) => string | null): FinishedView | null {
  if (decision.status === "withdrawn") {
    return { outcome: decision.withdrawnWithAgent === true ? "Withdrawn: its agent went away" : "Withdrawn", tone: "neutral", time: null, words: null };
  }
  if (decision.status !== "answered") return null;
  const answer = decision.answer;
  const label = answer?.label ?? null;
  const typed = answer?.text.trim() ?? "";
  const time = answer === null ? null : clock(answer.at);
  if (label === null) return { outcome: typed === "" ? "Answered" : `Answered: “${typed}”`, tone: "positive", time, words: null };
  return { outcome: `Answered: ${label}`, tone: "positive", time, words: typed === "" || typed === label.trim() ? null : typed };
}

const ASKED_AGAIN: FinishedView = { outcome: "Asked again below", tone: "neutral", time: null, words: null };

/**
 * The finished cards under each agent message (TR-149): every question block it holds that is not
 * the live card (`liveKeys`), with how it ended. A plan is part of the plan cards. A block a later
 * message asks again reads "Asked again below"; otherwise the agent's stored decision says. Without
 * a stored one the message may be too new to be stored (no card) or older than the store keeps.
 */
export function questionCards(
  rows: readonly { key: string; text: string; at?: string | undefined }[],
  decisions: readonly StoredDecision[],
  liveKeys: ReadonlySet<string>,
  clock: (iso: string) => string | null = () => null,
  now: number = Date.now(),
): Map<string, QuestionCardView[]> {
  const cards = new Map<string, QuestionCardView[]>();
  const asked = rows.map((row) => parseDecisionBlocks(row.text).filter((block) => !block.withdrawn));
  rows.forEach((row, index) => {
    const seen = new Set<string>();
    const here = (asked[index] ?? []).flatMap((block): QuestionCardView[] => {
      if (block.id === SCOPE_APPROVAL || seen.has(block.id)) return [];
      seen.add(block.id);
      const base = { subject: block.question, id: block.id };
      if (asked.slice(index + 1).some((later) => later.some((each) => each.id === block.id))) return [{ ...base, ...ASKED_AGAIN }];
      if ([...liveKeys].some((key) => key.endsWith(`:${block.id}`))) return [];
      const stored = decisions.find((decision) => decision.id === block.id);
      if (stored === undefined) {
        const at = row.at === undefined ? Number.NaN : Date.parse(row.at);
        // No time, or a recent one: the decision may not be stored yet.
        if (Number.isNaN(at) || now - at < RECORD_KEPT_MS) return [];
        return [{ ...base, outcome: "No record kept", tone: "neutral", time: null, words: null }];
      }
      const view = storedDecisionView(stored, clock);
      return view === null ? [] : [{ ...base, ...view }];
    });
    if (here.length > 0) cards.set(row.key, here);
  });
  return cards;
}

/** Whether two rows' question cards say the same, for a memoised row. */
export function sameQuestionCards(left: readonly QuestionCardView[] | undefined, right: readonly QuestionCardView[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((card, index) => JSON.stringify(card) === JSON.stringify(right[index]));
}
