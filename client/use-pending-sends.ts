/**
 * A chat's messages until the agent takes them up (TR-084): sends the user's words (or holds them
 * while an agent that cannot take a message mid-turn works), marks each on the transcript, sends
 * held ones when the turn ends, and forgets each once the agent took a step after it.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { outgoingAttachments, type DraftAttachment, type OutgoingFile, type OutgoingImage } from "../shared/attachments";
import { heldToRelease, isWorking, newChatMessageId, STOPPED_GRACE_MS, viewSends, type PendingSend, type SendTimelineEntry, type SendView } from "../shared/pending-sends";
import { pendingSends } from "./pending-send-store";

export type ChatSend = (text: string, attachments: { images: OutgoingImage[]; files: OutgoingFile[] }, messageId: string) => Promise<void>;

export interface PendingSends {
  /** Each message still waiting, held or unread, in the order sent. */
  views: SendView[];
  /** Sends the words now, or holds them when `holds` (returns the promise of the send, or null when held). */
  send(text: string, attachments: readonly DraftAttachment[]): Promise<void> | null;
  /** Sends a held message at once, replacing the running turn. */
  sendNow(id: string): void;
  /** Sends an unread message again, as a new message. */
  resend(id: string): void;
  /** Forgets a message: a held one is not sent, an unread one loses its mark. */
  forget(id: string): void;
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
  onFailed,
}: {
  agentId: string;
  status: string;
  steers: boolean;
  entries: readonly SendTimelineEntry[];
  hasOlder: boolean;
  onSend: ChatSend | undefined;
  /** A send failed: the message is forgotten and its words handed back. */
  onFailed: (send: PendingSend, error: unknown) => void;
}): PendingSends {
  const [sends, setSends] = useState(() => pendingSends.get(agentId));
  useEffect(() => {
    const reread = () => setSends(pendingSends.get(agentId));
    const stop = pendingSends.subscribe(reread);
    reread();
    return stop;
  }, [agentId]);

  const working = isWorking(status);
  const stoppedAt = useRef<number | null>(working ? null : Date.now());
  if (working) stoppedAt.current = null;
  else if (stoppedAt.current === null) stoppedAt.current = Date.now();

  // Drawn again when a waiting message's grace runs out, as nothing else may change by then.
  const [now, setNow] = useState(Date.now);
  const { views, read } = useMemo(() => viewSends(sends, entries, { stoppedAt: stoppedAt.current, hasOlder }, now), [sends, entries, hasOlder, now, working]);
  const graceEnds = working ? null : views.filter((view) => view.mark === "waiting").map((view) => Math.max(view.send.at, stoppedAt.current ?? 0) + STOPPED_GRACE_MS)[0];
  useEffect(() => {
    if (graceEnds === null || graceEnds === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, graceEnds - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [graceEnds]);
  useEffect(() => {
    if (read.length > 0) pendingSends.remove(agentId, read);
  }, [agentId, read.join(" ")]);

  function deliver(pending: PendingSend): Promise<void> | null {
    if (onSend === undefined) return null;
    pendingSends.update(agentId, pending.id, { state: "sent", at: Date.now() });
    return onSend(pending.text, outgoingAttachments(pending.attachments), pending.id).catch((error: unknown) => {
      pendingSends.remove(agentId, [pending.id]);
      onFailed(pending, error);
      throw error;
    });
  }
  function deliverQuietly(pending: PendingSend): void {
    // A failure is already reported through `onFailed`.
    void deliver(pending)?.catch(() => {});
  }

  const release = heldToRelease(sends, working);
  useEffect(() => {
    release.forEach(deliverQuietly);
  }, [release.map((send) => send.id).join(" ")]);

  const holds = working && !steers;
  return {
    views,
    holds,
    send(text, attachments) {
      const pending: PendingSend = { id: newChatMessageId(), text, attachments, at: Date.now(), state: holds ? "held" : "sent" };
      pendingSends.add(agentId, pending);
      return holds ? null : deliver(pending);
    },
    sendNow(id) {
      const held = sends.find((send) => send.id === id && send.state === "held");
      if (held !== undefined) deliverQuietly(held);
    },
    resend(id) {
      const unread = sends.find((send) => send.id === id);
      if (unread === undefined) return;
      pendingSends.remove(agentId, [id]);
      const again: PendingSend = { ...unread, id: newChatMessageId(), at: Date.now(), state: holds ? "held" : "sent" };
      pendingSends.add(agentId, again);
      if (!holds) deliverQuietly(again);
    },
    forget(id) {
      pendingSends.remove(agentId, [id]);
    },
  };
}
