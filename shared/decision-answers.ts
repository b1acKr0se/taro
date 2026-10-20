/**
 * What an answer to a decision sends the agent and records on its ticket. A card asking several
 * questions (TR-207) is answered one question at a time but sent as one message, a line per
 * question in the card's order. Pure, shared by the daemon and its tests.
 */
import type { DecisionOption, DecisionQuestion } from "./reports";

/** One question's answer as the card sends it: the option pressed (null for Other) and the words typed. */
export type QuestionAnswer = { header: string; label: string | null; text: string };

/**
 * The words an answer sends: the option's prompt alone, the typed words alone (Other), or both when
 * the option asks for words (its prompt ends with "…", TR-028). Text that already starts with the
 * prompt (the card prefills it; older cards send the prompt alone) is not repeated. Empty when
 * there is nothing to send.
 */
export function answerWords(option: Pick<DecisionOption, "prompt"> | null, text: string): string {
  const typed = text.trim();
  if (option === null) return typed;
  const prompt = option.prompt.trim();
  const lead = prompt.replace(/…$/, "").trim();
  return typed === "" ? prompt : typed.startsWith(lead) ? typed : `${lead}: ${typed}`;
}

/**
 * Every question's answer, in the card's order: the message for the agent (`<header>: <prompt>` or
 * `<header>: "<typed words>"` per line), what is stored, and the ANSWER record's middle. Throws when
 * a question has no answer, as half an answer would leave the agent guessing the rest.
 */
export function severalAnswers(questions: readonly DecisionQuestion[], answers: readonly QuestionAnswer[]): { message: string; answers: QuestionAnswer[]; record: string } {
  const unanswered = questions.filter((question) => !answers.some((answer) => answer.header === question.header));
  if (unanswered.length > 0) {
    throw new Error(`Answer every question first: ${questions.length - unanswered.length} of ${questions.length} answered (${unanswered.map((question) => question.header).join(", ")} still open).`);
  }
  const settled = questions.map((question) => {
    const given = answers.find((answer) => answer.header === question.header) ?? { header: question.header, label: null, text: "" };
    const option = given.label === null ? null : question.options.find((candidate) => candidate.label === given.label) ?? null;
    const words = answerWords(option, given.text);
    if (words === "") throw new Error(`Type an answer or press an option for ${question.header}.`);
    return { header: question.header, label: option?.label ?? null, text: words };
  });
  return {
    message: settled.map((answer) => `${answer.header}: ${answer.label === null ? `"${answer.text}"` : answer.text}`).join("\n"),
    answers: settled,
    record: settled.map((answer) => `${answer.header}: ${answer.label ?? "Other"} ("${answer.text}")`).join("; "),
  };
}
