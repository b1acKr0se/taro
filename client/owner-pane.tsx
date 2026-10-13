/**
 * A ticket beside the board (decision 6): the conversation of one of its
 * agents — the live owner, a subagent, or an archived agent read-only — or its
 * ticket, and a way back to the manager. Nothing is pinned above the chat (TR-026):
 * each open decision is a card under the message that asked it, and a delivered
 * ticket's Accept / Request changes sit in a row at the composer.
 * With the board hidden the ticket sits in its own panel beside, so the pane is the chat alone.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { tellAgent, type Card } from "../shared/contracts";
import { decisionBlocksAsText, withoutDecisionBlocks } from "../shared/reports";
import { AgentChat } from "./agent-chat";
import { AcceptanceRow } from "./acceptance-row";
import { ContextMeter } from "./context-meter";
import { Evidence } from "./evidence-view";
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
  // Kept with the card it was chosen on: opening another ticket (its Answer → or Review →) starts on Chat, where its asks are answered.
  const [chosenTab, setTab] = useState<{ card: string; tab: "chat" | "ticket" } | null>(null);
  const tab = ticketBeside || chosenTab?.card !== card.id ? "chat" : chosenTab.tab;
  // Remembered with the card it was made on, so opening another ticket starts from its default agent.
  const [chosen, setChosen] = useState<{ card: string; agent: string } | null>(null);
  const agents = useMemo(() => paneAgents(card), [card.owner, card.subagents, card.pastAgents]);
  const now = useNow();
  const chosenId = chosen?.card === card.id ? chosen.agent : null;
  const shown = agents.find((agent) => agent.id === chosenId) ?? defaultPaneAgent(agents) ?? agents[0] ?? null;
  const inset = compact ? SPACE.md : SPACE.lg;
  const accepting = card.status === "Awaiting acceptance" && card.owner !== null;
  const shownAsks = useMemo(() => card.decisions.filter((decision) => decision.agentId === shown?.id), [card.decisions, shown?.id]);
  // A question another of the ticket's agents asked is answered in that agent's chat.
  const askedElsewhere = card.decisions.find((decision) => decision.agentId !== shown?.id && agents.some((agent) => agent.id === decision.agentId));
  const askedElsewhereBy = askedElsewhere === undefined ? undefined : agents.find((agent) => agent.id === askedElsewhere.agentId);
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
            onChange={(value: "chat" | "ticket") => setTab({ card: card.id, tab: value })}
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
            placeholder={accepting && shown.id === card.owner?.id ? `Talk to ${card.id}'s owner, or type the changes you want…` : `Talk to ${card.id}'s ${paneAgentJob(shown.role)}…`}
            onSend={async (text) => {
              await tell({ agentId: shown.id, text });
            }}
            transformText={withoutDecisionBlocks}
            asks={{ decisions: shownAsks, onAnswered: onChanged }}
            actions={
              <>
                {askedElsewhere === undefined || askedElsewhereBy === undefined ? null : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setChosen({ card: card.id, agent: askedElsewhereBy.id })}
                    style={{ width: "100%", flexDirection: "row", alignItems: "center", gap: SPACE.sm }}
                  >
                    <Icon name="Hand" size={13} color={askedElsewhere.blocking ? theme.colors.statusWarning : theme.colors.foregroundMuted} />
                    <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: FONT_SIZE.caption }} numberOfLines={1}>
                      {askedElsewhere.question}
                    </Text>
                    <Text style={{ color: theme.colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" }}>Open {askedElsewhereBy.label}</Text>
                  </Pressable>
                )}
                {/* Request changes sends the owner's draft, so the row sits on the owner's composer only. */}
                {accepting && shown.id === card.owner?.id ? (
                  <AcceptanceRow
                    card={card}
                    project={project}
                    agentId={shown.id}
                    theme={theme}
                    compact={compact}
                    evidence={<Evidence project={project} ticket={card.id} theme={theme} />}
                    trailing={<ContextMeter theme={theme} used={shown.brief.contextUsedTokens} max={shown.brief.contextMaxTokens} />}
                    onChanged={onChanged}
                  />
                ) : (
                  <ContextMeter theme={theme} used={shown.brief.contextUsedTokens} max={shown.brief.contextMaxTokens} />
                )}
              </>
            }
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
