/**
 * A ticket beside the board (decision 6): the conversation of one of its
 * agents — the live owner, a subagent, or an archived agent read-only — or its
 * ticket, and a way back to the manager. Nothing is pinned above the chat (TR-026):
 * each open decision is a card under the message that asked it, and a delivered
 * ticket's Accept / Request changes sit in a row at the composer.
 * With the board hidden the ticket sits in its own panel beside, so the pane is the chat alone.
 * Opened by View plan (TR-061) it shows the Ticket tab, its Plan on top, and Back returns to where
 * View plan was pressed.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { tellAgent, type Card } from "../shared/contracts";
import { decisionBlocksAsText, withoutDecisionBlocks } from "../shared/reports";
import { AgentChat } from "./agent-chat";
import { AcceptanceCard } from "./acceptance-card";
import { acceptanceReady } from "./card-calls";
import { Pressable } from "./focus";
import { defaultPaneAgent, paneAgents, paneAgentJob, roleIcon } from "./pane-agents";
import { PaneHeader } from "./pane-header";
import { paneGutter, SPACE } from "./spacing";
import { TicketView } from "./ticket-view";
import { FONT_SIZE } from "./type-scale";
import { IconButton, Segmented } from "./ui";
import { AgentChips } from "./agent-chips";
import { KeptPane, useVisited } from "./kept-pane";
import { useNow } from "./use-now";

const ARCHIVED_NOTE = "Finished — this agent is archived; its conversation is read-only.";

export function OwnerPane({
  card,
  project,
  theme,
  compact,
  ticketBeside,
  backTo,
  planOpen = false,
  onBack,
  onLeavePlan = () => undefined,
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
  /** Where Back returns, as named on its button on a wide screen and read out on a phone: "Board" (TR-065). */
  backTo: string;
  /** Opened by View plan: the Ticket tab shows, and Back returns to where it was pressed. */
  planOpen?: boolean;
  onBack: () => void;
  /** The user switched from the plan to the chat. */
  onLeavePlan?: () => void;
  onOpenAgent: ((agentId: string) => void) | null;
  onChanged: () => void;
  /** Brings the hidden board back; null while it shows. */
  onShowBoard: (() => void) | null;
}) {
  const tell = useRpc(tellAgent);
  // Kept with the card it was chosen on: opening another ticket (its Answer → or Review →) starts on Chat, where its asks are answered.
  const [chosenTab, setTab] = useState<{ card: string; tab: "chat" | "ticket" } | null>(null);
  const tab = ticketBeside ? "chat" : planOpen ? "ticket" : chosenTab?.card !== card.id ? "chat" : chosenTab.tab;
  // Chat and Ticket stay mounted once shown for this card, so switching between them draws nothing new (TR-069).
  const tabsVisited = useVisited(`${card.id}:${tab}`);
  // Back from a plan returns to wherever View plan was pressed, which it does not name.
  const backLabel = planOpen ? "Back" : `Back to ${backTo}`;
  // Remembered with the card it was made on, so opening another ticket starts from its default agent.
  const [chosen, setChosen] = useState<{ card: string; agent: string } | null>(null);
  const agents = useMemo(() => paneAgents(card), [card.owner, card.subagents, card.pastAgents]);
  const now = useNow();
  const chosenId = chosen?.card === card.id ? chosen.agent : null;
  const shown = agents.find((agent) => agent.id === chosenId) ?? defaultPaneAgent(agents) ?? agents[0] ?? null;
  const inset = paneGutter(compact);
  // Once accepted the owner is merging: nothing is left to accept (TR-031).
  const accepting = card.status === "Awaiting acceptance" && card.owner !== null && card.accepted === null;
  const shownAsks = useMemo(() => card.decisions.filter((decision) => decision.agentId === shown?.id), [card.decisions, shown?.id]);
  // A question another of the ticket's agents asked is answered in that agent's chat.
  const askedElsewhere = card.decisions.find((decision) => decision.agentId !== shown?.id && agents.some((agent) => agent.id === decision.agentId));
  const askedElsewhereBy = askedElsewhere === undefined ? undefined : agents.find((agent) => agent.id === askedElsewhere.agentId);
  const tabSwitch = (iconsOnly: boolean) => (
    <Segmented
      theme={theme}
      value={tab}
      iconsOnly={iconsOnly}
      options={[
        { value: "chat", label: "Chat", icon: "MessageSquare" },
        { value: "ticket", label: "Ticket", icon: "ClipboardList" },
      ]}
      onChange={(value: "chat" | "ticket") => {
        if (planOpen && value === "chat") onLeavePlan();
        setTab({ card: card.id, tab: value });
      }}
    />
  );
  return (
    <View style={{ flex: 1 }}>
      {/* On a phone one row holds Back, who it is, Chat / Ticket and Open: the chat keeps the screen (TR-031). */}
      <PaneHeader
        theme={theme}
        title={`${card.id} · ${card.title}`}
        subtitle={shown === null ? undefined : `${shown.label} · ${shown.live ? shown.brief.status : "archived"}`}
        icon={shown === null ? "Bot" : roleIcon(shown)}
        compact={compact}
        // An arrow alone on a phone, the size of Open beside it, so the title keeps the row (TR-077); its target is still read out.
        leading={compact ? <IconButton icon="ArrowLeft" label={backLabel} theme={theme} onPress={onBack} /> : undefined}
      >
        {compact && !ticketBeside ? tabSwitch(true) : null}
        {shown !== null && onOpenAgent !== null ? <IconButton icon="ExternalLink" label="Open in Paseo" theme={theme} onPress={() => onOpenAgent(shown.id)} /> : null}
        {compact ? null : <IconButton icon="ArrowLeft" label={backLabel} showLabel theme={theme} onPress={onBack} />}
        {onShowBoard === null ? null : <IconButton icon="PanelRightOpen" label="Show the board" theme={theme} onPress={onShowBoard} />}
      </PaneHeader>
      {/* Nothing to show here (a phone, one agent) takes no height at all. */}
      {!(ticketBeside || compact) || (tab === "chat" && (agents.length > 1 || (shown !== null && card.owner === null && card.ownerElsewhere !== null))) ? (
      <View style={{ paddingHorizontal: inset, paddingVertical: compact ? SPACE.xs : SPACE.sm, gap: SPACE.sm }}>
        {ticketBeside || compact ? null : tabSwitch(false)}
        {/* Archived agents here do not mean the work stopped: the current owner may run elsewhere. */}
        {tab === "chat" && shown !== null && card.owner === null && card.ownerElsewhere !== null ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small }}>Its current owner runs on {card.ownerElsewhere}.</Text>
        ) : null}
        {tab === "chat" && agents.length > 1 ? (
          <AgentChips theme={theme} slim={compact} agents={agents} selectedId={shown?.id ?? null} now={now} onSelect={(agentId) => setChosen({ card: card.id, agent: agentId })} />
        ) : null}
      </View>
      ) : null}
      <View style={{ flex: 1 }}>
        {tabsVisited.has(`${card.id}:ticket`) ? (
          <KeptPane key={`ticket:${card.id}`} shown={tab === "ticket"}>
            <TicketView project={project} ticket={card.id} theme={theme} />
          </KeptPane>
        ) : null}
        {!tabsVisited.has(`${card.id}:chat`) ? null : (
          <KeptPane key={`chat:${card.id}`} shown={tab === "chat"}>
            {shown === null ? (
              <Text style={{ color: theme.colors.foregroundMuted, padding: SPACE.lg }}>
                {card.ownerElsewhere !== null ? `Its owner runs on ${card.ownerElsewhere}.` : "No owner is running for this ticket."}
              </Text>
            ) : shown.live ? (
              <AgentChat
                key={shown.id}
                asker={{ kind: "ticket", ticket: card.id, role: shown.role }}
                agent={{ id: shown.id, updatedAt: shown.brief.updatedAt, pendingPermissions: shown.brief.pendingPermissions, status: shown.brief.status, steers: shown.brief.steers }}
                theme={theme}
                compact={compact}
                placeholder={`Talk to ${card.id}'s ${paneAgentJob(shown.role)}…`}
                onSend={async (text, attachments, messageId) => {
                  await tell({ agentId: shown.id, text, ...attachments, messageId });
                }}
                transformText={withoutDecisionBlocks}
                asks={{ decisions: shownAsks, onAnswered: onChanged }}
                delivery={
                  accepting && shown.id === card.owner?.id
                    ? {
                        card: <AcceptanceCard card={card} project={project} theme={theme} compact={compact} onChanged={onChanged} />,
                        label: acceptanceReady(card) ? `${card.id} is ready to accept` : `${card.id} is not ready to accept`,
                        ready: acceptanceReady(card),
                      }
                    : undefined
                }
                context={{ used: shown.brief.contextUsedTokens, max: shown.brief.contextMaxTokens }}
                actions={
                  askedElsewhere === undefined || askedElsewhereBy === undefined ? undefined : (
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
                  )
                }
              />
            ) : (
              <AgentChat
                key={shown.id}
                asker={{ kind: "ticket", ticket: card.id, role: shown.role }}
                agent={{ id: shown.id, updatedAt: shown.brief.updatedAt, pendingPermissions: 0, status: shown.brief.status }}
                theme={theme}
                compact={compact}
                // No cards for a finished agent's questions: each block reads as a quote of what it asked.
                transformText={decisionBlocksAsText}
                readOnly={{ note: ARCHIVED_NOTE }}
              />
            )}
          </KeptPane>
        )}
      </View>
    </View>
  );
}
