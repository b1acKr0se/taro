/**
 * A ticket beside the board (decision 6): the conversation of one of its
 * agents — the live owner, a subagent, or an archived agent read-only — or its
 * ticket, and a way back to the manager. What the ticket asks of you (its open
 * decisions, acceptance) is pinned above the chat (TR-022); the transcript marks
 * where each was asked.
 * With the board hidden the ticket sits in its own panel beside, so the pane is the chat alone.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { tellAgent, type Card } from "../shared/contracts";
import { decisionBlocksAsText, withoutDecisionBlocks } from "../shared/reports";
import { AgentChat } from "./agent-chat";
import { AcceptancePanel, AskedHere, AsksYou } from "./asks-you";
import { ContextMeter } from "./context-meter";
import { defaultPaneAgent, paneAgents, paneAgentJob, roleIcon } from "./pane-agents";
import { PaneHeader } from "./pane-header";
import { SPACE } from "./spacing";
import { TicketView } from "./ticket-view";
import { FONT_SIZE } from "./type-scale";
import { IconButton, Segmented } from "./ui";
import { AgentChips } from "./agent-chips";
import { useNow } from "./use-now";

const ARCHIVED_NOTE = "Finished — this agent is archived; its conversation is read-only.";

export function OwnerPane({
  card,
  project,
  theme,
  compact,
  ticketBeside,
  onBack,
  onOpenAgent,
  onChanged,
  onShowBoard,
}: {
  card: Card;
  project: string;
  theme: PluginTheme;
  compact: boolean;
  /** The ticket is drawn in a panel beside this pane: no Chat · Ticket switch. */
  ticketBeside: boolean;
  onBack: () => void;
  onOpenAgent: ((agentId: string) => void) | null;
  onChanged: () => void;
  /** Brings the hidden board back; null while it shows. */
  onShowBoard: (() => void) | null;
}) {
  const tell = useRpc(tellAgent);
  const [chosenTab, setTab] = useState<"chat" | "ticket">("chat");
  const tab = ticketBeside ? "chat" : chosenTab;
  // Remembered with the card it was made on, so opening another ticket starts from its default agent.
  const [chosen, setChosen] = useState<{ card: string; agent: string } | null>(null);
  const agents = useMemo(() => paneAgents(card), [card.owner, card.subagents, card.pastAgents]);
  const now = useNow();
  const chosenId = chosen?.card === card.id ? chosen.agent : null;
  const shown = agents.find((agent) => agent.id === chosenId) ?? defaultPaneAgent(agents) ?? agents[0] ?? null;
  const inset = compact ? SPACE.md : SPACE.lg;
  const accepting = card.status === "Awaiting acceptance" && card.owner !== null;
  return (
    <View style={{ flex: 1 }}>
      <PaneHeader
        theme={theme}
        title={`${card.id} · ${card.title}`}
        subtitle={shown === null ? undefined : `${shown.label} · ${shown.live ? shown.brief.status : "archived"}`}
        icon={shown === null ? "Bot" : roleIcon(shown)}
      >
        {shown !== null && onOpenAgent !== null ? <IconButton icon="ExternalLink" label="Open in Paseo" theme={theme} onPress={() => onOpenAgent(shown.id)} /> : null}
        <IconButton icon="ArrowLeft" label="Back to the manager" showLabel={!compact} theme={theme} onPress={onBack} />
        {onShowBoard === null ? null : <IconButton icon="PanelRightOpen" label="Show the board" theme={theme} onPress={onShowBoard} />}
      </PaneHeader>
      <View style={{ paddingHorizontal: inset, paddingVertical: SPACE.sm, gap: SPACE.sm }}>
        {ticketBeside ? null : (
          <Segmented
            theme={theme}
            value={tab}
            options={[
              { value: "chat", label: "Chat", icon: "MessageSquare" },
              { value: "ticket", label: "Ticket", icon: "ClipboardList" },
            ]}
            onChange={(value: "chat" | "ticket") => setTab(value)}
          />
        )}
        {/* Archived agents here do not mean the work stopped: the current owner may run elsewhere. */}
        {tab === "chat" && shown !== null && card.owner === null && card.ownerElsewhere !== null ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small }}>Its current owner runs on {card.ownerElsewhere}.</Text>
        ) : null}
        {tab === "chat" && agents.length > 1 ? (
          <AgentChips theme={theme} agents={agents} selectedId={shown?.id ?? null} now={now} onSelect={(agentId) => setChosen({ card: card.id, agent: agentId })} />
        ) : null}
      </View>
      {tab === "chat" ? (
        <AsksYou
          decisions={card.decisions}
          acceptance={accepting ? <AcceptancePanel card={card} project={project} theme={theme} compact={compact} onChanged={onChanged} /> : null}
          theme={theme}
          compact={compact}
          onChanged={onChanged}
        />
      ) : null}
      <View style={{ flex: 1 }}>
        {tab === "ticket" ? (
          <TicketView key={card.id} project={project} ticket={card.id} theme={theme} />
        ) : shown === null ? (
          <Text style={{ color: theme.colors.foregroundMuted, padding: SPACE.lg }}>
            {card.ownerElsewhere !== null ? `Its owner runs on ${card.ownerElsewhere}.` : "No owner is running for this ticket."}
          </Text>
        ) : shown.live ? (
          <AgentChat
            key={shown.id}
            agent={{ id: shown.id, updatedAt: shown.brief.updatedAt, pendingPermissions: shown.brief.pendingPermissions, status: shown.brief.status }}
            theme={theme}
            compact={compact}
            placeholder={`Talk to ${card.id}'s ${paneAgentJob(shown.role)}…`}
            onSend={async (text) => {
              await tell({ agentId: shown.id, text });
            }}
            transformText={withoutDecisionBlocks}
            decorateRow={(text) => <AskedHere text={text} open={card.decisions} theme={theme} />}
            actions={<ContextMeter theme={theme} used={shown.brief.contextUsedTokens} max={shown.brief.contextMaxTokens} />}
          />
        ) : (
          <AgentChat
            key={shown.id}
            agent={{ id: shown.id, updatedAt: shown.brief.updatedAt, pendingPermissions: 0, status: shown.brief.status }}
            theme={theme}
            compact={compact}
            // No cards for a finished agent's questions: each block reads as a quote of what it asked.
            transformText={decisionBlocksAsText}
            readOnly={{ note: ARCHIVED_NOTE }}
          />
        )}
      </View>
    </View>
  );
}
