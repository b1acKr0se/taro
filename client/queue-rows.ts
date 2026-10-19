/**
 * The chat queue's rows above the composer (TR-171): what a queued message's row says, which buttons
 * it offers, whether Edit may put it back in the box, and how often the queue is read. Pure, for vitest.
 */
import { imageFileName, type DraftAttachment, type OutgoingFile, type OutgoingImage } from "../shared/attachments";
import { NOT_QUEUED, type QueuedMessageSummary } from "../shared/chat-queue";
import type { SendView } from "../shared/pending-sends";

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

/**
 * Whether the agent compacts, for its rows: the timeline shows Claude's own compaction, the daemon
 * Taro's handoff → /compact → reload, during which it refuses Send now as well.
 */
export function queueCompacting(timelineCompacting: boolean, daemonCompacting: boolean): boolean {
  return timelineCompacting || daemonCompacting;
}

export const EDIT_REFUSAL = "Remove the attachments from the box first";

export const EDIT_SENT_MEANWHILE = "That message was sent to the agent meanwhile; its words stay in the box.";

/**
 * Edit fills the box from `taro.queue.take`, then asks `taro.queue.remove` to take the message out. A
 * removal refused as "no longer queued" means the queue sent it meanwhile (the words stay, with a note).
 * Any other failure may be a lost answer to a removal that went through, so the queue is read again
 * (`queuedIds`, null when that failed too): still there, the box goes back as it was so it is not there
 * twice; gone, or unknown, the words stay, as a message in neither the box nor the queue is lost.
 */
export function editRemoval(error: string, messageId: string, queuedIds: readonly string[] | null): "sent-meanwhile" | "still-queued" | "removed" | "unknown" {
  if (error.includes(NOT_QUEUED)) return "sent-meanwhile";
  if (queuedIds === null) return "unknown";
  return queuedIds.includes(messageId) ? "still-queued" : "removed";
}

/**
 * Why Edit may not take the message out of the queue, or null when it may: the box and the message both
 * hold attachments, which together may be too many to send. Refused before the message is taken.
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

/**
 * The chat's messages on their way to a working agent, drawn as rows of the queue (a spinner, no
 * buttons) rather than in the transcript: the daemon will queue them, and a row that first showed in
 * the transcript would jump to the track once it answered. One answered "sent at once" (the turn had
 * just ended) moves to the transcript as any sent message.
 */
export function sendingToQueue(views: readonly SendView[], working: boolean): QueueRowMessage[] {
  if (!working) return [];
  return views.flatMap((view) =>
    view.rowKey === null && (view.mark === "sending" || view.mark === "behind")
      ? [
          {
            id: view.send.id,
            text: view.send.text,
            at: new Date(view.send.at).toISOString(),
            imageCount: view.send.attachments.filter((attachment) => attachment.kind === "image").length,
            fileNames: view.send.attachments.flatMap((attachment) => (attachment.kind === "file" ? [attachment.fileName] : [])),
            failed: null,
          },
        ]
      : [],
  );
}

/** How long a queued message's send waits for the queue to be read again before its arriving row goes anyway. */
export const QUEUE_READ_WAIT_MS = 3_000;

/**
 * The answer of a send the daemon queued, given only once the queue was read again (TR-188): the store
 * forgets the message's arriving row on that answer, and until the read lands no row would show it, so
 * the row went and came back. A read that fails or outlasts the wait lets it go anyway.
 */
export async function afterQueueRead<Answer extends { queued: boolean }>(
  answer: Answer,
  readQueue: () => Promise<unknown>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Answer> {
  if (!answer.queued) return answer;
  await Promise.race([readQueue().catch(() => undefined), wait(QUEUE_READ_WAIT_MS)]);
  return answer;
}
