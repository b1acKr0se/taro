/**
 * Cards and agents kept in the ticket file itself, for sessions outside Paseo (a Claude Code session, any
 * harness with a shell): the `<!-- taro:cards -->` and `<!-- taro:agents -->` sections, one JSON object a
 * line, since the `taro` command has no YAML parser. Pure and import-free beside the ticket format, so the
 * `taro` command (plain Node type stripping), the daemon and tests share it: erasable TypeScript only.
 *
 * Lines are kept as written: a malformed one is reported and left in place, and a write replaces only the
 * line of the card or agent it changes.
 */

export const CARD_STATUSES = ["open", "answered", "withdrawn"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const AGENT_JOBS = ["implementer", "reviewer", "researcher", "other"] as const;
export type AgentJob = (typeof AGENT_JOBS)[number];

export const AGENT_STATES = ["running", "done", "failed"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** Where a card or agent came from when the asker names none. */
export const DEFAULT_HOST = "external";

export interface CardOption {
  label: string;
  prompt: string;
  consequence: string;
}

export interface CardAnswer {
  /** The option chosen, or null for words alone. */
  label: string | null;
  text: string;
  at: string;
  by: string;
}

export interface TrackerCard {
  id: string;
  host: string;
  question: string;
  why: string;
  options: CardOption[];
  /** The label of the option the asker recommends, or null. */
  recommended: string | null;
  reason: string;
  askedAt: string;
  status: CardStatus;
  answer: CardAnswer | null;
}

export interface TrackerAgent {
  name: string;
  host: string;
  job: AgentJob;
  task: string;
  state: AgentState;
  startedAt: string;
  finishedAt: string | null;
}

export interface LineProblem {
  /** The file's line when read from a whole ticket, else the section's (from 1). */
  line: number;
  message: string;
}

export interface Read<T> {
  items: T[];
  problems: LineProblem[];
}

/** A card's id and an agent's name: one shell word, so a printed command needs no quoting. */
const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Why the value is not a card, or null when it is one. */
export function cardProblem(value: unknown): string | null {
  if (!isRecord(value)) return "a card must be a JSON object";
  if (!isString(value.id) || !CARD_ID.test(value.id)) return 'a card needs an "id" of letters, digits, ".", "_" or "-"';
  for (const key of ["host", "question", "why", "reason", "askedAt"]) {
    if (!isString(value[key])) return `card ${value.id}: "${key}" must be a string`;
  }
  if (value.question === "") return `card ${value.id}: "question" must not be empty`;
  if (!Array.isArray(value.options) || !value.options.every((option) => isRecord(option) && isString(option.label) && option.label !== "" && isString(option.prompt) && isString(option.consequence))) {
    return `card ${value.id}: "options" must be a list of {label, prompt, consequence} strings`;
  }
  if (value.recommended !== null && !isString(value.recommended)) return `card ${value.id}: "recommended" must be an option's label or null`;
  if (!oneOf(CARD_STATUSES, value.status)) return `card ${value.id}: "status" must be one of ${CARD_STATUSES.join(", ")}`;
  const answer = value.answer;
  if (answer !== null && !(isRecord(answer) && (answer.label === null || isString(answer.label)) && isString(answer.text) && isString(answer.at) && isString(answer.by))) {
    return `card ${value.id}: "answer" must be {label, text, at, by} or null`;
  }
  return null;
}

/** Why the value is not an agent, or null when it is one. */
export function agentProblem(value: unknown): string | null {
  if (!isRecord(value)) return "an agent must be a JSON object";
  if (!isString(value.name) || !CARD_ID.test(value.name)) return 'an agent needs a "name" of letters, digits, ".", "_" or "-"';
  for (const key of ["host", "task", "startedAt"]) {
    if (!isString(value[key])) return `agent ${value.name}: "${key}" must be a string`;
  }
  if (!oneOf(AGENT_JOBS, value.job)) return `agent ${value.name}: "job" must be one of ${AGENT_JOBS.join(", ")}`;
  if (!oneOf(AGENT_STATES, value.state)) return `agent ${value.name}: "state" must be one of ${AGENT_STATES.join(", ")}`;
  if (value.finishedAt !== null && !isString(value.finishedAt)) return `agent ${value.name}: "finishedAt" must be a time or null`;
  return null;
}

/** One section's lines: the item each holds, or null for a blank or malformed one (reported, the line counted from `firstLine`). */
function readLines<T>(section: string | undefined, check: (value: unknown) => string | null, firstLine: number): { lines: string[]; parsed: Array<T | null>; problems: LineProblem[] } {
  const lines = section === undefined || section === "" ? [] : section.split("\n");
  const problems: LineProblem[] = [];
  const parsed = lines.map((text, offset): T | null => {
    if (text.trim() === "") return null;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      problems.push({ line: firstLine + offset, message: "not a JSON object on one line" });
      return null;
    }
    const problem = check(value);
    if (problem !== null) {
      problems.push({ line: firstLine + offset, message: problem });
      return null;
    }
    return value as T;
  });
  return { lines, parsed, problems };
}

function present<T>(items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null);
}

