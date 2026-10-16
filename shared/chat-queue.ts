/**
 * The chat queue (TR-171): a message from a Taro chat to an agent that is working waits on the daemon
 * and goes to the agent as its next prompt when the turn ends, so it is answered in a turn of its own
 * and is sent even with the app closed. Send now takes one out and interrupts the turn with it. What
 * is stored, and the decisions (send or queue, may this moment drain), pure, for vitest.
 */
import { z } from "zod";

import { OutgoingFileSchema, OutgoingImageSchema } from "./attachments";
import type { CompactionStage } from "./state";

export const QueuedMessageSchema = z.object({
  /** The chat's id for the message (`chat-…`), also its `messageId` in Paseo, so a resend is skipped. */
  id: z.string().min(1),
  text: z.string(),
  images: z.array(OutgoingImageSchema).default([]),
  files: z.array(OutgoingFileSchema).default([]),
  /** When it was queued (ISO). */
  at: z.string(),
  /** Why its last send failed; a failed front holds the queue until Retry, Edit or Send now. */
  failed: z.string().nullable().default(null),
});
export type QueuedMessage = z.infer<typeof QueuedMessageSchema>;

/** One agent's queue file; a new version starts the queue over rather than misreading it. */
export const ChatQueueFileSchema = z.object({ version: z.literal(1), messages: z.array(QueuedMessageSchema).default([]) });

/** What `taro.queue.list` shows of a message: no attachment data, which can be megabytes. */
export interface QueuedMessageSummary {
  id: string;
  text: string;
  at: string;
  imageCount: number;
  fileNames: string[];
  failed: string | null;
}

export function summarize(message: QueuedMessage): QueuedMessageSummary {
  return { id: message.id, text: message.text, at: message.at, imageCount: message.images.length, fileNames: message.files.map((file) => file.fileName), failed: message.failed };
}

/** The queue with the message added at the back; one already queued under its id is kept as it is. */
export function withQueued(messages: readonly QueuedMessage[], message: QueuedMessage): QueuedMessage[] {
  return messages.some((queued) => queued.id === message.id) ? [...messages] : [...messages, message];
}

/** The queue with the message back at its front (a Send now that failed); a copy elsewhere is dropped. */
export function withFront(messages: readonly QueuedMessage[], message: QueuedMessage): QueuedMessage[] {
  return [message, ...messages.filter((queued) => queued.id !== message.id)];
}

function isWorking(status: string): boolean {
  return status === "running" || status === "initializing";
}

/**
 * Where a chat message goes: at once to an idle agent, into the queue while it works. A message that
 * answers a pending permission or question goes at once even mid-turn: the turn waits on it.
 */
export function routeChatMessage(agent: { status: string }, answersRequest: boolean): "send" | "queue" {
  return answersRequest || !isWorking(agent.status) ? "send" : "queue";
}

/** How long after a Send now a canceled turn end is taken for the turn it cut off. */
export const SEND_NOW_GUARD_MS = 30_000;

/**
 * What asks for a drain: a turn end (its outcome), the sweep, the check right after queueing, or Retry.
 * Only a completed turn end and Retry pass the Send-now guard: a canceled one inside it is the turn Send
 * now cut off, with the new turn already starting, and the sweep or a recheck may catch that same gap.
 */
export type DrainTrigger = "completed" | "canceled" | "sweep" | "queued" | "retry";

export interface DrainCheck {
  trigger: DrainTrigger;
  /** The live agent's Paseo status; null when it is gone. */
  status: string | null;
  compaction: CompactionStage;
  front: Pick<QueuedMessage, "failed"> | null;
  /** When Send now last interrupted this agent (ms), if it did. */
  sendNowAt: number | null;
  now: number;
}

/** Why the front message may not go now, or null when it may: only ever as a new prompt to an idle agent. */
export function drainBlocker(check: DrainCheck): string | null {
  if (check.front === null) return "the queue is empty";
  if (check.front.failed !== null) return "its front failed to send";
  if (check.status === null) return "the agent is gone";
  if (isWorking(check.status)) return "the agent is working";
  // Handoff → /compact → reload: each step is the plugin's next prompt, and the reload's own turn end drains.
  if (check.compaction !== "none") return "the agent is compacting";
  const guarded = check.trigger !== "completed" && check.trigger !== "retry";
  if (guarded && check.sendNowAt !== null && check.now - check.sendNowAt < SEND_NOW_GUARD_MS) return "Send now just interrupted it";
  return null;
}

/** How long after a turn end the sweep waits, so it never races the turn-end hook's own drain. */
export const SWEEP_AFTER_MS = 10_000;

/**
 * Whether the sweep drains this agent's queue: one queued while the plugin was down, or whose turn end
 * was missed. The agent idle, its last turn end (or, unseen, Paseo's last update) long enough ago.
 */
export function sweepDue(entry: { queued: number; status: string | null; idleSince: string | null; now: number }): boolean {
  if (entry.queued === 0 || entry.status === null || isWorking(entry.status)) return false;
  if (entry.idleSince === null) return true;
  const since = Date.parse(entry.idleSince);
  return Number.isNaN(since) || entry.now - since >= SWEEP_AFTER_MS;
}

/** The note a Send now puts before the user's words when it cut a turn off, between fixed markers so the chat can hide it. */
export const INTERRUPT_NOTE_START = "<!-- taro:interrupted -->";
export const INTERRUPT_NOTE_END = "<!-- /taro:interrupted -->";

export function withInterruptNote(note: string, words: string): string {
  const block = `${INTERRUPT_NOTE_START}\n${note.trim()}\n${INTERRUPT_NOTE_END}`;
  return words === "" ? block : `${block}\n\n${words}`;
}

/** The user's words without a leading interrupt note; text without one is returned as it is. */
export function stripInterruptNote(text: string): string {
  if (!text.startsWith(INTERRUPT_NOTE_START)) return text;
  const end = text.indexOf(INTERRUPT_NOTE_END, INTERRUPT_NOTE_START.length);
  if (end === -1) return text;
  const rest = text.slice(end + INTERRUPT_NOTE_END.length);
  return rest.startsWith("\n\n") ? rest.slice(2) : rest.replace(/^\n/, "");
}
