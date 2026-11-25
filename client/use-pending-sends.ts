/**
 * A chat's messages until the agent takes them up (TR-084): sends the user's words, marks each on the
 * transcript, and forgets each once the agent took a step after it. One the daemon queued because the
 * agent works (TR-171) stays, drawn in the queue track, until the timeline shows it or the reads say it
 * is gone (`settleQueued`), so its row never leaves and comes back. The sending itself is the store's
 * (TR-102): in order, one at a time, and on after the chat has gone.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { outgoingAttachments, type DraftAttachment, type OutgoingFile, type OutgoingImage } from "../shared/attachments";
import { isWorking, newChatMessageId, settleQueued, STOPPED_GRACE_MS, turnIsOpen, viewSends, type PendingSend, type QueueReadOfIds, type SendTimelineEntry, type SendView } from "../shared/pending-sends";
import { useLatestCallback } from "./latest-callback";
import { pendingSends, type SendSettled, type TakeOutcome } from "./pending-send-store";
import { handedOverSend, type QueueRowMessage } from "./queue-rows";

/**
 * Sends the words and attachments under the chat's own message id; `answersRequest` when the chat shows
 * a permission or question the words turn down, so they go at once even mid-turn. Resolves with whether
 * the daemon queued it.
 */
export type ChatSend = (
  text: string,
  attachments: { images: OutgoingImage[]; files: OutgoingFile[] },
  messageId: string,
  answersRequest: boolean,
) => Promise<{ queued: boolean }>;

export interface PendingSends {
  /** Each message still waiting, sending, queued, failed or unread, in the order sent. */
  views: SendView[];
  /** Whether the agent's newest turn is still going: false while it only started on a message the timeline has not shown yet. */
  turnOpen: boolean;
  /** The clientMessageIds of the user's messages the timeline shows. */
  inTimeline: ReadonlySet<string>;
  /** Sends the words in turn after those before them; `sentWhileIdle` as `sendsAsIdle` says. */
  send(text: string, attachments: readonly DraftAttachment[], answersRequest: boolean, sentWhileIdle: boolean): void;
  /** Sends an unread message again, as a new message. */
  resend(id: string, sentWhileIdle: boolean): void;
  /** Sends a failed message again, under its own id. */
  retry(id: string): void;
  /** Shows a message the daemon is sending now (Send now) in the transcript at once; false when it cannot be echoed. */
  handOver(message: QueueRowMessage): boolean;
  /** Forgets a message: an unread one loses its mark, a failed one is taken back. */
  forget(id: string): PendingSend | null;
  /** This app's own copy of a message, words and attachments, while the store holds it. */
  held(id: string): PendingSend | null;
  /** Edit on a held message (`PendingSendStore.takeOut`). */
  takeOut(id: string): Promise<TakeOutcome>;
  /** Send now on a held message (`PendingSendStore.sendNow`). */
  sendNow(id: string): Promise<SendSettled>;
  update(id: string, change: Partial<PendingSend>): void;
}

