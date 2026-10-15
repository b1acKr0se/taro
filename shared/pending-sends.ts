/**
 * The user's messages from a Taro chat until the agent takes them up (TR-084).
 *
 * Paseo puts a message sent to a running agent in its timeline the moment it accepts it, and never
 * says when the agent reads it: Claude reads a steered message after the step it is on. So a sent
 * message is "waiting" until the agent's first step after it in the timeline (`isAgentStep`), and "unread" when the agent stopped without one. A provider that cannot take a
 * message mid-turn has the running turn replaced by Paseo, so the chat holds the message until the
 * turn ends unless the user sends it anyway. Pure, for vitest.
 */
import { z } from "zod";

import type { DraftAttachment } from "./attachments";

/** The chat's own message ids; the plugin's start with `taro-` (`server/send.ts`). */
export const CHAT_MESSAGE_PREFIX = "chat-";
export const ChatMessageIdSchema = z.string().regex(/^chat-[a-z0-9-]{1,64}$/);

export function newChatMessageId(now: number = Date.now(), random: () => number = Math.random): string {
  return `${CHAT_MESSAGE_PREFIX}${now.toString(36)}-${Math.floor(random() * 36 ** 8).toString(36)}`;
}

/**
 * Providers whose Paseo session cannot take a message mid-turn, so Paseo replaces the running turn
 * (Paseo 0.11.2: the ACP ones, which lack `steerActiveTurn`). Paseo exposes this neither in an
 * agent's capabilities nor in what a send returns, so it is listed here: the built-in `copilot`, and
 * the ids Paseo itself runs as ACP agents. Any other id steers: the built-in claude, codex, opencode,
 * pi and omp, a plugin's provider, and a custom one extending one of those under its own id. A custom
 * provider extending one of these is found in Paseo's config (`replacingProviders`).
 */
export const REPLACING_PROVIDERS: ReadonlySet<string> = new Set(["copilot", "acp", "cursor", "kimi", "kiro", "traecli"]);

/** Whether a message sent now joins the running turn; an unknown provider (none read yet) is taken to. */
export function steersMidTurn(provider: string | null | undefined, replacing: ReadonlySet<string> = REPLACING_PROVIDERS): boolean {
  return provider === null || provider === undefined || !replacing.has(provider);
}

/**
 * The replacing providers given Paseo's config (`agents.providers`): the built-in list, plus each
 * custom provider whose `extends` chain reaches one of them (`"gemini": { "extends": "acp" }`).
 */
export function replacingProviders(config: unknown): ReadonlySet<string> {
  const providers = recordAt(recordAt(config, "agents"), "providers");
  const extendsOf = (id: string): string | null => {
    const base = recordAt(providers, id)?.["extends"];
    return typeof base === "string" ? base : null;
  };
  const replacing = new Set(REPLACING_PROVIDERS);
  Object.keys(providers ?? {}).forEach((id) => {
    // A chain longer than the providers configured has a loop: Paseo refuses it, so nothing replaces.
    let base = extendsOf(id);
    let steps = 0;
    while (base !== null && !REPLACING_PROVIDERS.has(base) && steps < Object.keys(providers ?? {}).length) {
      base = extendsOf(base);
      steps += 1;
    }
    if (base !== null && REPLACING_PROVIDERS.has(base)) replacing.add(id);
  });
  return replacing;
}

function recordAt(value: unknown, key: string): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const inner = (value as Record<string, unknown>)[key];
  return inner !== null && typeof inner === "object" && !Array.isArray(inner) ? (inner as Record<string, unknown>) : null;
}

/** Whether an agent in this Paseo status has a turn under way. */
export function isWorking(status: string | null | undefined): boolean {
  return status === "running" || status === "initializing";
}

/** How long a stopped agent has to start on a message before the chat says it did not read it. */
export const STOPPED_GRACE_MS = 15_000;

export interface PendingSend {
  id: string;
  text: string;
  /** As the composer held them, so a failed send hands them back. */
  attachments: readonly DraftAttachment[];
  /** When it was sent, or held (ms). */
  at: number;
  /**
   * "held": not sent, waiting for the turn to end; "sending": on its way, or waiting for the messages
   * before it to go; "sent": Paseo has it; "failed": Paseo did not take it, and nothing after it goes
   * until it is retried or taken back.
   */
  state: "held" | "sending" | "sent" | "failed";
  /** Why it was not sent, for a failed one. */
  error?: string | undefined;
}

/** "behind": sending, but waiting for a failed message before it. */
export type SendMark = "held" | "sending" | "behind" | "failed" | "waiting" | "unread";

export interface SendView {
  send: PendingSend;
  mark: SendMark;
  /** The timeline row showing it (`String(seqStart)`), or null when the chat draws it itself. */
  rowKey: string | null;
}

/** The parts of a timeline entry this reads. */
export interface SendTimelineEntry {
  seqStart: number;
  timestamp: string;
  item: { type: string; clientMessageId?: string | undefined; status?: string | undefined; detail?: { type: string } | undefined };
}

