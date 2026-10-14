/**
 * The questions an agent asks (Claude's AskUserQuestion, and the providers
 * that mimic it), as a pending permission of kind `question`.
 *
 * A port of Paseo's own `components/question-form-card-core.ts` (0.9), so the
 * panel answers exactly as the agent's tab would: `allow` with the request's
 * input plus an `answers` map keyed by each question's header, or `deny` with
 * "Dismissed by user". The daemon does the provider-specific part — it adds
 * `allowOther` to Claude's questions on the way out and re-keys the answers
 * by question text on the way back — so nothing here knows about Claude.
 *
 * Pure: the form that draws it is `permission-card.tsx`.
 */

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
  allowEmpty: boolean;
  placeholder?: string;
  dismissLabel?: string;
}

/** Selected option indexes, by question index. */
export type Selections = Readonly<Record<number, ReadonlySet<number>>>;
/** Typed answers, by question index. */
export type OtherTexts = Readonly<Record<number, string>>;
/** Whether the Other row is picked, by question index (TR-083). */
export type OtherPicks = Readonly<Record<number, boolean>>;

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** The request's questions, or null when its input is not a question form. */
export function parseQuestions(input: unknown): Question[] | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = (input as Record<string, unknown>).questions;
  if (!Array.isArray(raw)) return null;
  const questions: Question[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const q = item as Record<string, unknown>;
    if (typeof q.question !== "string" || typeof q.header !== "string" || !Array.isArray(q.options)) return null;
    const options: QuestionOption[] = [];
    for (const option of q.options as unknown[]) {
      if (typeof option !== "object" || option === null) return null;
      const o = option as Record<string, unknown>;
      if (typeof o.label !== "string") return null;
      options.push(typeof o.description === "string" ? { label: o.label, description: o.description } : { label: o.label });
    }
    const placeholder = optionalString(q, "placeholder");
    const dismissLabel = optionalString(q, "dismissLabel");
    questions.push({
      question: q.question,
      header: q.header,
      options,
      multiSelect: q.multiSelect === true,
      allowOther: q.allowOther === true || q.isOther === true,
      allowEmpty: q.allowEmpty === true,
      ...(placeholder === undefined ? {} : { placeholder }),
      ...(dismissLabel === undefined ? {} : { dismissLabel }),
    });
  }
  return questions.length > 0 ? questions : null;
}

export function showsTextInput(question: Question): boolean {
  return question.options.length === 0 || question.allowOther;
}

/** A question with options that takes words gets an Other row, last, which opens its box (TR-083). */
export function hasOtherRow(question: Question): boolean {
  return question.options.length > 0 && question.allowOther;
}

/**
 * Whether the box takes words: always on a question of words alone, otherwise only with Other picked.
 * Words typed under Other stay in the greyed box when another option is picked, and are not sent.
 */
export function typingEnabled(question: Question, index: number, otherPicks: OtherPicks): boolean {
  if (!showsTextInput(question)) return false;
  return question.options.length === 0 || otherPicks[index] === true;
}

function typedAnswer(question: Question, index: number, otherTexts: OtherTexts, otherPicks: OtherPicks): string {
  return typingEnabled(question, index, otherPicks) ? (otherTexts[index]?.trim() ?? "") : "";
}

export function isAnswered(question: Question, index: number, selections: Selections, otherTexts: OtherTexts, otherPicks: OtherPicks): boolean {
  if (typedAnswer(question, index, otherTexts, otherPicks) !== "") return true;
  // Other picked asks for words, even beside options ticked in a multi-select.
  if (hasOtherRow(question) && otherPicks[index] === true && !question.allowEmpty) return false;
  if ((selections[index]?.size ?? 0) > 0) return true;
  return showsTextInput(question) && question.allowEmpty;
}

export function allAnswered(questions: readonly Question[], selections: Selections, otherTexts: OtherTexts, otherPicks: OtherPicks): boolean {
  return questions.every((question, index) => isAnswered(question, index, selections, otherTexts, otherPicks));
}

/** The picked options' labels and the words typed under Other, joined with commas; an optional question of words alone may be empty. */
export function buildAnswers(
  questions: readonly Question[],
  selections: Selections,
  otherTexts: OtherTexts,
  otherPicks: OtherPicks,
): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    const labels = [...(selections[index] ?? [])]
      .map((option) => question.options[option]?.label)
      .filter((label): label is string => label !== undefined);
    const typed = typedAnswer(question, index, otherTexts, otherPicks);
    const parts = typed === "" ? labels : [...labels, typed];
    if (parts.length > 0) answers[question.header] = parts.join(", ");
    else if (question.allowEmpty && question.options.length === 0) answers[question.header] = "";
  });
  return answers;
}

/** A form of nothing but optional free-text questions is dismissed by submitting it empty, not by refusing it. */
export function dismissSubmitsEmpty(questions: readonly Question[]): boolean {
  return questions.length > 0 && questions.every((question) => question.allowEmpty && question.options.length === 0);
}

export function dismissLabel(questions: readonly Question[], fallback = "Dismiss"): string {
  return questions.find((question) => question.dismissLabel !== undefined)?.dismissLabel ?? fallback;
}

/**
 * The next selection after pressing an option: toggled in a multi-select,
 * otherwise the one option (or none, pressing it again). A single choice also
 * unpicks Other (`pickOption`).
 */
export function toggleOption(current: ReadonlySet<number> | undefined, option: number, multiSelect: boolean): Set<number> {
  const next = new Set(current ?? []);
  if (multiSelect) {
    if (!next.delete(option)) next.add(option);
    return next;
  }
  const wasSelected = next.has(option);
  next.clear();
  if (!wasSelected) next.add(option);
  return next;
}

/** Pressing an option: a single choice unpicks Other, keeping its words; a multi-select leaves Other as it is. */
export function pickOption(current: ReadonlySet<number> | undefined, otherPicked: boolean, option: number, multiSelect: boolean): { selection: Set<number>; otherPicked: boolean } {
  return { selection: toggleOption(current, option, multiSelect), otherPicked: multiSelect ? otherPicked : false };
}

/** Pressing Other: toggled; in a single choice picking it unpicks the option picked before. */
export function pickOther(current: ReadonlySet<number> | undefined, otherPicked: boolean, multiSelect: boolean): { selection: Set<number>; otherPicked: boolean } {
  return { selection: multiSelect || otherPicked ? new Set(current ?? []) : new Set<number>(), otherPicked: !otherPicked };
}
