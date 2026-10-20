/**
 * The decider plays the user (TR-207): a Sonnet agent on the throwaway daemon, with no Taro labels and
 * its own working folder, reads the task's spec and each card the owner puts in front of the user, and
 * its answer is given through Paseo's web UI with Playwright (the plan card's Approve or Request
 * changes, a question's option or Other, Accept). A card it cannot find on screen within two minutes is
 * logged as `card-missing` and answered over RPC so the run goes on. Every card is screenshotted
 * (desktop dark, phone light) and its visible text checked. Runs under Node type stripping: erasable
 * syntax, `.ts` import extensions, no packages (Playwright through the PLAYWRIGHT path only).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { cardTextViolations } from "./card-check.ts";
import { paseoArgs, rpc, type Throwaway } from "./daemon.ts";
import { run } from "./process.ts";
import type { DeciderEvent } from "./score.ts";

export const DECIDER_MODEL = "claude/claude-sonnet-5-5";
const CARD_WAIT_MS = 120_000;
const POLL_MS = 5000;
/** The question card's own text field (the chat composer below it has another placeholder). */
const ANSWER_PLACEHOLDER = "Answer in your own words";
/** Request changes at most this many times on one kind of card, so a run always ends. */
const MAX_CHANGE_REQUESTS = 2;

export interface DeciderOptions {
  throwaway: Throwaway;
  /** The owner's agent id, for a chat message when it waits on a card that never came. */
  ownerAgentId?: string;
  project: string;
  ticket: string;
  tracker: string;
  spec: string;
  brief: string;
  playwright: string;
  out: string;
  log: (line: string) => void;
}

/** One question of a card that asks several (`DecisionQuestionSchema` in `shared/reports.ts`). */
export interface OpenQuestion {
  header: string;
  question: string;
  why: string;
  options: { label: string; prompt?: string; consequence?: string }[];
  recommended: string;
  reason: string;
}

export interface OpenDecision {
  key: string;
  id: string;
  question: string;
  why: string;
  blocking: boolean;
  held?: boolean;
  status: string;
  askedAt: string;
  options: { label: string; prompt?: string; consequence?: string }[];
  recommended: string;
  reason: string;
  /** Two to four questions answered together; on such a card `question` is only a summary. */
  questions?: OpenQuestion[];
}

export interface DeciderReply {
  choice: string;
  text: string;
  preference: string;
  briefAnswered: boolean;
}

export type CardKind = "plan" | "question" | "acceptance";

/** How long an owner may sit idle on a `waiting:` status with no card before the user notices and writes to it. */
export const WAITING_NOTICE_MS = 8 * 60_000;

export const WAITING_NOTICE_TEXT = "I don't see a card from you, so there is nothing for me to answer. If you need a decision, ask it with a decision card; otherwise decide it yourself and carry on.";

/** The status time of an owner that has waited too long with nothing on screen for the user to answer; null otherwise. */
export function staleWaiting(detail: { status: string; ownerRunning?: boolean; lastStatus?: { state: string; at: string } | null }, now: number): string | null {
  if (detail.status !== "Planning" && detail.status !== "In Progress") return null;
  if (detail.ownerRunning === true || detail.lastStatus === null || detail.lastStatus === undefined) return null;
  if (detail.lastStatus.state !== "waiting") return null;
  return now - Date.parse(detail.lastStatus.at) >= WAITING_NOTICE_MS ? detail.lastStatus.at : null;
}

/** What the user would refuse: a command that reaches the real daemon or its home. Everything else on the scratch project is allowed. */
export function permissionVerdict(detail: string): "allow" | "deny" {
  return /\/\.paseo\b|~\/\.paseo|:6767\b|\bport 6767\b/.test(detail) ? "deny" : "allow";
}

/** The rules of superlite's decider, adapted to Taro's cards. */
export const DECIDER_RULES = `You are the product owner and tech lead for a small software project. You wrote its SPEC (below). An AI coding agent (the task owner) is building it and has put a card in front of you. Answer as a decisive, busy decision-maker:
- Answer every question on the card briefly (at most 100 words in total). No preamble. Do not use any tools.
- When it offers options, pick one. Pick the recommended option unless that conflicts with the SPEC; then pick the option the SPEC supports and say why in one clause. Use "Other" with your own words only when no option fits.
- When the card asks you to approve a plan, approve it if it covers the SPEC and contradicts none of it. A hidden preference the plan does not mention is not missing: reveal a hidden preference only when the plan contradicts it or a question touches it. If the plan contradicts the SPEC, choose "Request changes" and name exactly that contradiction in the text, nothing else. Never add requirements the SPEC does not contain.
- When the card is the delivered ticket (Accept), accept it unless its summary contradicts the SPEC; then request changes naming exactly what.
- For every question, say which hidden preference it touches (preference: P1, P2 ... or none), and whether the BRIEF the owner was given already answered it (brief: yes or no).
- The SPEC is the authority. Reveal a hidden preference only when a question touches it.
- Never ask questions back. Never write code.`;

