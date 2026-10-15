/**
 * A chat's messages until the agent takes them up (TR-084): sends the user's words (or holds them
 * while an agent that cannot take a message mid-turn works), marks each on the transcript, sends
 * held ones when the turn ends, and forgets each once the agent took a step after it. The sending
 * itself is the store's (TR-102): in order, one at a time, and on after the chat has gone.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { outgoingAttachments, type DraftAttachment, type OutgoingFile, type OutgoingImage } from "../shared/attachments";
import { heldToRelease, isWorking, newChatMessageId, STOPPED_GRACE_MS, viewSends, type PendingSend, type SendTimelineEntry, type SendView } from "../shared/pending-sends";
import { useLatestCallback } from "./latest-callback";
import { pendingSends } from "./pending-send-store";

export type ChatSend = (text: string, attachments: { images: OutgoingImage[]; files: OutgoingFile[] }, messageId: string) => Promise<void>;

export interface PendingSends {
  /** Each message still waiting, held, sending, failed or unread, in the order sent. */
  views: SendView[];
  /** Sends the words in turn after those before them, or holds them when `holds`. */
  send(text: string, attachments: readonly DraftAttachment[]): void;
  /** Sends a held message at once, replacing the running turn. */
  sendNow(id: string): void;
  /** Sends an unread message again, as a new message. */
  resend(id: string): void;
  /** Sends a failed message again, under its own id. */
  retry(id: string): void;
  /** Forgets a message: a held one is not sent, an unread one loses its mark, a failed one is taken back. */
  forget(id: string): PendingSend | null;
  /** Whether Send holds the message: the agent works and its provider would replace the turn. */
  holds: boolean;
}

export function usePendingSends({
  agentId,
  status,
  steers,
  entries,
  hasOlder,
  onSend,
}: {
  agentId: string;
  status: string;
  steers: boolean;
  entries: readonly SendTimelineEntry[];
  hasOlder: boolean;
  onSend: ChatSend | undefined;
}): PendingSends {
  const [sends, setSends] = useState(() => pendingSends.get(agentId));
  useEffect(() => {
    const reread = () => setSends(pendingSends.get(agentId));
    const stop = pendingSends.subscribe(reread);
    reread();
    return stop;
  }, [agentId]);

  // The latest `onSend`, under one identity: the store keeps it after the chat has gone.
  const transport = useLatestCallback((pending: PendingSend) => {
    if (onSend === undefined) return Promise.reject(new Error("This chat cannot send."));
    return onSend(pending.text, outgoingAttachments(pending.attachments), pending.id);
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

  const release = heldToRelease(sends, working);
  useEffect(() => {
    // Claimed: the screen may release them too (`useReleaseHeld`), and only one of them sends each.
    if (release.length > 0) pendingSends.claim(agentId, release.map((held) => held.id), Date.now());
  }, [release.map((send) => send.id).join(" ")]);

  const holds = working && !steers;
  return {
    views,
    holds,
    send(text, attachments) {
      pendingSends.add(agentId, { id: newChatMessageId(), text, attachments, at: Date.now(), state: holds ? "held" : "sending" });
    },
    sendNow(id) {
      pendingSends.claim(agentId, [id], Date.now());
    },
    resend(id) {
      pendingSends.resend(agentId, id, { id: newChatMessageId(), at: Date.now(), holds });
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
