/**
 * The Inbox (decision 8): everything waiting on you across projects — open
 * decisions, acceptances, stalled tickets — and Walk me through, which steps
 * through the open decisions one at a time, blocking first (decision 28).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { listOpenDecisions, type Card, type ProjectSummary } from "../shared/contracts";
import { useBoard, useRefreshBoard } from "./board-data";
import { walkOrder } from "./walk-order";
import { DecisionCard } from "./decision-card";
import { SyncProblemCard } from "./sync-problem-card";
import { TicketCard } from "./ticket-card";
import { FONT_SIZE } from "./type-scale";
import { IconButton } from "./ui";

export function Inbox({
  projects,
  theme,
  compact,
  onOpenTicket,
}: {
  projects: readonly ProjectSummary[];
  theme: PluginTheme;
  compact: boolean;
  onOpenTicket: (project: string, card: Card) => void;
}) {
  const listDecisions = useRpc(listOpenDecisions);
  const decisions = useQuery({ queryKey: ["taro", "decisions", "all"], queryFn: () => listDecisions({ project: null }), refetchInterval: 4_000 });
  const [walking, setWalking] = useState(false);
  const [step, setStep] = useState(0);
  const ordered = useMemo(() => walkOrder(decisions.data?.decisions ?? []), [decisions.data]);
  const { colors } = theme;
  const heading = { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "700" as const, letterSpacing: 0.5 };
  const refetch = () => void decisions.refetch();

  if (walking) {
    const current = ordered[Math.min(step, ordered.length - 1)];
    return (
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 14, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[heading, { flex: 1 }]}>
            WALK ME THROUGH · {ordered.length === 0 ? "nothing open" : `${Math.min(step, ordered.length - 1) + 1} of ${ordered.length}`}
          </Text>
          <IconButton icon="ChevronRight" label="Skip" showLabel theme={theme} disabled={step >= ordered.length - 1} onPress={() => setStep((value) => value + 1)} />
          <IconButton icon="X" label="Done" showLabel theme={theme} onPress={() => setWalking(false)} />
        </View>
        {current === undefined ? (
          <Text style={{ color: colors.foregroundMuted }}>Every decision is answered.</Text>
        ) : (
          <DecisionCard key={current.key} decision={current} theme={theme} compact={compact} showAgent onAnswered={refetch} />
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={[heading, { flex: 1 }]}>DECISIONS · {ordered.length}</Text>
        <IconButton
          icon="ListChecks"
          label="Walk me through"
          showLabel
          tone="accent"
          theme={theme}
          disabled={ordered.length === 0}
          onPress={() => {
            setStep(0);
            setWalking(true);
          }}
        />
      </View>
      {ordered.length === 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>No open decisions.</Text> : null}
      {ordered.map((decision) => (
        <DecisionCard key={decision.key} decision={decision} theme={theme} compact={compact} showAgent onAnswered={refetch} />
      ))}
      {projects.map((summary) => (
        <InboxProject key={summary.config.project} summary={summary} theme={theme} compact={compact} onOpenTicket={onOpenTicket} />
      ))}
    </ScrollView>
  );
}

/** One project's paused ticket sync and tickets that need you (acceptance, blockers) or are stalled; decisions are listed above. */
function InboxProject({
  summary,
  theme,
  compact,
  onOpenTicket,
}: {
  summary: ProjectSummary;
  theme: PluginTheme;
  compact: boolean;
  onOpenTicket: (project: string, card: Card) => void;
}) {
  const project = summary.config.project;
  const board = useBoard(project);
  const refresh = useRefreshBoard(project);
  const cards = board.data?.cards ?? [];
  const waiting = cards.filter((card) => (card.column === "needs-you" && card.decisions.length === 0) || card.column === "stalled");
  const syncProblem = summary.trackerSyncProblem;
  if (waiting.length === 0 && syncProblem === null) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "700" }}>{project.toUpperCase()}</Text>
      {syncProblem === null ? null : (
        <SyncProblemCard
          project={project}
          problem={syncProblem}
          theme={theme}
          compact={compact}
          onOpenTicket={(ticket) => {
            const card = cards.find((candidate) => candidate.id === ticket);
            if (card !== undefined) onOpenTicket(project, card);
          }}
        />
      )}
      {waiting.map((card) => (
        <TicketCard
          key={card.id}
          card={{ ...card, decisions: [] }}
          project={project}
          theme={theme}
          compact={compact}
          selected={false}
          onOpen={() => onOpenTicket(project, card)}
          onChanged={refresh}
        />
      ))}
    </View>
  );
}
