/**
 * The chat queue's rows above the composer (TR-171): what a queued message's row says, which buttons
 * it offers, whether Edit may put it back in the box, and how often the queue is read. Pure, for vitest.
 */
import { imageFileName, type DraftAttachment, type OutgoingFile, type OutgoingImage } from "../shared/attachments";
import type { QueuedMessageSummary } from "../shared/chat-queue";

export type QueueRowMessage = QueuedMessageSummary;

export interface QueueRowText {
  /** The user's words, null for a message of attachments only. */
  words: string | null;
  /** The quieter line under them ("2 images · notes.txt"), null with no attachment. */
  attachments: string | null;
  /** "Not sent: <reason>" for one whose send failed. */
  failed: string | null;
}

export function queueRowText(message: QueueRowMessage): QueueRowText {
  const images = message.imageCount === 0 ? [] : [message.imageCount === 1 ? "1 image" : `${message.imageCount} images`];
  const parts = [...images, ...message.fileNames];
  return {
    words: message.text.trim() === "" ? null : message.text,
    attachments: parts.length === 0 ? null : parts.join(" · "),
    failed: message.failed === null ? null : `Not sent: ${message.failed}`,
  };
}

export type QueueRowAction = "edit" | "send-now" | "retry";

export interface QueueRowButton {
  action: QueueRowAction;
  label: string;
  icon: string;
  /** Drawn in the accent, as Paseo's Send now: the row's main action. */
  accent: boolean;
}

const EDIT: QueueRowButton = { action: "edit", label: "Edit queued message", icon: "Pencil", accent: false };
const SEND_NOW: QueueRowButton = { action: "send-now", label: "Send queued message now", icon: "ArrowUp", accent: true };
const RETRY: QueueRowButton = { action: "retry", label: "Retry queued message", icon: "RotateCcw", accent: true };

/**
 * A row's buttons: Edit and Send now; no Send now while the agent compacts, as the daemon hands one
 * back then; Retry in its place on a message whose send failed.
 */
export function queueRowActions(message: QueueRowMessage, compacting: boolean): QueueRowButton[] {
  if (message.failed !== null) return [EDIT, RETRY];
  return compacting ? [EDIT] : [EDIT, SEND_NOW];
}

export const EDIT_REFUSAL = "Remove the attachments from the box first";

/**
 * Why Edit may not take the message out of the queue, or null when it may: the box and the message both
 * hold attachments, which together may be too many to send. Refused before the message leaves the
 * daemon's queue, so nothing is lost.
 */
export function editRefusal(box: { text: string; attachments: number }, message: QueueRowMessage): string | null {
  return box.attachments > 0 && message.imageCount + message.fileNames.length > 0 ? EDIT_REFUSAL : null;
}

export const QUEUE_POLL_BUSY_MS = 2_000;
export const QUEUE_POLL_QUIET_MS = 15_000;

/** Often while a row may leave or a message may join (the agent works), else seldom: the queue is the daemon's and changes without the app. */
export function queuePollMs(queue: { queued: number; working: boolean }): number {
  return queue.queued > 0 || queue.working ? QUEUE_POLL_BUSY_MS : QUEUE_POLL_QUIET_MS;
}

/** The react-query key of an agent's queue; without the id, every agent's. */
export function chatQueueKey(agentId?: string): readonly string[] {
  return agentId === undefined ? ["taro", "chat-queue"] : ["taro", "chat-queue", agentId];
}

/** A message Edit took out of the queue, as the composer holds attachments: images first, as they were sent. */
export function takenAttachments(messageId: string, taken: { images: readonly OutgoingImage[]; files: readonly OutgoingFile[] }): DraftAttachment[] {
  return [
    ...taken.images.map((image, index): DraftAttachment => ({ id: `${messageId}-image-${index}`, kind: "image", fileName: imageFileName(image.mimeType, index), mimeType: image.mimeType, data: image.data })),
    ...taken.files.map((file, index): DraftAttachment => ({ id: `${messageId}-file-${index}`, kind: "file", fileName: file.fileName, mimeType: file.mimeType, data: file.data })),
  ];
}
