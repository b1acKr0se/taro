/**
 * The user's messages from a Taro chat until the agent takes them up (TR-084).
 *
 * Paseo puts a message sent to a running agent in its timeline the moment it accepts it, and never
 * says when the agent reads it. So a sent message is "waiting" until the agent's first step after it
 * in the timeline (`isAgentStep`), and "unread" when the agent stopped without one. One sent while the
 * agent works waits in the daemon's queue instead (TR-171, `shared/chat-queue.ts`): the chat keeps it,
 * marked "queued", until the timeline shows it or it is known gone from both (`settleQueued`), so its
 * row never leaves and comes back. Pure, for vitest.
 */
import { z } from "zod";

import type { DraftAttachment } from "./attachments";

/** The chat's own message ids; the plugin's start with `taro-` (`server/send.ts`). */
export const CHAT_MESSAGE_PREFIX = "chat-";
export const ChatMessageIdSchema = z.string().regex(/^chat-[a-z0-9-]{1,64}$/);

export function newChatMessageId(now: number = Date.now(), random: () => number = Math.random): string {
  return `${CHAT_MESSAGE_PREFIX}${now.toString(36)}-${Math.floor(random() * 36 ** 8).toString(36)}`;
}

/** Whether an agent in this Paseo status has a turn under way. */
export function isWorking(status: string | null | undefined): boolean {
  return status === "running" || status === "initializing";
}

/** A turn's start or end as the stream told it, ahead of the next read of the agent (TR-201). */
export type TurnBoundary = "started" | "ended";

/**
 * The agent's status with the stream's latest turn boundary over the last read's: the chat follows
 * a turn starting or ending as the daemon says so, as Paseo does, not after its next read (TR-201).
 */
export function statusWithTurn(status: string, turn: TurnBoundary | null): string {
  if (turn === "started") return "running";
  if (turn === "ended" && isWorking(status)) return "idle";
  return status;
}

/**
 * Whether the chat shows the loader: while the agent works, and from the moment a message leaves for
 * an idle agent until the daemon has it, as Paseo shows a message being submitted (TR-201). A message
 * held behind a failed one, or failed, is not on its way.
 */
export function showsLoader(status: string, marks: readonly SendMark[]): boolean {
  return isWorking(status) || marks.includes("sending");
}

/** How long a stopped agent has to start on a message before the chat says it did not read it. */
export const STOPPED_GRACE_MS = 15_000;

export interface PendingSend {
  id: string;
  text: string;
  /** As the composer held them, so a failed send hands them back. */
  attachments: readonly DraftAttachment[];
  /** When it was sent (ms). */
  at: number;
  /**
   * "sending": on its way, or waiting for the messages before it to go; "queued": the daemon holds it
   * for the agent's turn end; "sent": Paseo has it; "failed": the plugin did not take it, and nothing
   * after it goes until it is retried or taken back.
   */
  state: "sending" | "queued" | "sent" | "failed";
  /** When the daemon's queued answer came (client ms): a queue read begun before it may not list it yet. */
  queuedAt?: number | undefined;
  /** When a queue read that no longer listed it answered (client ms): a timeline read begun later shows it, or it was removed elsewhere. */
  leftQueueAt?: number | undefined;
  /**
   * Edit or Send now pressed while this app holds it. "edit": drawn nowhere, never tried again, and taken
   * out once its send answers; "send-now": drawn as the transcript's echo, still sent in order.
   */
  handedOver?: "edit" | "send-now" | undefined;
  /** Why it was not sent, for a failed one. */
  error?: string | undefined;
  /** Sent while the chat showed a permission or question: it goes at once, even mid-turn, and turns that down (TR-171). */
  answersRequest?: boolean | undefined;
  /**
   * The agent was idle when it left. The turn it starts then shows as working before the message lands in
   * the timeline, and the message stays in the transcript rather than hop to the queue track and back.
   */
  sentWhileIdle?: boolean | undefined;
}

