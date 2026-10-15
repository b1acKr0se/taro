/**
 * The ticket beside a Taro agent's own tab (spec §6): its open decisions and
 * the ticket. Elsewhere it says the agent is not one of Taro's. The ticket's scope
 * approval is answered in its Ticket view (TR-061), template plan or not, so it
 * has no card of its own here.
 */
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

import { findAgentTicket, listOpenDecisions } from "../shared/contracts";
import { answeredInPlan } from "../shared/decision-view";
import { DecisionCard } from "./decision-card";
import { KeyboardScrollView } from "./keyboard";
import { TicketView } from "./ticket-view";
import { FONT_SIZE } from "./type-scale";
import { polled } from "./polling";

export function TicketPanel({ agentId, theme, layout }: PluginAgentPanelProps) {
  const find = useRpc(findAgentTicket);
  const listDecisions = useRpc(listOpenDecisions);
  const identity = useQuery({ queryKey: ["taro", "agent", agentId], queryFn: () => find({ agentId }) });
  const project = identity.data?.project ?? null;
  const ticket = identity.data?.ticket ?? null;
  const decisions = useQuery({
    queryKey: ["taro", "decisions", project],
    queryFn: () => listDecisions({ project }),
    enabled: project !== null,
    ...polled(4_000),
  });
  const muted = { color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small, padding: 14 };
  if (identity.isLoading) return <Text style={muted}>Looking this agent up…</Text>;
  if (project === null) return <Text style={muted}>This agent is not one of Taro's.</Text>;
  const mine = (decisions.data?.decisions ?? []).filter((decision) => decision.agentId === agentId && !answeredInPlan(decision, ticket));
  return (
    <View style={{ flex: 1 }}>
      {mine.length === 0 ? null : (
        <KeyboardScrollView style={{ maxHeight: "50%" }} contentContainerStyle={{ padding: 10, gap: 8 }}>
          {mine.map((decision) => (
            <DecisionCard key={decision.key} decision={decision} theme={theme} compact={layout.compact} onAnswered={() => void decisions.refetch()} />
          ))}
        </KeyboardScrollView>
      )}
      {ticket === null ? (
        <Text style={muted}>
          {identity.data?.role === "manager" ? `The ${project} manager. Its tickets are on the Taro board.` : "No ticket is recorded for this agent."}
        </Text>
      ) : (
        <TicketView project={project} ticket={ticket} theme={theme} answeredFrom="tab" />
      )}
    </View>
  );
}
