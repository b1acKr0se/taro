/**
 * Sends a project's held messages when their agent's turn ends, whether or not its chat is open
 * (TR-084): the chat is mounted only while shown, and a message held to a subagent the user moved
 * away from would otherwise wait until its chat was opened again.
 */
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect } from "react";

import { tellAgent, tellManager, type AgentBrief, type Card } from "../shared/contracts";
import { outgoingAttachments } from "../shared/attachments";
import { pendingSends, releaseHeld } from "./pending-send-store";

export function useReleaseHeld(project: string, cards: readonly Card[] | undefined, manager: AgentBrief | null): void {
  const tell = useRpc(tellAgent);
  const tellLead = useRpc(tellManager);
  const agents = [...(cards ?? []).flatMap((card) => [...(card.owner === null ? [] : [card.owner]), ...card.subagents]), ...(manager === null ? [] : [manager])];
  // Changes only when an agent's status does, not on every poll of the board.
  const key = agents.map((agent) => `${agent.id}:${agent.status}:${agent.updatedAt}`).join(" ");
  useEffect(() => {
    const seen = new Map(agents.map((agent) => [agent.id, { status: agent.status, updatedAt: Date.parse(agent.updatedAt) }] as const));
    const release = () =>
      releaseHeld(
        pendingSends,
        seen,
        (agentId, send) => {
          const message = { text: send.text, ...outgoingAttachments(send.attachments), messageId: send.id };
          const sending = agentId === manager?.id ? tellLead({ project, ...message }) : tell({ agentId, ...message });
          // Left marked sent: with the chat closed there is no composer to hand it back to, and once the
          // agent has been stopped a while the chat offers Resend on it.
          void sending.catch(() => {});
        },
        Date.now(),
      );
    release();
    return pendingSends.subscribe(release);
  }, [project, key]);
}
