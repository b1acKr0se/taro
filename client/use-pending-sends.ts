/**
 * A chat's messages until the agent takes them up (TR-084): sends the user's words, marks each on the
 * transcript, and forgets each once the agent took a step after it, or when the daemon queued it
 * because the agent works, once the queue was read again (TR-171, TR-188: the queue track above the
 * composer shows it then). The sending itself is the store's (TR-102): in order, one at a time, and on
 * after the chat has gone.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { outgoingAttachments, type DraftAttachment, type OutgoingFile, type OutgoingImage } from "../shared/attachments";
import { isWorking, newChatMessageId, STOPPED_GRACE_MS, viewSends, type PendingSend, type SendTimelineEntry, type SendView } from "../shared/pending-sends";
import { useLatestCallback } from "./latest-callback";
import { pendingSends } from "./pending-send-store";
import { afterQueueRead } from "./queue-rows";

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
  /** Each message still waiting, sending, failed or unread, in the order sent. */
  views: SendView[];
  /** Sends the words in turn after those before them. */
  send(text: string, attachments: readonly DraftAttachment[], answersRequest: boolean): void;
  /** Sends an unread message again, as a new message. */
  resend(id: string): void;
  /** Sends a failed message again, under its own id. */
  retry(id: string): void;
  /** Forgets a message: an unread one loses its mark, a failed one is taken back. */
  forget(id: string): PendingSend | null;
}

export function usePendingSends({
  agentId,
  status,
  entries,
  hasOlder,
  onSend,
  onQueued,
}: {
  agentId: string;
  status: string;
  entries: readonly SendTimelineEntry[];
  hasOlder: boolean;
  onSend: ChatSend | undefined;
  /** Told when the daemon queued a message, to read the queue again at once; the message stays until it is read (TR-188). */
  onQueued: () => Promise<unknown>;
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
    return afterQueueRead(answer, onQueued);
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

  return {
    views,
    send(text, attachments, answersRequest) {
      pendingSends.add(agentId, { id: newChatMessageId(), text, attachments, at: Date.now(), state: "sending", ...(answersRequest ? { answersRequest } : {}) });
    },
    resend(id) {
      pendingSends.resend(agentId, id, { id: newChatMessageId(), at: Date.now() });
    },
    retry(id) {
      pendingSends.retry(agentId, id);
    },
    forget(id) {
      const gone = pendingSends.get(agentId).find((send) => send.id === id) ?? null;
      pendingSends.remove(agentId, [id]);
      return gone;
    },
  };
}
