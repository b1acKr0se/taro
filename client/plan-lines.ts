/**
 * What an owner's past plans say in its chat (TR-135): a plan answered or asked again leaves a
 * finished card under its message, "Plan · Approved 08:12", where the live card was; only the newest
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
  /** What the user typed with the answer, from its first line; null when the record carries none. */
  words: string | null;
}

export interface PlanLine {
  /** What the user answered; null when it was not answered on the card. */
  outcome: string | null;
  /** When it was answered, or withdrawn (the withdrawing message's time); null without either. */
  at: string | null;
  /** The words typed with the answer; null without any. */
  words: string | null;
  /** When the plan was asked: its message's time, to find the plan in the tracker's history (TR-157). */
  askedAt: string;
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
      return [{ at: match[1], outcome: answerOutcome(match[2]), words: answerWords(match[2]) }];
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

/** The words inside `Label ("words")` or a bare `"words"`, without the record's "(the user, from …)" tail. */
function answerWords(answer: string): string | null {
  const body = answer.replace(/\s*\(the user, from [^)]*\)\s*$/, "");
  const words = body.startsWith('"') ? body.slice(1).replace(/"$/, "") : body.includes(' ("') ? body.slice(body.indexOf(' ("') + 3).replace(/"\)$/, "") : "";
  return words.trim() === "" ? null : words.trim();
}

/**
 * The line under each past plan, by row key. `liveRow` is the message whose plan is drawn as the
 * live card (none). Rows without a time are left alone. The newest asking with nothing after it
 * gets no line: its card may simply not be stored yet while the owner's turn ends. `settling`: a
 * plan was just answered and its record is still being read, so the newest asking waits for it
 * rather than read as answered in chat.
 */
export function planLines(
  rows: readonly { key: string; kind: string; text: string; at?: string | undefined }[],
  answers: readonly PlanAnswer[],
  liveRow: string | null,
  settling = false,
): Map<string, PlanLine> {
  const askings: { index: number; at: number; iso: string }[] = [];
  const withdrawals: number[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== "agent") return;
    const plans = parseDecisionBlocks(row.text).filter((block) => block.id === SCOPE_APPROVAL);
    const at = row.at === undefined ? Number.NaN : Date.parse(row.at);
    if (plans.some((block) => !block.withdrawn) && row.at !== undefined && !Number.isNaN(at)) askings.push({ index, at, iso: row.at });
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
    const firstWithdrawal = withdrawals.find((index) => index > asking.index && index < endIndex);
    const withdrawn = firstWithdrawal !== undefined;
    // The user's words answered it only when the owner had not already withdrawn it.
    const userSpoke = rows.slice(asking.index + 1, firstWithdrawal ?? endIndex).some((each) => each.kind === "user");
    if (answer === undefined && next === undefined && (settling || (!withdrawn && !userSpoke))) return;
    const closed = answer !== undefined ? null : userSpoke ? "answered in chat" : withdrawn ? "withdrawn" : null;
    lines.set(row.key, {
      outcome: answer?.outcome ?? null,
      at: answer?.at ?? (closed === "withdrawn" && firstWithdrawal !== undefined ? (rows[firstWithdrawal]?.at ?? null) : null),
      words: answer?.words ?? null,
      askedAt: asking.iso,
      replaced: next !== undefined,
      closed,
    });
  });
  return lines;
}