/** The cards of a ticket's `cards` field (the section's text); malformed lines are skipped and reported. */
export function cardsOf(section: string | undefined): Read<TrackerCard> {
  const { parsed, problems } = readLines<TrackerCard>(section, cardProblem, 1);
  return { items: present(parsed), problems };
}

/** The agents of a ticket's `agents` field (the section's text); malformed lines are skipped and reported. */
export function agentsOf(section: string | undefined): Read<TrackerAgent> {
  const { parsed, problems } = readLines<TrackerAgent>(section, agentProblem, 1);
  return { items: present(parsed), problems };
}

/** A section's body in a whole ticket file and the file line its first body line is on; null when the file has none. */
function sectionIn(ticketText: string, name: "cards" | "agents"): { body: string; firstLine: number } | null {
  const lines = ticketText.replace(/^﻿/, "").split(/\r?\n/);
  const begin = lines.findIndex((line) => line.trimEnd() === `<!-- taro:${name} -->`);
  if (begin < 0) return null;
  const end = lines.findIndex((line, index) => index > begin && line.trimEnd() === `<!-- /taro:${name} -->`);
  // A leading `\` escapes a marker-like line in a section (shared/ticket-format.ts); never one a JSON line starts with.
  const body = lines.slice(begin + 1, end < 0 ? lines.length : end).map((line) => (/^\\+<!-- /.test(line) ? line.slice(1) : line));
  return { body: body.join("\n"), firstLine: begin + 2 };
}

/** The cards in a whole ticket file's text; malformed lines are skipped and reported by file line. */
export function readCards(ticketText: string): Read<TrackerCard> {
  const section = sectionIn(ticketText, "cards");
  if (section === null) return { items: [], problems: [] };
  const { parsed, problems } = readLines<TrackerCard>(section.body, cardProblem, section.firstLine);
  return { items: present(parsed), problems };
}

/** The agents in a whole ticket file's text; malformed lines are skipped and reported by file line. */
export function readAgents(ticketText: string): Read<TrackerAgent> {
  const section = sectionIn(ticketText, "agents");
  if (section === null) return { items: [], problems: [] };
  const { parsed, problems } = readLines<TrackerAgent>(section.body, agentProblem, section.firstLine);
  return { items: present(parsed), problems };
}

// ---------------------------------------------------------------- changes (pure: section text in, section text out)

export interface AskInput {
  id: string;
  question: string;
  why?: string;
  options?: CardOption[];
  recommended?: string | null;
  reason?: string;
}

/** The asker's JSON as a card to record; throws naming what is wrong. */
export function cardFromInput(input: unknown, host: string, askedAt: string): TrackerCard {
  if (!isRecord(input)) throw new Error("The card must be a JSON object: {id, question, why, options, recommended, reason}.");
  const options = input.options ?? [];
  const card = {
    id: input.id,
    host,
    question: input.question,
    why: input.why ?? "",
    options: Array.isArray(options) ? options.map((option: unknown) => (isRecord(option) ? { label: option.label, prompt: option.prompt ?? option.label, consequence: option.consequence ?? "" } : option)) : options,
    recommended: input.recommended ?? null,
    reason: input.reason ?? "",
    askedAt,
    status: "open",
    answer: null,
  };
  const problem = cardProblem(card);
  if (problem !== null) throw new Error(`The card is not valid: ${problem}.`);
  const valid = card as TrackerCard;
  const labels = valid.options.map((option) => option.label);
  if (new Set(labels).size !== labels.length) throw new Error(`Card ${valid.id} has two options with one label.`);
  if (valid.recommended !== null && !labels.includes(valid.recommended)) throw new Error(`Card ${valid.id} recommends "${valid.recommended}", which is not one of its options.`);
  return valid;
}

/** JSON on one line: `JSON.stringify` escapes every newline, so a card's text can never break the section. */
function line(value: unknown): string {
  return JSON.stringify(value);
}

function withLine(section: string | undefined, text: string): string {
  return section === undefined || section.trim() === "" ? text : `${section.replace(/\n+$/, "")}\n${text}`;
}

/** The section with `card` asked: an open card with its id is replaced in place; an answered or withdrawn one refuses. */
export function askCardIn(section: string | undefined, card: TrackerCard): string {
  const { lines, parsed } = readLines<TrackerCard>(section, cardProblem, 1);
  const index = parsed.findIndex((existing) => existing !== null && existing.id === card.id);
  if (index < 0) return withLine(section, line(card));
  const existing = parsed[index] as TrackerCard;
  if (existing.status !== "open") throw new Error(`Card ${card.id} is already ${existing.status}: ask with another id.`);
  return lines.map((text, at) => (at === index ? line(card) : text)).join("\n");
}

export interface AnswerInput {
  label: string | null;
  text: string;
  by: string;
}

