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
  project: string;
  ticket: string;
  tracker: string;
  spec: string;
  brief: string;
  playwright: string;
  out: string;
  log: (line: string) => void;
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
}

export interface DeciderReply {
  choice: string;
  text: string;
  preference: string;
  briefAnswered: boolean;
}

export type CardKind = "plan" | "question" | "acceptance";

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
export function deciderPrompt(input: { kind: CardKind; card: string; spec: string; brief: string; history: readonly string[]; nonce: string }): string {
  const format = {
    plan: "choice is Approve or Request changes",
    question: "choice is one option's exact label, or Other",
    acceptance: "choice is Accept or Request changes",
  }[input.kind];
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
    `Begin your final reply with a line that is exactly "REPLY ${input.nonce}", then these four lines and nothing else:`,
    `choice: <${format}>`,
    "text: <the words to type, one line; empty when none>",
    "preference: <P1, P2 ... or none>",
    "brief: <yes or no>",
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

/** Whether a reply's choice picks the named action ("Approve", "Accept"), however it is punctuated. */
export function choosesAction(choice: string, action: string): boolean {
  return choice.trim().replace(/[….]+$/, "").toLowerCase() === action.toLowerCase();
}

function planCard(decision: OpenDecision, plan: string): string {
  return [`Question: ${decision.question}`, decision.why === "" ? "" : `Why: ${decision.why}`, "Plan:", plan, "Buttons: Approve, Request changes…"].filter((line) => line !== "").join("\n");
}

function questionCard(decision: OpenDecision): string {
  const options = decision.options.map((option) => `- ${option.label}${option.label === decision.recommended ? " (recommended)" : ""}${option.consequence === undefined || option.consequence === "" ? "" : ` — ${option.consequence}`}`);
  return [`Question: ${decision.question}`, decision.why === "" ? "" : `Why: ${decision.why}`, "Options:", ...options, decision.reason === "" ? "" : `Why recommended: ${decision.reason}`, "You may also pick Other and type your own words."].filter((line) => line !== "").join("\n");
}

/** Labels the card shows as options: the agent's own "Other" and "Change…" stand for typing and are hidden. */
function visibleOptions(decision: OpenDecision): string[] {
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
      const actions = /\b(Approve|Submit|Accept)\b/;
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
  const changeRequests: Record<string, number> = {};
  let counter = 0;
  const logPath = join(options.out, "decider.log");
  const cardsDirectory = join(options.out, "cards");
  mkdirSync(cardsDirectory, { recursive: true });
  const record = (event: DeciderEvent): void => appendFileSync(logPath, `${JSON.stringify(event)}\n`);
  const now = (): string => new Date().toISOString();
  const url = `http://127.0.0.1:${options.throwaway.port}/`;

  const { chromium } = createRequire(import.meta.url)(options.playwright) as { chromium: { launch(): Promise<Browser> } };
  let browser: Browser | null = null;

  const ticketText = (): string => {
    const path = join(options.tracker, "tickets", `${options.ticket}.md`);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  };

  /** Asks the Sonnet decider; retries once when its reply cannot be read. */
  async function ask(kind: CardKind, card: string, id: string): Promise<DeciderReply> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const nonce = Math.random().toString(36).slice(2, 10);
      const prompt = deciderPrompt({ kind, card, spec: options.spec, brief: options.brief, history, nonce });
      if (attempt === 0) record({ type: "prompt", at: now(), kind, id, text: card });
      const started = await run("paseo", ["run", "--provider", DECIDER_MODEL, "--mode", "bypassPermissions", "--cwd", options.throwaway.deciderDirectory, "--title", `decider ${id}`, "--json", ...paseoArgs(options.throwaway), prompt], { timeoutMs: 300_000 });
      const agentId = /"agentId":\s*"([^"]+)"/.exec(started.stdout)?.[1];
      if (agentId === undefined) continue;
      const logs = await run("paseo", ["logs", agentId, ...paseoArgs(options.throwaway)], { timeoutMs: 60_000 });
      const reply = parseReply(`\n${logs.stdout}`, nonce);
      if (reply !== null) return reply;
    }
    throw new Error(`the decider gave no readable reply for ${id}`);
  }

  async function newPage(phone: boolean): Promise<{ page: Page; close: () => Promise<void> }> {
    if (browser === null) browser = await chromium.launch();
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

  async function pass(): Promise<void> {
    if (await answerPermission()) return;
    const open = ((await rpc(options.throwaway, "taro.decisions.open", { project: options.project })) as { decisions: OpenDecision[] }).decisions
      .filter((decision) => decision.status === "open" && decision.held !== true && !handled.has(`${decision.key}@${decision.askedAt}`))
      .sort((left, right) => left.askedAt.localeCompare(right.askedAt));
    const first = open[0];
    if (first !== undefined) {
      handled.add(`${first.key}@${first.askedAt}`);
      if (first.id === "scope-approval") {
        const plan = ticketSection(ticketText(), "plan");
        await handle("plan", first.id, first.question, planCard(first, plan), visibleOptions(first), first);
      } else {
        await handle("question", first.id, first.question, questionCard(first), visibleOptions(first), first);
      }
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
      await handle("acceptance", "accept", heading, card, ["Accept", "Request changes"], null);
    }
  }

  const loop = (async () => {
    while (!stopped) {
      try {
        await pass();
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        options.log(`decider error: ${failure}`);
        // One bad pass does not end the run; a failure that repeats does.
        await sleep(POLL_MS * 2);
        if (failure !== null && /no readable reply/.test(failure)) return;
        failure = null;
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
