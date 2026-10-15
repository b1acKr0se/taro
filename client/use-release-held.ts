/**
 * Sends a project's held messages when their agent's turn ends, whether or not its chat is open
 * (TR-084): the chat is mounted only while shown, and a message held to a subagent the user moved
 * away from would otherwise wait until its chat was opened again. Gives the store a transport for
 * every agent of the screen (TR-102), so a message sent just before its chat closed still goes.
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
  // Every agent's messages reach Paseo through the screen too, so they go on after their chat closed.
  useEffect(() => {
    agents.forEach((agent) => {
      const lead = agent.id === manager?.id;
      pendingSends.setTransport(agent.id, (send) => {
        const message = { text: send.text, ...outgoingAttachments(send.attachments), messageId: send.id };
        return (lead ? tellLead({ project, ...message }) : tell({ agentId: agent.id, ...message })).then(() => undefined);
      });
    });
  }, [project, agents.map((agent) => agent.id).join(" "), manager?.id]);
  useEffect(() => {
    const seen = new Map(agents.map((agent) => [agent.id, { status: agent.status, updatedAt: Date.parse(agent.updatedAt) }] as const));
    const release = () => releaseHeld(pendingSends, seen, Date.now());
    release();
    return pendingSends.subscribe(release);
  }, [project, key]);
}