function ticketSection(text: string, name: string): string {
  return new RegExp(`<!-- taro:${name} -->\\n([\\s\\S]*?)\\n?<!-- /taro:${name} -->`).exec(text)?.[1]?.trim() ?? "";
}

export function ticketStatus(text: string): string {
  return /^status:\s*"([^"]+)"/m.exec(text)?.[1] ?? "?";
}

/** Whether the ticket is delivered and waiting for the user: Awaiting acceptance, not yet accepted. */
export function awaitsAcceptance(text: string): boolean {
  return ticketStatus(text) === "Awaiting acceptance" && !/^ACCEPTED\b/m.test(ticketSection(text, "notes"));
}

/** The prompt for one card: rules, spec, brief, what was decided so far, the card, and the reply format. */
export function deciderPrompt(input: { kind: CardKind; card: string; spec: string; brief: string; history: readonly string[]; nonce: string; questions?: number }): string {
  const format = {
    plan: "choice is Approve or Request changes",
    question: "choice is one option's exact label, or Other",
    acceptance: "choice is Accept or Request changes",
  }[input.kind];
  const count = input.questions ?? 1;
  const replyFormat =
    count > 1
      ? [
          `Begin your final reply with a line that is exactly "REPLY ${input.nonce}", then these four lines for each of the ${count} questions, in order, and nothing else:`,
          ...Array.from({ length: count }, (_, index) => [
            `answer ${index + 1}: <one option's exact label, or Other>`,
            `text ${index + 1}: <the words to type, one line; empty when none>`,
            `preference ${index + 1}: <P1, P2 ... or none>`,
            `brief ${index + 1}: <yes or no>`,
          ]).flat(),
        ]
      : [
          `Begin your final reply with a line that is exactly "REPLY ${input.nonce}", then these four lines and nothing else:`,
          `choice: <${format}>`,
          "text: <the words to type, one line; empty when none>",
          "preference: <P1, P2 ... or none>",
          "brief: <yes or no>",
        ];
  return [
    DECIDER_RULES,
    "",
    "SPEC:",
    input.spec.trim(),
    "",
    "BRIEF the owner was given:",
    input.brief.trim(),
    "",
    input.history.length === 0 ? "Nothing decided yet." : `Decided so far:\n${input.history.join("\n")}`,
    "",
    `THE CARD (${input.kind}):`,
    input.card.trim(),
    "",
    ...replyFormat,
  ].join("\n");
}

/** The reply after the last `REPLY <nonce>` line of an agent's log; null when it is not there or has no choice. */
export function parseReply(log: string, nonce: string): DeciderReply | null {
  const at = log.lastIndexOf(`\nREPLY ${nonce}`);
  if (at < 0) return null;
  const body = log.slice(at + 1);
  const field = (name: string): string => new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(body)?.[1]?.trim() ?? "";
  const choice = field("choice").replace(/\s*\(recommended\)\s*$/i, "");
  if (choice === "") return null;
  return { choice, text: field("text"), preference: field("preference") || "none", briefAnswered: /^y/i.test(field("brief")) };
}

/** The replies to a card asking `count` questions: the `<k>`-numbered fields after the last `REPLY <nonce>` line; null when any answer is missing or empty. */
export function parseReplies(log: string, nonce: string, count: number): DeciderReply[] | null {
  const at = log.lastIndexOf(`\nREPLY ${nonce}`);
  if (at < 0) return null;
  const body = log.slice(at + 1);
  const replies: DeciderReply[] = [];
  for (let number = 1; number <= count; number += 1) {
    const field = (name: string): string => new RegExp(`^${name} ${number}:[ \\t]*(.*)$`, "im").exec(body)?.[1]?.trim() ?? "";
    const choice = field("answer").replace(/\s*\(recommended\)\s*$/i, "");
    if (choice === "") return null;
    replies.push({ choice, text: field("text"), preference: field("preference") || "none", briefAnswered: /^y/i.test(field("brief")) });
  }
  return replies;
}

/** Whether a reply's choice picks the named action ("Approve", "Accept"), however it is punctuated. */
export function choosesAction(choice: string, action: string): boolean {
  return choice.trim().replace(/[….]+$/, "").toLowerCase() === action.toLowerCase();
}

function planCard(decision: OpenDecision, plan: string): string {
  return [`Question: ${decision.question}`, decision.why === "" ? "" : `Why: ${decision.why}`, "Plan:", plan, "Buttons: Approve, Request changes…"].filter((line) => line !== "").join("\n");
}

