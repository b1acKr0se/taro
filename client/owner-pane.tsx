/**
 * A task owner beside the board (decision 6): its conversation with decision
 * cards drawn inline, or its ticket, and a way back to the manager.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { tellAgent, type Card } from "../shared/contracts";
import { parseDecisionBlocks, withoutDecisionBlocks } from "../shared/reports";
import { AgentChat } from "./agent-chat";
import { ContextMeter } from "./context-meter";
import { DecisionCard } from "./decision-card";
import { TicketView } from "./ticket-view";
import { IconButton, Segmented } from "./ui";
import { PaneHeader } from "./pane-header";

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
  const owner = card.owner;
  const openByDecisionId = useMemo(() => new Map(card.decisions.map((decision) => [decision.id, decision])), [card.decisions]);
  return (
    <View style={{ flex: 1 }}>
      <PaneHeader theme={theme} title={`${card.id} · ${card.title}`}>
        {owner !== null && onOpenAgent !== null ? <IconButton icon="ExternalLink" label="Open in Paseo" theme={theme} onPress={() => onOpenAgent(owner.id)} /> : null}
        <IconButton icon="ArrowLeft" label="Back to the manager" showLabel={!compact} theme={theme} onPress={onBack} />
      </PaneHeader>
      <View style={{ padding: 8 }}>
        <Segmented
          theme={theme}
          value={tab}
          options={[
            { value: "chat", label: "Chat" },
            { value: "ticket", label: "Ticket" },
          ]}
          onChange={(value: "chat" | "ticket") => setTab(value)}
        />
      </View>
      <View style={{ flex: 1 }}>
        {tab === "ticket" ? (
          <TicketView project={project} ticket={card.id} theme={theme} />
        ) : owner === null ? (
          <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>
            {card.ownerElsewhere !== null ? `Its owner runs on ${card.ownerElsewhere}.` : "No owner is running for this ticket."}
          </Text>
        ) : (
          <AgentChat
            agent={{ id: owner.id, updatedAt: owner.updatedAt, pendingPermissions: owner.pendingPermissions, status: owner.status }}
            theme={theme}
            compact={compact}
            placeholder={`Talk to ${card.id}'s owner…`}
            onSend={async (text) => {
              await tell({ agentId: owner.id, text });
            }}
            transformText={withoutDecisionBlocks}
            decorateRow={(text) => {
              const asked = parseDecisionBlocks(text)
                .map((decision) => openByDecisionId.get(decision.id))
                .filter((decision) => decision !== undefined);
              if (asked.length === 0) return null;
              return (
                <View style={{ gap: 6 }}>
                  {asked.map((decision) => (
                    <DecisionCard key={decision.key} decision={decision} theme={theme} compact={compact} onAnswered={onChanged} />
                  ))}
                </View>
              );
            }}
            actions={<ContextMeter theme={theme} used={owner.contextUsedTokens} max={owner.contextMaxTokens} />}
          />
        )}
      </View>
    </View>
  );
}
