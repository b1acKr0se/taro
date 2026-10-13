/**
 * A ticket beside the board (decision 6): the conversation of one of its
 * agents — the live owner with decision cards drawn inline, a helper, or an
 * archived agent read-only — or its ticket, and a way back to the manager.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { tellAgent, type Card } from "../shared/contracts";
import { decisionBlocksAsText, parseDecisionBlocks, withoutDecisionBlocks } from "../shared/reports";
import { AgentChat } from "./agent-chat";
import { ContextMeter } from "./context-meter";
import { DecisionCard } from "./decision-card";
import { defaultPaneAgent, paneAgents, type PaneAgent } from "./pane-agents";
import { PaneHeader } from "./pane-header";
import { SPACE } from "./spacing";
import { TicketView } from "./ticket-view";
import { IconButton, Segmented, ToggleChips } from "./ui";

const ARCHIVED_NOTE = "Finished — this agent is archived; its conversation is read-only.";

function roleIcon(agent: PaneAgent): string {
  if (agent.role === "owner") return agent.live ? "Crown" : "UserRound";
  return agent.role === "helper" ? "Wrench" : "ShieldCheck";
}

export function OwnerPane({
  card,
  project,
  theme,
  compact,
  onBack,
  onOpenAgent,
  onChanged,
}: {
  card: Card;
  project: string;
  theme: PluginTheme;
  compact: boolean;
  onBack: () => void;
  onOpenAgent: ((agentId: string) => void) | null;
  onChanged: () => void;
}) {
  const tell = useRpc(tellAgent);
  const [tab, setTab] = useState<"chat" | "ticket">("chat");
  // Remembered with the card it was made on, so opening another ticket starts from its default agent.
  const [chosen, setChosen] = useState<{ card: string; agent: string } | null>(null);
  const agents = useMemo(() => paneAgents(card), [card.owner, card.helpers, card.pastAgents]);
  const chosenId = chosen?.card === card.id ? chosen.agent : null;
  const shown = agents.find((agent) => agent.id === chosenId) ?? defaultPaneAgent(agents) ?? agents[0] ?? null;
  const openByDecisionId = useMemo(() => new Map(card.decisions.map((decision) => [decision.id, decision])), [card.decisions]);
  const inset = compact ? SPACE.md : SPACE.lg;
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
      </PaneHeader>
      <View style={{ paddingHorizontal: inset, paddingVertical: SPACE.sm, gap: SPACE.sm }}>
        <Segmented
          theme={theme}
          value={tab}
          options={[
            { value: "chat", label: "Chat", icon: "MessageSquare" },
            { value: "ticket", label: "Ticket", icon: "ClipboardList" },
          ]}
          onChange={(value: "chat" | "ticket") => setTab(value)}
        />
        {tab === "chat" && agents.length > 1 ? (
          <ToggleChips
            theme={theme}
            selected={shown === null ? [] : [shown.id]}
            options={agents.map((agent) => ({ value: agent.id, label: agent.label, icon: roleIcon(agent) }))}
            onToggle={(agentId) => setChosen({ card: card.id, agent: agentId })}
          />
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        {tab === "ticket" ? (
          <TicketView project={project} ticket={card.id} theme={theme} />
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
            placeholder={`Talk to ${card.id}'s ${shown.role}…`}
            onSend={async (text) => {
              await tell({ agentId: shown.id, text });
            }}
            transformText={withoutDecisionBlocks}
            decorateRow={(text) => {
              const asked = parseDecisionBlocks(text)
                .map((decision) => openByDecisionId.get(decision.id))
                .filter((decision) => decision !== undefined);
              if (asked.length === 0) return null;
              return (
                <View style={{ gap: SPACE.sm }}>
                  {asked.map((decision) => (
                    <DecisionCard key={decision.key} decision={decision} theme={theme} compact={compact} onAnswered={onChanged} />
                  ))}
                </View>
              );
            }}
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