/**
 * Whether an entry is the agent doing something new: a reply, reasoning, or a tool call. Not the label
 * Paseo adds as a running tool ends (`plain_text`), nor the empty failed call an interrupt leaves: both
 * follow a steered message without the agent having read it.
 */
export function isAgentStep(item: SendTimelineEntry["item"]): boolean {
  if (item.type === "assistant_message" || item.type === "reasoning") return true;
  if (item.type !== "tool_call") return false;
  const kind = item.detail?.type;
  return kind !== "plain_text" && !(kind === "unknown" && item.status !== "completed");
}

/**
 * Each pending message's mark, in the order sent, the ids the agent has taken up (to forget), and the
 * ids found in the timeline while still marked sending or failed (to mark sent).
 * `stoppedAt`: since when the agent has been seen stopped, null while it works.
 */
export function viewSends(
  sends: readonly PendingSend[],
  entries: readonly SendTimelineEntry[],
  agent: { stoppedAt: number | null; hasOlder: boolean },
  now: number,
): { views: SendView[]; read: string[]; landed: string[] } {
  const views: SendView[] = [];
  const read: string[] = [];
  const landed: string[] = [];
  const oldest = entries[0] === undefined ? null : Date.parse(entries[0].timestamp);
  let failedBefore = false;
  sends.forEach((send) => {
    if (send.state === "held") {
      views.push({ send, mark: "held", rowKey: null });
      return;
    }
    const index = entries.findIndex((entry) => entry.item.type === "user_message" && entry.item.clientMessageId === send.id);
    // In the timeline, Paseo has it, whatever the send's own answer said or has yet to say (an answer lost to a dropped connection).
    if (index === -1 && send.state !== "sent") {
      if (send.state === "failed") {
        views.push({ send, mark: "failed", rowKey: null });
        failedBefore = true;
      } else views.push({ send, mark: failedBefore ? "behind" : "sending", rowKey: null });
      return;
    }
    if (index !== -1 && send.state !== "sent") landed.push(send.id);
    if (index === -1) {
      // Older than the timeline's tail: the agent has said a page of things since.
      if (agent.hasOlder && oldest !== null && oldest > send.at) {
        read.push(send.id);
        return;
      }
    } else if (entries.slice(index + 1).some((entry) => isAgentStep(entry.item))) {
      read.push(send.id);
      return;
    }
    const rowKey = index === -1 ? null : String(entries[index]?.seqStart);
    const stoppedFor = agent.stoppedAt === null ? 0 : now - Math.max(agent.stoppedAt, send.at);
    views.push({ send, mark: stoppedFor >= STOPPED_GRACE_MS ? "unread" : "waiting", rowKey });
  });
  return { views, read, landed };
}

/**
 * What goes back into the composer from a message not sent (a failed send, a cancelled hold): the
 * words only into an empty field and the attachments only when none are attached, so nothing written
 * or attached since is lost. Null where nothing goes back.
 */
export function handBack(
  composer: { text: string; attachments: readonly DraftAttachment[] },
  send: PendingSend,
): { text: string | null; attachments: readonly DraftAttachment[] | null } {
  return {
    text: composer.text.trim() === "" && send.text !== "" ? send.text : null,
    attachments: composer.attachments.length === 0 && send.attachments.length > 0 ? send.attachments : null,
  };
}

/**
 * The message to send next: the first one sending, once everything before it has gone. Null while a
 * failed one is before it, so a message never overtakes one sent earlier.
 */
export function nextToSend(sends: readonly PendingSend[]): PendingSend | null {
  for (const send of sends) {
    if (send.state === "failed") return null;
    if (send.state === "sending") return send;
  }
  return null;
}

/** How Paseo's app says the link to the daemon went (0.11.2: "Transport closed (code 1006)", "Not connected", a timeout). */
const CONNECTION_LOST = /transport closed|not connected|disconnected|connection (?:closed|lost|reset)|websocket|timed? ?out/i;
/** How Paseo says the plugin is restarting (a reload: "Plugin is not available: taro … code=handler_error"). */
const PLUGIN_RESTARTING = /plugin is not available/i;

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : typeof error === "string" ? error : "").trim();
}

/** What a failed send's row says after "Not sent: ". */
export function failureReason(error: unknown): string {
  const text = errorMessage(error);
  if (text === "") return "Paseo did not take it.";
  if (CONNECTION_LOST.test(text)) return "the connection to Paseo dropped.";
  return PLUGIN_RESTARTING.test(text) ? "Taro was restarting." : text;
}

/**
 * A failure that passes by itself (the connection dropped, the plugin restarting), so the send is tried
 * again before the row says Not sent. Safe: the plugin skips a message Paseo already holds.
 */
export function isPassingFailure(error: unknown): boolean {
  const text = errorMessage(error);
  return CONNECTION_LOST.test(text) || PLUGIN_RESTARTING.test(text);
}

/** The waits before each new try of a send that failed in passing: about 10 s in all, a plugin reload's length. */
export const SEND_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 6_000];

/** The held messages to send now that the agent stopped, oldest first. */
export function heldToRelease(sends: readonly PendingSend[], working: boolean): PendingSend[] {
  return working ? [] : sends.filter((send) => send.state === "held");
}