export function usePendingSends({
  agentId,
  status,
  entries,
  hasOlder,
  onSend,
  onQueued,
  queueRead,
  timelineReadStartedAt,
}: {
  agentId: string;
  status: string;
  entries: readonly SendTimelineEntry[];
  hasOlder: boolean;
  onSend: ChatSend | undefined;
  /** Told when the daemon queued a message, to read the queue again at once. */
  onQueued: () => Promise<unknown>;
  /** The daemon's queue as last read, null before a read: a queued message leaves it only on a read begun after the daemon had it. */
  queueRead: QueueReadOfIds | null;
  /** When the timeline's shown read began, null before one. */
  timelineReadStartedAt: number | null;
}): PendingSends {
  const [sends, setSends] = useState(() => pendingSends.get(agentId));
  useEffect(() => {
    const reread = () => setSends(pendingSends.get(agentId));
    const stop = pendingSends.subscribe(reread);
    reread();
    return stop;
  }, [agentId]);

  // The latest `onSend`, under one identity: the store keeps it after the chat has gone.
  const transport = useLatestCallback(async (pending: PendingSend) => {
    if (onSend === undefined) throw new Error("This chat cannot send.");
    const answer = await onSend(pending.text, outgoingAttachments(pending.attachments), pending.id, pending.answersRequest === true);
    // The store keeps it, so its row stays; the read only brings the daemon's own row in sooner.
    if (answer.queued) void onQueued().catch(() => undefined);
    return answer;
  });
  const canSend = onSend !== undefined;
  useEffect(() => {
    if (canSend) pendingSends.setTransport(agentId, transport);
  }, [agentId, canSend]);

  const working = isWorking(status);
  const stoppedAt = useRef<number | null>(working ? null : Date.now());
  if (working) stoppedAt.current = null;
  else if (stoppedAt.current === null) stoppedAt.current = Date.now();

  // Drawn again when a waiting message's grace runs out, as nothing else may change by then.
  const [now, setNow] = useState(Date.now);
  const { views, read, landed } = useMemo(() => viewSends(sends, entries, { stoppedAt: stoppedAt.current, hasOlder }, now), [sends, entries, hasOlder, now, working]);
  const graceEnds = working ? null : views.filter((view) => view.mark === "waiting").map((view) => Math.max(view.send.at, stoppedAt.current ?? 0) + STOPPED_GRACE_MS)[0];
  useEffect(() => {
    if (graceEnds === null || graceEnds === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, graceEnds - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [graceEnds]);
  useEffect(() => {
    if (read.length > 0) pendingSends.remove(agentId, read);
  }, [agentId, read.join(" ")]);
  // Paseo has these, whatever their send said: those after a failed one may go on.
  useEffect(() => {
    landed.forEach((id) => pendingSends.update(agentId, id, { state: "sent", error: undefined }));
  }, [agentId, landed.join(" ")]);

  const inTimeline = useMemo(() => new Set(entries.flatMap((entry) => (entry.item.type === "user_message" && entry.item.clientMessageId !== undefined ? [entry.item.clientMessageId] : []))), [entries]);
  // A queued message the daemon's queue no longer lists is noted; one the timeline then lacks as well was removed elsewhere.
  useEffect(() => {
    const timelineRead = timelineReadStartedAt === null ? null : { ids: [...inTimeline], startedAt: timelineReadStartedAt };
    const { left, leftQueueAt, gone, found } = settleQueued(sends, queueRead, timelineRead);
    if (leftQueueAt !== null) left.forEach((id) => pendingSends.update(agentId, id, { leftQueueAt }));
    if (queueRead !== null) found.forEach((id) => pendingSends.update(agentId, id, { state: "queued", queuedAt: queueRead.startedAt, error: undefined }));
    if (gone.length > 0) pendingSends.remove(agentId, gone);
  }, [agentId, sends, queueRead, timelineReadStartedAt, inTimeline]);

  return {
    views,
    turnOpen: turnIsOpen(working, views),
    inTimeline,
    send(text, attachments, answersRequest, sentWhileIdle) {
      const id = newChatMessageId();
      pendingSends.add(agentId, { id, text, attachments, at: Date.now(), state: "sending", ...(sentWhileIdle ? { sentWhileIdle: true } : {}), ...(answersRequest ? { answersRequest } : {}) });
    },
    resend(id, sentWhileIdle) {
      pendingSends.resend(agentId, id, { id: newChatMessageId(), at: Date.now(), sentWhileIdle });
    },
    retry(id) {
      pendingSends.retry(agentId, id);
    },
    handOver(message) {
      const echo = handedOverSend(message, Date.now());
      if (echo === null) return false;
      pendingSends.add(agentId, echo);
      return true;
    },
    forget(id) {
      const gone = pendingSends.get(agentId).find((send) => send.id === id) ?? null;
      pendingSends.remove(agentId, [id]);
      return gone;
    },
    held: (id) => pendingSends.get(agentId).find((send) => send.id === id) ?? null,
    takeOut: (id) => pendingSends.takeOut(agentId, id),
    sendNow: (id) => pendingSends.sendNow(agentId, id),
    update: (id, change) => pendingSends.update(agentId, id, change),
  };
}
