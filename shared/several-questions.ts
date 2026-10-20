/**
 * A card asking several questions (TR-207), as the chat card's tabs and the board's pills step
 * through it: what is picked per question, which are answered, where to go next, and what the
 * answers so far read as. Pure, so the cards stay thin views and Hermes never sees it untested.
 */
import type { QuestionAnswer } from "./decision-answers";
import { optionAsksForWords } from "./decision-view";
import type { DecisionQuestion } from "./reports";

/** One question's pick: the option pressed, or null for Other, and the words typed in its box. */
export type QuestionDraft = { label: string | null; typed: string };

/** A card's picks not sent yet, one per question (null: nothing picked), and the question shown. */
export type SeveralDrafts = { drafts: (QuestionDraft | null)[]; current: number };

/** A pill's answer is cut past this many characters, at a word, so three pills fit a phone card. */
export const PILL_ANSWER_CHARACTERS = 22;

export function freshDrafts(count: number): SeveralDrafts {
  return { drafts: Array.from({ length: count }, () => null), current: 0 };
}

/** Whether a pick answers its question: an option (with words when it asks for them), or Other with words. */
export function draftAnswered(question: Pick<DecisionQuestion, "options">, draft: QuestionDraft | null): boolean {
  if (draft === null) return false;
  if (draft.label === null) return draft.typed.trim() !== "";
  const option = question.options.find((candidate) => candidate.label === draft.label);
  if (option === undefined) return false;
  return !optionAsksForWords(option) || draft.typed.trim() !== "";
}

export function answeredFlags(questions: readonly Pick<DecisionQuestion, "options">[], drafts: readonly (QuestionDraft | null)[]): boolean[] {
  return questions.map((question, index) => draftAnswered(question, drafts[index] ?? null));
}

/** Submit (or Send) waits for every question. */
export function allAnswered(answered: readonly boolean[]): boolean {
  return answered.length > 0 && answered.every(Boolean);
}

/** The next question still open after `from`, going round to the first; null when all are answered. */
export function nextUnanswered(answered: readonly boolean[], from: number): number | null {
  const count = answered.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (from + step) % count;
    if (answered[index] !== true) return index;
  }
  return null;
}

/** What a pick reads as on a pill or the recap: the option's label, or the words typed, quoted. */
export function draftText(draft: QuestionDraft): string {
  return draft.label ?? `“${draft.typed.trim()}”`;
}

/** Text cut at a word past `limit` characters, its trailing punctuation dropped, with "…". */
export function cutText(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const head = flat.slice(0, limit + 1);
  const space = head.lastIndexOf(" ");
  const cut = space > limit / 2 ? head.slice(0, space) : flat.slice(0, limit);
  return `${cut.replace(/[\s,;:.·-]+$/, "")}…`;
}

/** A board pill: `✓ <header>: <answer>`, the answer cut when long, or the header alone while open. */
export function pillText(header: string, answer: string | null): string {
  return answer === null ? header : `✓ ${header}: ${cutText(answer, PILL_ANSWER_CHARACTERS)}`;
}

/** The chat card's recap under its tabs, from question 2: the other questions' answers so far; null when there are none. */
export function recapLine(questions: readonly Pick<DecisionQuestion, "options">[], drafts: readonly (QuestionDraft | null)[], current: number): string | null {
  if (current === 0) return null;
  const answered = questions.flatMap((question, index) => {
    const draft = drafts[index] ?? null;
    return index === current || draft === null || !draftAnswered(question, draft) ? [] : [draftText(draft)];
  });
  return answered.length === 0 ? null : `Answered: ${answered.join(" · ")}`;
}

/** What Submit sends: each question's pick, with its words only where they count (Other, or an option asking for them). */
export function draftAnswers(questions: readonly DecisionQuestion[], drafts: readonly (QuestionDraft | null)[]): QuestionAnswer[] {
  return questions.map((question, index) => {
    const draft = drafts[index] ?? { label: null, typed: "" };
    const option = draft.label === null ? undefined : question.options.find((candidate) => candidate.label === draft.label);
    const words = draft.label === null || (option !== undefined && optionAsksForWords(option)) ? draft.typed.trim() : "";
    return { header: question.header, label: draft.label, text: words };
  });
}

/** Picks as kept: with the shape of the card they were picked on (`draftsShape`). */
export type KeptDrafts = SeveralDrafts & { shape: string };

type Shaped = Pick<DecisionQuestion, "header" | "question" | "options">;

/**
 * What a card's picks belong to: its headers, questions and option labels. A decision asked again
 * keeps its key (`<agent>:<id>`), so the key alone would hand the old picks to new questions.
 */
export function draftsShape(questions: readonly Shaped[]): string {
  return JSON.stringify(questions.map((question) => [question.header, question.question, question.options.map((option) => option.label)]));
}

/**
 * The picks kept for a decision (TR-207), across the client bundle being evaluated again: restored
 * for an open decision of the same shape, dropped once it is answered or withdrawn.
 */
export function keptDrafts(store: Map<string, KeptDrafts>, decision: { key: string; status: string; questions: readonly Shaped[] }): SeveralDrafts {
  const kept = store.get(decision.key);
  if (decision.status !== "open") {
    store.delete(decision.key);
    return freshDrafts(decision.questions.length);
  }
  if (kept === undefined || kept.shape !== draftsShape(decision.questions) || kept.drafts.length !== decision.questions.length) return freshDrafts(decision.questions.length);
  return { drafts: kept.drafts, current: Math.min(Math.max(kept.current, 0), decision.questions.length - 1) };
}

/** Keeps a decision's picks with the shape of its card. */
export function keepDrafts(store: Map<string, KeptDrafts>, decision: { key: string; questions: readonly Shaped[] }, drafts: SeveralDrafts): void {
  store.set(decision.key, { drafts: drafts.drafts, current: drafts.current, shape: draftsShape(decision.questions) });
}