function questionCard(decision: Pick<OpenQuestion, "question" | "why" | "options" | "recommended" | "reason">): string {
  const options = decision.options.map((option) => `- ${option.label}${option.label === decision.recommended ? " (recommended)" : ""}${option.consequence === undefined || option.consequence === "" ? "" : ` — ${option.consequence}`}`);
  return [`Question: ${decision.question}`, decision.why === "" ? "" : `Why: ${decision.why}`, "Options:", ...options, decision.reason === "" ? "" : `Why recommended: ${decision.reason}`, "You may also pick Other and type your own words."].filter((line) => line !== "").join("\n");
}

/** A card asking several questions: a block per question, each laid out as one question is. */
export function severalCard(decision: OpenDecision): string {
  const questions = decision.questions ?? [];
  return questions.map((question, index) => `Question ${index + 1} of ${questions.length} — ${question.header}:\n${questionCard(question)}`).join("\n\n");
}

/** The option a reply names, case-insensitively; null for Other. */
function matchingOption(question: Pick<OpenQuestion, "options">, reply: DeciderReply): OpenQuestion["options"][number] | null {
  return question.options.find((option) => option.label.toLowerCase() === reply.choice.toLowerCase()) ?? null;
}

/** The RPC answer to a card asking several: one answer per question in order (the server refuses fewer). */
export function severalAnswerInput(decision: OpenDecision, replies: readonly DeciderReply[]): { key: string; label: null; text: ""; from: "screen"; answers: { header: string; label: string | null; text: string }[] } {
  const answers = (decision.questions ?? []).map((question, index) => {
    const reply = replies[index] ?? { choice: "", text: "", preference: "none", briefAnswered: false };
    const option = matchingOption(question, reply);
    return option === null ? { header: question.header, label: null, text: reply.text === "" ? reply.choice : reply.text } : { header: question.header, label: option.label, text: reply.text || option.prompt || option.label };
  });
  return { key: decision.key, label: null, text: "", from: "screen", answers };
}

/** The log's `answer` events for a card asking several: one per question, so the score counts each. */
export function answerEvents(decision: OpenDecision, replies: readonly DeciderReply[], via: "ui" | "rpc", at: string): Extract<DeciderEvent, { type: "answer" }>[] {
  return (decision.questions ?? []).flatMap((question, index) => {
    const reply = replies[index];
    return reply === undefined ? [] : [{ type: "answer" as const, at, kind: "question", id: `${decision.id}#${question.header}`, via, choice: reply.choice, text: reply.text, preference: reply.preference, briefAnswered: reply.briefAnswered }];
  });
}

/** How many times one card is tried before the decider gives up on it. */
export const MAX_CARD_ATTEMPTS = 3;

/**
 * A card whose answer failed on screen and over RPC: its key leaves `handled` so the next pass asks again, up to
 * `MAX_CARD_ATTEMPTS` per key. The last failure keeps the key handled and returns the one violation for the card
 * (so `cardFailures` counts a card once); earlier failures return null, for a plain log line.
 */
export function releaseFailedKey(handled: Set<string>, attempts: Map<string, number>, key: string, error: unknown, at: string): Extract<DeciderEvent, { type: "violation" }> | null {
  const attempt = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, attempt);
  const givingUp = attempt >= MAX_CARD_ATTEMPTS;
  if (!givingUp) {
    handled.delete(key);
    return null;
  }
  const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0];
  return { type: "violation", at, kind: "card-unanswered", detail: `${key} could not be answered on screen or over RPC after ${MAX_CARD_ATTEMPTS} attempts: ${reason}` };
}

/** Only an unreadable reply from the decider's model ends the decider (and the run); any other failed pass is logged and tried again. */
export function isFatalDeciderError(error: unknown): boolean {
  return /no readable reply/.test(error instanceof Error ? error.message : String(error));
}

/** Deletes a decider agent (it holds the spec in its prompt) and logs a non-zero exit: `run` never rejects, so a failure shows only in its code. */
export async function deleteDeciderAgent(runner: (command: string, args: readonly string[], options: { timeoutMs: number }) => Promise<{ code: number | null; stderr: string }>, daemonArgs: readonly string[], agentId: string, log: (line: string) => void): Promise<void> {
  const deleted = await runner("paseo", ["delete", agentId, ...daemonArgs], { timeoutMs: 60_000 });
  if (deleted.code !== 0) log(`decider: paseo delete ${agentId} exited ${deleted.code}: ${deleted.stderr.trim()}`);
}

/** Labels the card shows as options: the agent's own "Other" and "Change…" stand for typing and are hidden. */
function visibleOptions(decision: Pick<OpenQuestion, "options">): string[] {
  return decision.options.map((option) => option.label).filter((label) => !/^(other|change)\b/i.test(label.trim()));
}

