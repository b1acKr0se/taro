/**
 * What an owner's past plans say in its chat (TR-135): a plan answered or asked again leaves one
 * labelled line under its message, "Plan · approved 08:12", where the card was; only the newest
 * open plan keeps a live card. The answers come from the ticket's ANSWER records, matched to each
 * asking by time. Pure.
 */
import { SCOPE_APPROVAL } from "../shared/decision-view";
import { parseDecisionBlocks } from "../shared/reports";

/** One answer the plan card sent, from an ANSWER record. */
export interface PlanAnswer {
  at: string;
  /** "approved", "changes requested", or another option's label (Split into children). */
  outcome: string;
}

export interface PlanLine {
  /** What the user answered; null when it was not answered on the card. */
  outcome: string | null;
  /** When it was answered; null without an answer record. */
  at: string | null;
  /** Asked again further down. */
  replaced: boolean;
  /** Without an answer: withdrawn by the owner, or answered in words in the chat (the owner then withdraws it). */
  closed: "withdrawn" | "answered in chat" | null;
}

const RECORD = /^ANSWER (\S+) — scope-approval: ".*" → (.*)$/;

/** The plan answers in a ticket's notes, oldest first. */
export function planAnswers(notes: string | null): PlanAnswer[] {
  if (notes === null) return [];
  return notes
    .split("\n")
    .flatMap((line) => {
      const match = RECORD.exec(line.trim());
      if (match === null || match[1] === undefined || match[2] === undefined || Number.isNaN(Date.parse(match[1]))) return [];
      return [{ at: match[1], outcome: answerOutcome(match[2]) }];
    })
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

/** `Approve ("Approve")`, `Request changes ("…")`, or bare `"…"`: words typed on a plan are never approval (TR-140). */
function answerOutcome(answer: string): string {
  if (answer.startsWith('"')) return "changes requested";
  const label = answer.split(' ("')[0]?.trim() ?? "";
  if (label === "Approve") return "approved";
  if (label === "" || label === "Request changes") return "changes requested";
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/**
 * The line under each past plan, by row key. `liveRow` is the message whose plan is drawn as the
 * live card (none). Rows without a time are left alone. The newest asking with nothing after it
 * gets no line: its card may simply not be stored yet while the owner's turn ends.
 */
export function planLines(rows: readonly { key: string; kind: string; text: string; at?: string | undefined }[], answers: readonly PlanAnswer[], liveRow: string | null): Map<string, PlanLine> {
  const askings: { index: number; at: number }[] = [];
  const withdrawals: number[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== "agent") return;
    const plans = parseDecisionBlocks(row.text).filter((block) => block.id === SCOPE_APPROVAL);
    const at = row.at === undefined ? Number.NaN : Date.parse(row.at);
    if (plans.some((block) => !block.withdrawn) && !Number.isNaN(at)) askings.push({ index, at });
    else if (plans.some((block) => block.withdrawn)) withdrawals.push(index);
  });
  const lines = new Map<string, PlanLine>();
  askings.forEach((asking, position) => {
    const row = rows[asking.index];
    if (row === undefined || row.key === liveRow) return;
    const next = askings[position + 1];
    const end = next?.at ?? Number.POSITIVE_INFINITY;
    const endIndex = next?.index ?? rows.length;
    const answer = answers.find((each) => Date.parse(each.at) >= asking.at && Date.parse(each.at) < end);
    const between = rows.slice(asking.index + 1, endIndex);
    const userSpoke = between.some((each) => each.kind === "user");
    const withdrawn = withdrawals.some((index) => index > asking.index && index < endIndex);
    if (answer === undefined && next === undefined && !withdrawn && !userSpoke) return;
    lines.set(row.key, {
      outcome: answer?.outcome ?? null,
      at: answer?.at ?? null,
      replaced: next !== undefined,
      closed: answer !== undefined ? null : userSpoke ? "answered in chat" : withdrawn ? "withdrawn" : null,
    });
  });
  return lines;
}

/** "Plan · changes requested 08:10 — replaced by the plan below"; `clock` formats a time ("08:10"). */
export function planLineText(line: PlanLine, clock: (iso: string) => string | null): string {
  const time = line.at === null ? null : clock(line.at);
  const what = line.outcome !== null ? [line.outcome, time].filter((part) => part !== null).join(" ") : line.closed;
  const parts = [what, line.replaced ? "replaced by the plan below" : null].filter((part) => part !== null);
  return `Plan · ${parts.length === 0 ? "closed" : parts.join(" — ")}`;
}
