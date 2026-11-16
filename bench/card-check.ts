/**
 * The text check of a decision card as the user sees it: the question and every option label are
 * there, and nothing a renderer leaks (`undefined`, a raw ```decision fence, raw JSON). Pure. Runs under
 * Node type stripping: erasable syntax, `.ts` import extensions, no packages.
 */

export interface CardFacts {
  question: string;
  /** The option labels as the agent wrote them. */
  options: readonly string[];
}

export interface CardViolation {
  kind: "card-text";
  detail: string;
}

const LEAKS: readonly { name: string; pattern: RegExp }[] = [
  { name: "undefined", pattern: /\bundefined\b/ },
  { name: "null", pattern: /\bnull\b/ },
  { name: "NaN", pattern: /\bNaN\b/ },
  { name: "[object Object]", pattern: /\[object Object\]/ },
  { name: "{}", pattern: /\{\}/ },
  { name: "a raw ```decision fence", pattern: /```\s*decision/i },
  // A JSON object or array opening a line or a quoted key: `{"id":`, `[{"label"`.
  { name: "raw JSON", pattern: /(^|\s)[{[]\s*"[A-Za-z_]+"\s*:|\[\s*\{\s*"/ },
];

/** Squeezes whitespace so a label wrapped over two lines still matches. */
const squeeze = (text: string): string => text.replace(/\s+/g, " ").trim();

/** What is wrong with a card's visible text; `[]` for a clean card. */
export function cardTextViolations(visibleText: string, facts: CardFacts): CardViolation[] {
  const found: CardViolation[] = [];
  const text = squeeze(visibleText);
  if (!text.includes(squeeze(facts.question))) found.push({ kind: "card-text", detail: `the question is not on the card: "${facts.question}"` });
  facts.options.forEach((label) => {
    if (squeeze(label) === "") found.push({ kind: "card-text", detail: "an option has an empty label" });
    else if (!text.includes(squeeze(label))) found.push({ kind: "card-text", detail: `the option "${label}" is not on the card` });
  });
  LEAKS.forEach(({ name, pattern }) => {
    // The agent's own words may use a word such as "null" about the code; only text the agent did not write is a leak.
    const written = squeeze([facts.question, ...facts.options].join(" "));
    if (pattern.test(text) && !pattern.test(written)) found.push({ kind: "card-text", detail: `the card shows ${name}` });
  });
  return found;
}
