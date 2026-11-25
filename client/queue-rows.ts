/**
 * The chat queue's rows above the composer (TR-171): what a queued message's row says, which buttons
 * it offers, whether Edit may put it back in the box, and how often the queue is read. Pure, for vitest.
 */
import { attachmentProblem, imageFileName, type DraftAttachment, type OutgoingFile, type OutgoingImage } from "../shared/attachments";
import { NOT_QUEUED, type QueuedMessageSummary } from "../shared/chat-queue";
import { takeBack, type PendingSend, type SendView } from "../shared/pending-sends";

/**
 * A row's message; `behind`: one of this app's, waiting for a failed message before it to be sent;
 * `left`: one of this app's the daemon's queue no longer lists, as it took it from the front.
 */
export type QueueRowMessage = QueuedMessageSummary & { behind?: boolean | undefined; left?: boolean | undefined };

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
 * back then, nor on one behind a failed message, which it cannot go before; Retry in its place on a
 * message whose send failed.
 */
export function queueRowActions(message: QueueRowMessage, compacting: boolean): QueueRowButton[] {
  if (message.failed !== null) return [EDIT, RETRY];
  return compacting || message.behind === true ? [EDIT] : [EDIT, SEND_NOW];
}

/** A retried row's buttons while its Retry is under way: Edit (disabled) and Retry (busy). */
export const RETRYING_ACTIONS: readonly QueueRowButton[] = [EDIT, RETRY];

