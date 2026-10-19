/**
 * Gives the pending-send store a transport for every agent of the screen (TR-102), so a message sent
 * just before its chat closed still goes, and its chat's queue is read again when the daemon queued it
 * (TR-171), before the message leaves the store (TR-188).
 */
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { tellAgent, tellManager, type AgentBrief, type Card } from "../shared/contracts";
import { outgoingAttachments } from "../shared/attachments";
import { pendingSends } from "./pending-send-store";
import { afterQueueRead, chatQueueKey } from "./queue-rows";

export function useChatTransports(project: string, cards: readonly Card[] | undefined, manager: AgentBrief | null): void {
  const tell = useRpc(tellAgent);
  const tellLead = useRpc(tellManager);
  const queries = useQueryClient();
  const agents = [...(cards ?? []).flatMap((card) => [...(card.owner === null ? [] : [card.owner]), ...card.subagents]), ...(manager === null ? [] : [manager])];
  useEffect(() => {
    agents.forEach((agent) => {
      const lead = agent.id === manager?.id;
      pendingSends.setTransport(agent.id, async (send) => {
        const message = { text: send.text, ...outgoingAttachments(send.attachments), messageId: send.id, answersRequest: send.answersRequest === true };
        const answer = await (lead ? tellLead({ project, ...message }) : tell({ agentId: agent.id, ...message }));
        return afterQueueRead({ queued: answer.queued }, () => queries.invalidateQueries({ queryKey: chatQueueKey(agent.id) }));
      });
    });
  }, [project, agents.map((agent) => agent.id).join(" "), manager?.id]);
}