/** The section with the card answered, and the answered card; throws for an unknown card, one no longer open, or a bad answer. */
export function answerCardIn(section: string | undefined, ticketId: string, cardId: string, answer: AnswerInput, at: string): { section: string; card: TrackerCard } {
  const { lines, parsed } = readLines<TrackerCard>(section, cardProblem, 1);
  const index = parsed.findIndex((existing) => existing !== null && existing.id === cardId);
  if (index < 0) throw new Error(`${ticketId} has no card "${cardId}".`);
  const card = parsed[index] as TrackerCard;
  if (card.status !== "open") throw new Error(`Card ${cardId} on ${ticketId} is no longer open: it was ${card.status}.`);
  const text = answer.text.trim();
  if (answer.label === null && text === "") throw new Error("Give an option's label, words, or both.");
  if (answer.label !== null && !card.options.some((option) => option.label === answer.label)) {
    const labels = card.options.map((option) => `"${option.label}"`).join(", ");
    throw new Error(`Card ${cardId} has no option "${answer.label}"${labels === "" ? ": it takes words only" : `; its options are ${labels}`}.`);
  }
  const answered: TrackerCard = { ...card, status: "answered", answer: { label: answer.label, text, at, by: answer.by } };
  return { section: lines.map((existing, position) => (position === index ? line(answered) : existing)).join("\n"), card: answered };
}

/** The section with an open card withdrawn; throws for an unknown card or one no longer open. */
export function withdrawCardIn(section: string | undefined, ticketId: string, cardId: string): { section: string; card: TrackerCard } {
  const { lines, parsed } = readLines<TrackerCard>(section, cardProblem, 1);
  const index = parsed.findIndex((existing) => existing !== null && existing.id === cardId);
  if (index < 0) throw new Error(`${ticketId} has no card "${cardId}".`);
  const card = parsed[index] as TrackerCard;
  if (card.status !== "open") throw new Error(`Card ${cardId} on ${ticketId} is no longer open: it was ${card.status}.`);
  const withdrawn: TrackerCard = { ...card, status: "withdrawn" };
  return { section: lines.map((existing, position) => (position === index ? line(withdrawn) : existing)).join("\n"), card: withdrawn };
}

/**
 * The ANSWER note a tracker card's answer adds, in the words of a Paseo card's (`server/actions.ts`): the option and
 * its prompt, then the words typed with it.
 */
export function answerNote(card: TrackerCard): string {
  const answer = card.answer;
  if (answer === null) throw new Error(`Card ${card.id} has no answer.`);
  const option = answer.label === null ? undefined : card.options.find((candidate) => candidate.label === answer.label);
  const words = [option?.prompt ?? "", answer.text].filter((part) => part.trim() !== "").join(" ");
  const given = answer.label === null ? `"${answer.text}"` : `${answer.label} ("${words === "" ? answer.label : words}")`;
  return `ANSWER ${answer.at} — ${card.id}: "${card.question}" → ${given} (${answer.by})`;
}

export interface RecordAgentInput {
  name: string;
  job: string;
  task?: string | undefined;
  host?: string | undefined;
}

/** The section with a running agent recorded; a name already on the ticket refuses. */
export function recordAgentIn(section: string | undefined, ticketId: string, input: RecordAgentInput, startedAt: string): { section: string; agent: TrackerAgent } {
  const agent = { name: input.name, host: input.host ?? DEFAULT_HOST, job: input.job, task: input.task ?? "", state: "running", startedAt, finishedAt: null };
  const problem = agentProblem(agent);
  if (problem !== null) throw new Error(`The agent is not valid: ${problem}.`);
  const { parsed } = readLines<TrackerAgent>(section, agentProblem, 1);
  if (parsed.some((existing) => existing !== null && existing.name === agent.name)) {
    throw new Error(`${ticketId} already has an agent named "${agent.name}": names are unique within a ticket.`);
  }
  return { section: withLine(section, line(agent)), agent: agent as TrackerAgent };
}

/** The section with a running agent finished as done or failed; throws for an unknown name or one already finished. */
export function finishAgentIn(section: string | undefined, ticketId: string, name: string, state: string, finishedAt: string): { section: string; agent: TrackerAgent } {
  if (state !== "done" && state !== "failed") throw new Error(`"${state}" is not how an agent finishes: done or failed.`);
  const { lines, parsed } = readLines<TrackerAgent>(section, agentProblem, 1);
  const index = parsed.findIndex((existing) => existing !== null && existing.name === name);
  if (index < 0) throw new Error(`${ticketId} has no agent named "${name}".`);
  const agent = parsed[index] as TrackerAgent;
  if (agent.state !== "running") throw new Error(`Agent ${name} on ${ticketId} already finished: ${agent.state}.`);
  const finished: TrackerAgent = { ...agent, state, finishedAt };
  return { section: lines.map((existing, position) => (position === index ? line(finished) : existing)).join("\n"), agent: finished };
}