/** Whether a press on a row acts: only its own action under way holds it up, never another row's. */
export function mayAct(busy: ReadonlyMap<string, QueueRowAction>, id: string): boolean {
  return !busy.has(id);
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
 * The chat's messages the daemon queues, or will (sent while the agent works): drawn as rows of the
 * queue track, finished at once with their buttons, rather than in the transcript, from the moment they
 * leave until the timeline shows them. Whether one is drawn here follows how it was sent, never the
 * agent's status now, so it does not jump as the status flips. One sent to an idle agent
 * (`sentWhileIdle`) is the transcript's, and one handed over (Edit, Send now) is drawn elsewhere.
 */
export function sendingToQueue(views: readonly SendView[]): QueueRowMessage[] {
  return views.flatMap((view) =>
    view.rowKey === null && view.send.sentWhileIdle !== true && view.send.handedOver === undefined && (view.mark === "sending" || view.mark === "behind" || view.mark === "queued")
      ? [
          {
            id: view.send.id,
            text: view.send.text,
            at: new Date(view.send.at).toISOString(),
            imageCount: view.send.attachments.filter((attachment) => attachment.kind === "image").length,
            fileNames: view.send.attachments.flatMap((attachment) => (attachment.kind === "file" ? [attachment.fileName] : [])),
            failed: null,
            ...(view.mark === "behind" ? { behind: true } : {}),
            ...(view.send.leftQueueAt !== undefined ? { left: true } : {}),
          },
        ]
      : [],
  );
}

/** One row of the queue track; `local`: only this app's copy lists it (the daemon's read does not yet, or no longer). */
export interface TrackRow {
  message: QueueRowMessage;
  local: boolean;
  /** Retry is under way: drawn without its Not sent line. */
  retrying: boolean;
}

/**
 * The queue track's rows: this app's that left the daemon's queue first (the daemon drains its front),
 * then the daemon's in its order, then this app's it does not list yet, each message once under its own id. Not those `hidden` (handed over to the box or the transcript, or held as sent
 * to an idle agent), nor those the timeline shows: a message is the transcript's or the queue's, never both.
 */
export function trackRows({
  daemon,
  local,
  hidden,
  inTimeline,
  retrying,
}: {
  daemon: readonly QueueRowMessage[];
  local: readonly QueueRowMessage[];
  hidden: ReadonlySet<string>;
  inTimeline: ReadonlySet<string>;
  retrying: ReadonlySet<string>;
}): TrackRow[] {
  const listed = new Set(daemon.map((message) => message.id));
  const unlisted = local.filter((message) => !listed.has(message.id));
  const rows = [
    ...unlisted.filter((message) => message.left === true).map((message) => ({ message, local: true })),
    ...daemon.map((message) => ({ message, local: false })),
    ...unlisted.filter((message) => message.left !== true).map((message) => ({ message, local: true })),
  ];
  return rows
    .filter((row) => !hidden.has(row.message.id) && !inTimeline.has(row.message.id))
    .map((row) => (retrying.has(row.message.id) ? { message: { ...row.message, failed: null }, local: row.local, retrying: true } : { ...row, retrying: false }));
}

/**
 * Whether a new message goes as one sent to an idle agent (`sentWhileIdle`): the chat shows the agent
 * idle, with no queue row and no compaction; otherwise the daemon queues it, and it is drawn in the track.
 */
export function sendsAsIdle(workingShown: boolean, queueRows: number, compacting: boolean): boolean {
  return !workingShown && queueRows === 0 && !compacting;
}

/** How a call on the daemon's queue answered: null before it is made. */
export type QueueCall = "ok" | "not-queued" | "other-error";

export function queueCallFailure(error: string): Exclude<QueueCall, "ok"> {
  return error.includes(NOT_QUEUED) ? "not-queued" : "other-error";
}

/**
 * What Edit still does after the store took a held message out (`takeOut`), and after the removal on the
 * daemon answered (`removal`, null before it is asked). "remove": ask `taro.queue.remove`;
 * "sent-meanwhile": its words stay in the box, with `EDIT_SENT_MEANWHILE`; "still-queued-check": read the
 * queue again (`editRemoval`). One whose send went unanswered and that the daemon does not hold was never
 * queued, unless the timeline shows it.
 */
export function afterTakeOut(
  outcome: "never-sent" | "queued" | "sent" | "maybe-queued",
  removal: QueueCall | null,
  inTimeline: boolean,
): "done" | "sent-meanwhile" | "remove" | "still-queued-check" {
  if (outcome === "never-sent") return "done";
  if (outcome === "sent") return "sent-meanwhile";
  if (removal === null) return "remove";
  if (removal === "ok") return "done";
  if (removal === "other-error") return "still-queued-check";
  return outcome === "queued" || inTimeline ? "sent-meanwhile" : "done";
}

/**
 * What Send now on a held message does once its send settled (`whenSettled`), and after
 * `taro.queue.send-now` answered (`call`, null before it is made). "call": make it; "sent": mark it sent
 * (the daemon also answers "no longer queued" when it had sent it already); "row-back": clear the mark,
 * the row comes back; "failed": clear the mark, drawn as any failed send.
 */
export function afterSendNow(settled: "queued" | "sent" | "failed" | "gone", call: QueueCall | null): "call" | "sent" | "row-back" | "failed" | "nothing" {
  if (settled === "failed") return "failed";
  if (settled !== "queued") return "nothing";
  if (call === null) return "call";
  return call === "other-error" ? "row-back" : "sent";
}

/**
 * The rows the chat still hides after Edit or Send now: by when the action's last call answered (null
 * while under way), released by a queue read that began after it, so the daemon's row never blinks back.
 */
export function hiddenAfterRead(hidden: ReadonlyMap<string, number | null>, readStartedAt: number | null): ReadonlyMap<string, number | null> {
  if (readStartedAt === null || ![...hidden.values()].some((answeredAt) => answeredAt !== null && readStartedAt > answeredAt)) return hidden;
  return new Map([...hidden].filter(([, answeredAt]) => answeredAt === null || readStartedAt <= answeredAt));
}

export interface ComposerBox {
  text: string;
  attachments: readonly DraftAttachment[];
}

/** Whether an attachment in the box is one Edit put there from this message (`takenAttachments`, `heldAttachments`). */
function fromMessage(attachment: DraftAttachment, messageId: string): boolean {
  return attachment.id.startsWith(`${messageId}-image-`) || attachment.id.startsWith(`${messageId}-file-`);
}

/**
 * The box without a message Edit put in it, when its removal failed and the daemon still queues it: its
 * words as `takeBack` put them (a block of their own) and its attachments, everything else kept. Null when
 * they no longer stand there intact (the user changed them): the box is kept as it is.
 */
export function withoutTaken(box: ComposerBox, taken: { messageId: string; text: string }): ComposerBox | null {
  const attachments = box.attachments.filter((attachment) => !fromMessage(attachment, taken.messageId));
  if (taken.text === "") return attachments.length === box.attachments.length ? null : { text: box.text, attachments };
  const separator = "\n\n";
  for (let start = box.text.indexOf(taken.text); start !== -1; start = box.text.indexOf(taken.text, start + 1)) {
    const end = start + taken.text.length;
    const before = start === 0 || box.text.slice(start - separator.length, start) === separator;
    const after = end === box.text.length || box.text.slice(end, end + separator.length) === separator;
    if (!before || !after) continue;
    const text = end < box.text.length ? box.text.slice(0, start) + box.text.slice(end + separator.length) : box.text.slice(0, Math.max(0, start - separator.length));
    return { text, attachments };
  }
  return null;
}

export const STILL_QUEUED_IN_BOX = "That message is still queued; its words are also in the box.";

/**
 * The box once `taro.queue.take` answered, built from the box as it is then (another Edit may have
 * answered meanwhile, or the user typed on): refused, with why, when the attachments would not fit
 * together, before the message leaves the queue.
 */
export function boxAfterTake(box: ComposerBox, message: QueueRowMessage, taken: { text: string; images: readonly OutgoingImage[]; files: readonly OutgoingFile[] }): { box: ComposerBox } | { refused: string } {
  const refusal = editRefusal({ text: box.text, attachments: box.attachments.length }, message);
  if (refusal !== null) return { refused: refusal };
  const back = takeBack(box, { text: taken.text, attachments: takenAttachments(message.id, taken) });
  const problem = attachmentProblem(back.attachments);
  return problem === null ? { box: back } : { refused: `${problem} Remove some from the box first.` };
}

/** A held message's attachments as Edit puts them in the box: under ids that say whose they are, as `takenAttachments` does. */
export function heldAttachments(messageId: string, attachments: readonly DraftAttachment[]): DraftAttachment[] {
  const images = attachments.filter((attachment) => attachment.kind === "image");
  const files = attachments.filter((attachment) => attachment.kind !== "image");
  return [...images.map((image, index) => ({ ...image, id: `${messageId}-image-${index}` })), ...files.map((file, index) => ({ ...file, id: `${messageId}-file-${index}` }))];
}

/**
 * A queued message as the transcript's echo once Send now is pressed (the daemon's call takes seconds
 * to cut the turn off), so the row hands over in one step instead of lingering with a spinner. Null for
 * a message with attachments, whose data stays on the daemon: it keeps its row until the call answers.
 * Marked `sentWhileIdle` so the queue track does not draw it again; the timeline's own row replaces it.
 */
export function handedOverSend(message: QueueRowMessage, now: number): PendingSend | null {
  if (message.imageCount + message.fileNames.length > 0) return null;
  return { id: message.id, text: message.text, attachments: [], at: now, state: "sent", sentWhileIdle: true };
}
