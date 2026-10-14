/**
 * The user's messages from a Taro chat until the agent takes them up (TR-084).
 *
 * Paseo puts a message sent to a running agent in its timeline the moment it accepts it, and never
 * says when the agent reads it: Claude reads a steered message after the step it is on. So a sent
 * message is "waiting" until the agent's first step after it in the timeline (a reply, reasoning or
 * a tool call), and "unread" when the agent stopped without one. A provider that cannot take a
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
 * Providers whose Paseo session takes a message mid-turn (they implement `steerActiveTurn` in Paseo
 * 0.11.2). Paseo exposes this neither in an agent's capabilities nor in what a send returns, so it
 * is listed here; any other provider (the ACP ones: `copilot`, `acp`, …) has its turn replaced.
 */
const STEERING_PROVIDERS: ReadonlySet<string> = new Set(["claude", "codex", "opencode", "pi", "omp"]);

/** Whether a message sent now joins the running turn; an unknown provider (none read yet) is taken to. */
export function steersMidTurn(provider: string | null | undefined): boolean {
  return provider === null || provider === undefined || STEERING_PROVIDERS.has(provider);
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
  /** "held": not sent, waiting for the turn to end; "sent": Paseo has it. */
  state: "held" | "sent";
}

export type SendMark = "held" | "waiting" | "unread";

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
  item: { type: string; clientMessageId?: string | undefined };
}

const STEPS: ReadonlySet<string> = new Set(["assistant_message", "reasoning", "tool_call"]);

/**
 * Each pending message's mark, in the order sent, and the ids the agent has taken up (to forget).
 * `stoppedAt`: since when the agent has been seen stopped, null while it works.
 */
export function viewSends(
  sends: readonly PendingSend[],
  entries: readonly SendTimelineEntry[],
  agent: { stoppedAt: number | null; hasOlder: boolean },
  now: number,
): { views: SendView[]; read: string[] } {
  const views: SendView[] = [];
  const read: string[] = [];
  const oldest = entries[0] === undefined ? null : Date.parse(entries[0].timestamp);
  sends.forEach((send) => {
    if (send.state === "held") {
      views.push({ send, mark: "held", rowKey: null });
      return;
    }
    const index = entries.findIndex((entry) => entry.item.type === "user_message" && entry.item.clientMessageId === send.id);
    if (index === -1) {
      // Older than the timeline's tail: the agent has said a page of things since.
      if (agent.hasOlder && oldest !== null && oldest > send.at) {
        read.push(send.id);
        return;
      }
    } else if (entries.slice(index + 1).some((entry) => STEPS.has(entry.item.type))) {
      read.push(send.id);
      return;
    }
    const rowKey = index === -1 ? null : String(entries[index]?.seqStart);
    const stoppedFor = agent.stoppedAt === null ? 0 : now - Math.max(agent.stoppedAt, send.at);
    views.push({ send, mark: stoppedFor >= STOPPED_GRACE_MS ? "unread" : "waiting", rowKey });
  });
  return { views, read };
}

/** The held messages to send now that the agent stopped, oldest first. */
export function heldToRelease(sends: readonly PendingSend[], working: boolean): PendingSend[] {
  return working ? [] : sends.filter((send) => send.state === "held");
}