/** "behind": sending, but waiting for a failed message before it; "queued": the daemon holds it, silent. */
export type SendMark = "sending" | "behind" | "queued" | "failed" | "waiting" | "unread";

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
 * ids found in the timeline while still marked sending, queued or failed (to mark sent). One marked for
 * Edit has no view: it is in the box, though its landing still counts.
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
    const index = entries.findIndex((entry) => entry.item.type === "user_message" && entry.item.clientMessageId === send.id);
    // In the timeline, Paseo has it, whatever the send's own answer said or has yet to say (an answer lost to a dropped connection).
    if (send.handedOver === "edit") {
      if (index !== -1 && send.state !== "sent") landed.push(send.id);
      return;
    }
    if (index === -1 && send.state !== "sent") {
      if (send.state === "queued") views.push({ send, mark: "queued", rowKey: null });
      else if (send.state === "failed") {
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
 * Whether the newest turn still counts as open (TR-202's footer waits for it to end). The agent
 * starts working when a message reaches it, before the timeline holds that message: the turn that
 * ended before it was sent is not open, so its footer stays rather than leaving and coming back
 * once the message lands. A message sent to a working agent (not `sentWhileIdle`) is a turn that
 * really is open, and so is one the daemon queued: it waits for the running turn to end.
 */
export function turnIsOpen(working: boolean, views: readonly { mark: SendMark; rowKey: string | null; send: Pick<PendingSend, "sentWhileIdle"> }[]): boolean {
  if (!working) return false;
  return !views.some((view) => view.rowKey === null && view.mark !== "failed" && view.mark !== "queued" && view.send.sentWhileIdle === true);
}

/**
 * Whether the newest reply is still being written (TR-144 holds back its unfinished status line).
 * Not while the agent works on a message the timeline has not shown yet: the last reply is then the
 * one before it, finished, and its status line stays (TR-210).
 */
export function replyIsBeingWritten(status: string, turnOpen: boolean): boolean {
  return status === "running" && turnOpen;
}

/**
 * The message to send next: the first one sending, once everything before it has gone. Null while a
 * failed one is before it, so a message never overtakes one sent earlier. One marked for Edit is in the
 * box: never sent again.
 */
export function nextToSend(sends: readonly PendingSend[]): PendingSend | null {
  for (const send of sends) {
    if (send.state === "failed") return null;
    if (send.state === "sending" && send.handedOver !== "edit") return send;
  }
  return null;
}

/** A read of the daemon's queue or of the timeline: the message ids it held, and when (client ms) it began. */
export interface ReadOfIds {
  ids: readonly string[];
  startedAt: number;
}

/** A read of the daemon's queue, with when (client ms) it answered: every daemon step before that answer is in it. */
export interface QueueReadOfIds extends ReadOfIds {
  answeredAt: number;
}

/**
 * What the latest reads say of the messages the daemon queued. `left`: a queue read that began once the
 * daemon had it no longer lists it; a read begun earlier proves nothing. The chat notes `leftQueueAt` as
 * that read's answer (`leftQueueAt`, null with no queue read): a timeline read begun before then may reach
 * the daemon ahead of the drain that took it. `gone`: a timeline read that began at or after it left the
 * queue does not hold it, so it was removed elsewhere (Edit on another device, a handover, an archive),
 * not sent: the daemon removes a drained message only once Paseo took it. Until one of these, the chat
 * keeps drawing it.
 */
export function settleQueued(
  sends: readonly PendingSend[],
  queueRead: QueueReadOfIds | null,
  timelineRead: ReadOfIds | null,
): { left: string[]; leftQueueAt: number | null; gone: string[] } {
  const left = queueRead === null ? [] : sends.filter((send) => send.state === "queued" && send.handedOver === undefined && send.leftQueueAt === undefined && send.queuedAt !== undefined && send.queuedAt <= queueRead.startedAt && !queueRead.ids.includes(send.id)).map((send) => send.id);
  const gone = timelineRead === null ? [] : sends.filter((send) => send.state === "queued" && send.leftQueueAt !== undefined && send.leftQueueAt <= timelineRead.startedAt && !timelineRead.ids.includes(send.id)).map((send) => send.id);
  return { left, leftQueueAt: queueRead?.answeredAt ?? null, gone };
}

/**
 * Whether the agent is compacting its context: its last compaction started and has neither ended nor
 * been followed by a step of the agent's (one cut short never ends). A message sent now would cancel it:
 * Claude cannot take a message mid-compaction, so Paseo replaces the running turn (Paseo 0.11.2, seen
 * end to end). The plugin refuses one then (TR-102), and the chat offers no Send now (TR-171).
 */
export function isCompacting(entries: readonly SendTimelineEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const item = entries[index]?.item;
    if (item === undefined) continue;
    if (item.type === "compaction") return item.status === "loading";
    if (isAgentStep(item)) return false;
  }
  return false;
}

/** What the plugin answers a chat message sent at once while the agent compacts. */
export const COMPACTING_REFUSAL = "It is compacting its context; the message waits until that ends.";

export function isCompactingRefusal(error: unknown): boolean {
  return errorMessage(error).includes(COMPACTING_REFUSAL);
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

/**
 * What the composer holds after Edit on a message not sent (TR-102), or taken out of the daemon's queue
 * (TR-171): its words and attachments back, ahead of anything written or attached since, so neither is lost.
 */
export function takeBack(
  composer: { text: string; attachments: readonly DraftAttachment[] },
  send: { text: string; attachments: readonly DraftAttachment[] },
): { text: string; attachments: readonly DraftAttachment[] } {
  const typed = composer.text.trim();
  return {
    text: typed === "" ? send.text : send.text === "" ? composer.text : `${send.text}\n\n${composer.text}`,
    attachments: [...send.attachments, ...composer.attachments],
  };
}