interface Page {
  goto(url: string, options?: object): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { path: string }): Promise<unknown>;
  evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T>;
  getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByRole(role: string, options?: { name?: string | RegExp }): Locator;
  locator(selector: string): Locator;
  mouse: { click(x: number, y: number): Promise<void> };
  keyboard: { type(text: string): Promise<void> };
  close(): Promise<void>;
}
interface Locator {
  filter(options: { visible?: boolean }): Locator;
  first(): Locator;
  click(options?: { timeout?: number; force?: boolean }): Promise<void>;
  focus(): Promise<void>;
  waitFor(options?: { timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
  count(): Promise<number>;
}
interface Browser {
  newContext(options: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>;
  close(): Promise<void>;
}

// The page function below runs in the browser; the benchmark's own types have no DOM.
declare const document: any;

const sleep = (ms: number): Promise<void> => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The visible text of the card that shows `question`: the smallest ancestor of the question's text that
 * also holds an action button and every option label. Null when the question is not on the page.
 */
async function visibleCardText(page: Page, question: string, labels: readonly string[]): Promise<string | null> {
  return page.evaluate(
    ({ needle, wanted }: { needle: string; wanted: string[] }) => {
      const squeeze = (value: string): string => value.replace(/\s+/g, " ").trim();
      const leaves = (Array.from(document.querySelectorAll("*")) as any[]).filter((element: any) => element.children.length === 0 && squeeze(element.textContent ?? "").includes(squeeze(needle)));
      const actions = /\b(Approve|Submit|Accept|Next|Answer)\b/;
      // For each place the question appears, the smallest ancestor that holds an action and every option; the smallest of those is the card.
      const cards = leaves.flatMap((leaf: any) => {
        let node: any = leaf;
        while (node.parentElement !== null) {
          const text = squeeze(node.innerText ?? "");
          if (actions.test(text) && wanted.every((label) => text.includes(squeeze(label)))) return [node.innerText as string];
          node = node.parentElement;
        }
        return [];
      });
      if (cards.length === 0) return leaves.length === 0 ? null : (leaves[0].innerText as string);
      return cards.reduce((best: string, text: string) => (text.length < best.length ? text : best));
    },
    { needle: question, wanted: [...labels] },
  );
}

export function startDecider(options: DeciderOptions): { stop: () => Promise<void>; failed: () => string | null } {
  let stopped = false;
  let failure: string | null = null;
  const history: string[] = [];
  const handled = new Set<string>();
  const attempts = new Map<string, number>();
  const changeRequests: Record<string, number> = {};
  let counter = 0;
  const logPath = join(options.out, "decider.log");
  const cardsDirectory = join(options.out, "cards");
  mkdirSync(cardsDirectory, { recursive: true });
  const record = (event: DeciderEvent): void => appendFileSync(logPath, `${JSON.stringify(event)}\n`);
  const now = (): string => new Date().toISOString();
  const url = `http://127.0.0.1:${options.throwaway.port}/`;

  const { chromium } = createRequire(import.meta.url)(options.playwright) as { chromium: { launch(options?: object): Promise<Browser> } };
  let browser: Browser | null = null;

  const ticketText = (): string => {
    const path = join(options.tracker, "tickets", `${options.ticket}.md`);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  };

  /** Asks the Sonnet decider; retries once when its reply cannot be read. */
  const ask = (kind: CardKind, card: string, id: string): Promise<DeciderReply> => askAgent(kind, card, id, undefined, (log, nonce) => parseReply(log, nonce));

  async function askAgent<Reply>(kind: CardKind, card: string, id: string, questions: number | undefined, read: (log: string, nonce: string) => Reply | null): Promise<Reply> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const nonce = Math.random().toString(36).slice(2, 10);
      const prompt = deciderPrompt({ kind, card, spec: options.spec, brief: options.brief, history, nonce, ...(questions === undefined ? {} : { questions }) });
      if (attempt === 0) record({ type: "prompt", at: now(), kind, id, text: card });
      const started = await run("paseo", ["run", "--provider", DECIDER_MODEL, "--mode", "bypassPermissions", "--cwd", options.throwaway.deciderDirectory, "--title", `decider ${id}`, "--json", ...paseoArgs(options.throwaway), prompt], { timeoutMs: 300_000 });
      const agentId = /"agentId":\s*"([^"]+)"/.exec(started.stdout)?.[1];
      if (agentId === undefined) continue;
      const logs = await run("paseo", ["logs", agentId, ...paseoArgs(options.throwaway)], { timeoutMs: 60_000 });
      const reply = read(`\n${logs.stdout}`, nonce);
      // The agent holds the spec in its prompt: it must not outlive its answer on the daemon the owner shares.
      await deleteDeciderAgent(run, paseoArgs(options.throwaway), agentId, options.log);
      if (reply !== null) return reply;
    }
    throw new Error(`the decider gave no readable reply for ${id}`);
  }

  async function newPage(phone: boolean): Promise<{ page: Page; close: () => Promise<void> }> {
    // Playwright would exit the process on SIGINT before the run's own cleanup could finish.
    if (browser === null) browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
    const context = await browser.newContext(
      phone
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: "light" }
        : { viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
    );
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" }).catch(() => undefined);
    await page.waitForTimeout(3000);
    if (phone) {
      await page.mouse.click(24, 36);
      await page.waitForTimeout(1500);
    }
    await page.getByText("Taro", { exact: true }).filter({ visible: true }).first().click({ timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(3000);
    // The phone's Taro screen opens on the manager's chat: the cards are on its Board.
    if (phone) {
      await page.getByText("Board", { exact: true }).filter({ visible: true }).first().click({ timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
    }
    return { page, close: () => context.close() };
  }

  /** Opens the Taro screen until `question` is visible; false after two minutes. */
  async function findCard(question: string): Promise<{ page: Page; close: () => Promise<void> } | null> {
    const deadline = Date.now() + CARD_WAIT_MS;
    while (Date.now() < deadline && !stopped) {
      const opened = await newPage(false);
      const found = await opened.page.getByText(question.slice(0, 60), { exact: false }).filter({ visible: true }).count().catch(() => 0);
      if (found > 0) return opened;
      await opened.close();
      await sleep(10_000);
    }
    return null;
  }

  /**
   * A question on the board shows its options as chips and an Answer button; Answer opens the owner's chat
   * with the full card (options, Other, Submit). The plan and Accept cards are complete on the board.
   */
  async function openFullCard(page: Page, kind: CardKind): Promise<void> {
    if (kind !== "question") return;
    await page.getByText("Answer", { exact: true }).filter({ visible: true }).first().click({ timeout: 10_000 });
    await page.waitForTimeout(2500);
  }

  /** The screenshots and the text check of a card on screen: desktop dark on the answering page, phone light on a page of its own. */
  async function checkCard(desktop: Page, kind: CardKind, number: number, id: string, question: string, labels: string[]): Promise<void> {
    await openFullCard(desktop, kind);
    await desktop.screenshot({ path: join(cardsDirectory, `${number}-${id}-desktop-dark.png`) });
    const desktopText = await visibleCardText(desktop, question, labels);
    const phone = await newPage(true);
    try {
      // The phone's board may be on another page of the screen; the card's text is checked only where it shows.
      const onBoard = await phone.page.getByText(question.slice(0, 60), { exact: false }).filter({ visible: true }).count().catch(() => 0);
      if (onBoard > 0) await openFullCard(phone.page, kind).catch((error) => record({ type: "violation", at: now(), kind: "card-missing", detail: `${id} (phone): could not open the full card: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` }));
      const shown = await phone.page.getByText(question.slice(0, 60), { exact: false }).filter({ visible: true }).count().catch(() => 0);
      await phone.page.screenshot({ path: join(cardsDirectory, `${number}-${id}-phone-light.png`) });
      const checked: [string, string | null][] = [["desktop", desktopText], ["phone", shown > 0 ? await visibleCardText(phone.page, question, labels) : null]];
      checked.forEach(([device, text]) => {
        if (text === null) return;
        cardTextViolations(text, { question, options: labels }).forEach((violation) => record({ type: "violation", at: now(), kind: violation.kind, detail: `${id} (${device}): ${violation.detail}` }));
      });
    } finally {
      await phone.close();
    }
  }

  /** The phone's board card for a several-questions card, once: screenshotted and its first question's text checked. */
  async function checkBoardCard(number: number, decision: OpenDecision, first: OpenQuestion): Promise<void> {
    const phone = await newPage(true);
    try {
      await phone.page.screenshot({ path: join(cardsDirectory, `${number}-${decision.id}-phone-light.png`) });
      const shown = await phone.page.getByText(first.question.slice(0, 60), { exact: false }).filter({ visible: true }).count().catch(() => 0);
      if (shown === 0) return;
      const text = await visibleCardText(phone.page, first.question, visibleOptions(first));
      if (text !== null) cardTextViolations(text, { question: first.question, options: visibleOptions(first) }).forEach((violation) => record({ type: "violation", at: now(), kind: violation.kind, detail: `${decision.id} (phone): ${violation.detail}` }));
    } finally {
      await phone.close();
    }
  }

  const clickText = async (page: Page, text: string): Promise<void> => page.getByText(text, { exact: true }).filter({ visible: true }).first().click({ timeout: 10_000 });

  async function typeInto(page: Page, placeholderStart: string, words: string): Promise<void> {
    const field = page.locator(`textarea[placeholder^="${placeholderStart}"]`).filter({ visible: true }).first();
    await field.waitFor({ timeout: 10_000 });
    await field.focus();
    await page.keyboard.type(words);
  }

  /** Answers a decision card through the UI; throws when a control is missing. */
  async function answerInUi(page: Page, kind: CardKind, reply: DeciderReply, decision: OpenDecision | null): Promise<void> {
    if (kind === "question" && decision !== null) {
      const labels = visibleOptions(decision);
      const label = labels.find((candidate) => candidate.toLowerCase() === reply.choice.toLowerCase());
      if (label !== undefined) {
        await page.getByRole("radio", { name: new RegExp(`^${escapeRegExp(label)}`) }).filter({ visible: true }).first().click({ timeout: 10_000 });
        if (reply.text !== "") await typeInto(page, ANSWER_PLACEHOLDER, reply.text).catch(() => undefined);
      } else {
        await clickText(page, "Other");
        await typeInto(page, ANSWER_PLACEHOLDER, reply.text === "" ? reply.choice : reply.text);
      }
      await clickText(page, "Submit");
      return;
    }
    const approving = choosesAction(reply.choice, kind === "plan" ? "Approve" : "Accept");
    if (approving) {
      await clickText(page, kind === "plan" ? "Approve" : "Accept");
      return;
    }
    // The board's acceptance card says "Request changes" and opens the ticket, whose card says "Request changes…".
    await page.getByText(/^Request changes…?$/).filter({ visible: true }).first().click({ timeout: 10_000 });
    const words = reply.text === "" ? reply.choice : reply.text;
    const placeholder = kind === "plan" ? "Describe a change" : "What should change";
    const field = page.locator(`textarea[placeholder^="${placeholder}"]`).filter({ visible: true });
    if ((await field.count()) === 0) {
      await page.waitForTimeout(2500);
      if ((await field.count()) === 0) await clickText(page, "Request changes…");
    }
    await typeInto(page, placeholder, words);
    await clickText(page, "Send changes");
  }

  /** Answers a card asking several questions through the UI, question by question; throws when a control is missing. */
  async function answerSeveralInUi(page: Page, number: number, decision: OpenDecision, replies: readonly DeciderReply[]): Promise<void> {
    const questions = decision.questions ?? [];
    await openFullCard(page, "question");
    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index] as OpenQuestion;
      const reply = replies[index] as DeciderReply;
      const labels = visibleOptions(question);
      await page.screenshot({ path: join(cardsDirectory, `${number}-${decision.id}-q${index + 1}-desktop-dark.png`) });
      const text = await visibleCardText(page, question.question, labels);
      if (text === null) throw new Error(`question ${index + 1} (${question.header}) is not on the card`);
      cardTextViolations(text, { question: question.question, options: labels }).forEach((violation) => record({ type: "violation", at: now(), kind: violation.kind, detail: `${decision.id}#${question.header} (desktop): ${violation.detail}` }));
      const label = labels.find((candidate) => candidate.toLowerCase() === reply.choice.toLowerCase());
      if (label !== undefined) {
        await page.getByRole("radio", { name: new RegExp(`^${escapeRegExp(label)}`) }).filter({ visible: true }).first().click({ timeout: 10_000 });
        if (reply.text !== "") await typeInto(page, ANSWER_PLACEHOLDER, reply.text).catch(() => undefined);
      } else {
        await clickText(page, "Other");
        await typeInto(page, ANSWER_PLACEHOLDER, reply.text === "" ? reply.choice : reply.text);
      }
      if (index < questions.length - 1) await clickText(page, "Next");
      else await page.getByText(/^Submit \d+ answers$/).filter({ visible: true }).first().click({ timeout: 10_000 });
      await page.waitForTimeout(1000);
    }
  }

  /** A card asking several questions: one prompt for all, answered on screen question by question, one `answer` event each. */
  async function handleSeveral(decision: OpenDecision): Promise<void> {
    const questions = decision.questions ?? [];
    const first = questions[0] as OpenQuestion;
    counter += 1;
    const number = counter;
    const replies = await askAgent("question", severalCard(decision), decision.id, questions.length, (log, nonce) => parseReplies(log, nonce, questions.length));
    options.log(`decider: question ${decision.id} → ${replies.map((reply, index) => `${(questions[index] as OpenQuestion).header}: ${reply.choice}`).join("; ")}`);
    const opened = await findCard(first.question);
    let via: "ui" | "rpc" = "ui";
    if (opened === null) {
      record({ type: "violation", at: now(), kind: "card-missing", detail: `question card "${first.question}" not on screen within 2 minutes` });
      via = "rpc";
      await rpc(options.throwaway, "taro.decision.answer", severalAnswerInput(decision, replies));
    } else {
      try {
        await checkBoardCard(number, decision, first);
        await answerSeveralInUi(opened.page, number, decision, replies);
        await opened.page.waitForTimeout(2500);
      } catch (error) {
        record({ type: "violation", at: now(), kind: "card-missing", detail: `question card "${first.question}" could not be answered on screen: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` });
        via = "rpc";
        await rpc(options.throwaway, "taro.decision.answer", severalAnswerInput(decision, replies));
      } finally {
        await opened.close();
      }
    }
    answerEvents(decision, replies, via, now()).forEach(record);
    questions.forEach((question, index) => {
      const reply = replies[index] as DeciderReply;
      history.push(`- question "${question.question}" → ${reply.choice}${reply.text === "" ? "" : `: ${reply.text}`}`);
    });
  }

  /** The RPC fallback for a card that never showed. */
  async function answerOverRpc(kind: CardKind, reply: DeciderReply, decision: OpenDecision | null): Promise<void> {
    if (kind === "acceptance") {
      if (choosesAction(reply.choice, "Accept")) await rpc(options.throwaway, "taro.ticket.accept", { project: options.project, ticket: options.ticket });
      else await rpc(options.throwaway, "taro.ticket.request-changes", { project: options.project, ticket: options.ticket, text: reply.text === "" ? reply.choice : reply.text });
      return;
    }
    if (decision === null) return;
    const label = kind === "plan" && choosesAction(reply.choice, "Approve") ? (decision.options.find((option) => /^approve/i.test(option.label))?.label ?? "Approve") : (decision.options.find((option) => option.label.toLowerCase() === reply.choice.toLowerCase())?.label ?? null);
    await rpc(options.throwaway, "taro.decision.answer", { key: decision.key, label, text: label === null || reply.text !== "" ? reply.text || reply.choice : (decision.options.find((option) => option.label === label)?.prompt ?? label), from: "screen" });
  }

  async function handle(kind: CardKind, id: string, question: string, card: string, labels: string[], decision: OpenDecision | null): Promise<void> {
    counter += 1;
    const number = counter;
    let reply = await ask(kind, card, id);
    // A run must end: past the limit the decider's request for changes becomes an approval.
    const approveAction = kind === "plan" ? "Approve" : "Accept";
    if (kind !== "question" && !choosesAction(reply.choice, approveAction)) {
      changeRequests[kind] = (changeRequests[kind] ?? 0) + 1;
      if ((changeRequests[kind] ?? 0) > MAX_CHANGE_REQUESTS) reply = { ...reply, choice: approveAction, text: "" };
    }
    options.log(`decider: ${kind} ${id} → ${reply.choice}${reply.text === "" ? "" : ` (${reply.text.slice(0, 80)})`}`);
    const opened = await findCard(question);
    let via: "ui" | "rpc" = "ui";
    if (opened === null) {
      record({ type: "violation", at: now(), kind: "card-missing", detail: `${kind} card "${question}" not on screen within 2 minutes` });
      via = "rpc";
      await answerOverRpc(kind, reply, decision);
    } else {
      try {
        await checkCard(opened.page, kind, number, id, question, labels);
        await answerInUi(opened.page, kind, reply, decision);
        await opened.page.waitForTimeout(2500);
      } catch (error) {
        record({ type: "violation", at: now(), kind: "card-missing", detail: `${kind} card "${question}" could not be answered on screen: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` });
        via = "rpc";
        await answerOverRpc(kind, reply, decision);
      } finally {
        await opened.close();
      }
    }
    record({ type: "answer", at: now(), kind, id, via, choice: reply.choice, text: reply.text, preference: reply.preference, briefAnswered: reply.briefAnswered });
    history.push(`- ${kind} "${question}" → ${reply.choice}${reply.text === "" ? "" : `: ${reply.text}`}`);
  }

  /** A permission ask from the owner or a subagent (a shell command Claude Code itself holds back): answered as the user would, Allow unless it reaches the real daemon. */
  async function answerPermission(): Promise<boolean> {
    const board = (await rpc(options.throwaway, "taro.board.load", { project: options.project })) as { cards: { id: string; permission?: { id: string | null; title: string; detail: string | null } | null }[] };
    const ask = board.cards.find((card) => card.id === options.ticket)?.permission;
    if (ask === undefined || ask === null) return false;
    const key = `permission:${ask.id ?? ""}:${ask.detail ?? ask.title}`;
    if (handled.has(key)) return false;
    handled.add(key);
    const verdict = permissionVerdict(`${ask.title}\n${ask.detail ?? ""}`);
    counter += 1;
    const opened = await findCard(ask.title);
    if (opened === null) {
      record({ type: "violation", at: now(), kind: "card-missing", detail: `permission card "${ask.title}" not on screen within 2 minutes` });
      handled.delete(key);
      return false;
    }
    try {
      await opened.page.getByText("Review", { exact: true }).filter({ visible: true }).first().click({ timeout: 10_000 });
      await opened.page.waitForTimeout(2500);
      await opened.page.screenshot({ path: join(cardsDirectory, `${counter}-permission-desktop-dark.png`) });
      await clickText(opened.page, verdict === "allow" ? "Allow" : "Deny");
      await opened.page.waitForTimeout(2500);
      record({ type: "permission", at: now(), tool: ask.title, detail: (ask.detail ?? "").slice(0, 300), decision: verdict, via: "ui" });
      options.log(`decider: permission ${ask.title} → ${verdict}`);
    } catch (error) {
      record({ type: "violation", at: now(), kind: "card-missing", detail: `permission card "${ask.title}" could not be answered on screen: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` });
      handled.delete(key);
    } finally {
      await opened.close();
    }
    return true;
  }

  /** Runs a card's answer; when it throws (the screen and the RPC both failed) the key is released so the card is tried again. */
  async function guarded(key: string, answer: () => Promise<void>): Promise<void> {
    try {
      await answer();
    } catch (error) {
      const violation = releaseFailedKey(handled, attempts, key, error, now());
      if (violation !== null) record(violation);
      else options.log(`decider: card ${key} not answered (attempt ${attempts.get(key)} of ${MAX_CARD_ATTEMPTS}), will try again`);
      throw error;
    }
  }

  async function pass(): Promise<void> {
    if (await answerPermission()) return;
    const open = ((await rpc(options.throwaway, "taro.decisions.open", { project: options.project })) as { decisions: OpenDecision[] }).decisions
      .filter((decision) => decision.status === "open" && decision.held !== true && !handled.has(`${decision.key}@${decision.askedAt}`))
      .sort((left, right) => left.askedAt.localeCompare(right.askedAt));
    const first = open[0];
    if (first !== undefined) {
      const key = `${first.key}@${first.askedAt}`;
      handled.add(key);
      await guarded(key, async () => {
        if (first.id === "scope-approval") {
          const plan = ticketSection(ticketText(), "plan");
          await handle("plan", first.id, first.question, planCard(first, plan), visibleOptions(first), first);
        } else if ((first.questions ?? []).length > 1) {
          await handleSeveral(first);
        } else {
          await handle("question", first.id, first.question, questionCard(first), visibleOptions(first), first);
        }
      });
      return;
    }
    const text = ticketText();
    if (awaitsAcceptance(text)) {
      // Accept is offered once the owner's delivery turn has ended; before that the card sits in Working.
      const detail = (await rpc(options.throwaway, "taro.ticket.load", { project: options.project, ticket: options.ticket })) as { ownerRunning?: boolean };
      if (detail.ownerRunning === true) return;
      const stamp = `acceptance@${/^updated:\s*"([^"]+)"/m.exec(text)?.[1] ?? ""}`;
      if (handled.has(stamp)) return;
      handled.add(stamp);
      const title = /^title:\s*(".*")$/m.exec(text)?.[1];
      const heading = title === undefined ? options.ticket : (JSON.parse(title) as string);
      const card = [`Ticket: ${heading}`, "Delivery summary:", ticketSection(text, "final-summary"), "Buttons: Accept, Request changes"].join("\n");
      await guarded(stamp, () => handle("acceptance", "accept", heading, card, ["Accept", "Request changes"], null));
      return;
    }
    // Nothing on screen for the user: an owner idle on "waiting:" for a long time asked for something that never became a card.
    if (options.ownerAgentId === undefined) return;
    const detail = (await rpc(options.throwaway, "taro.ticket.load", { project: options.project, ticket: options.ticket })) as Parameters<typeof staleWaiting>[0];
    const since = staleWaiting(detail, Date.now());
    if (since === null || handled.has(`waiting:${since}`)) return;
    handled.add(`waiting:${since}`);
    record({ type: "violation", at: now(), kind: "owner-waiting-no-card", detail: `the owner waited from ${since} on "${detail.lastStatus?.state}" with no card, permission or delivery for the user; the user wrote to it` });
    await rpc(options.throwaway, "taro.agent.tell", { agentId: options.ownerAgentId, text: WAITING_NOTICE_TEXT });
    options.log("decider: wrote to a waiting owner (no card on screen)");
  }

  const loop = (async () => {
    while (!stopped) {
      try {
        await pass();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.log(`decider error: ${message}`);
        // Only a fatal error is exposed to the run's poll; any other bad pass is retried (a card at most MAX_CARD_ATTEMPTS times).
        if (isFatalDeciderError(error)) {
          failure = message;
          return;
        }
        await sleep(POLL_MS * 2);
      }
      await sleep(POLL_MS);
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      await loop;
      if (browser !== null) await browser.close().catch(() => undefined);
      browser = null;
    },
    failed: () => failure,
  };
}
