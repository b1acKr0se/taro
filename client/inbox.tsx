/**
 * The Inbox (decision 8): everything waiting on you across projects — open
 * decisions one line each, acceptances, stalled tickets — and Walk me through,
 * which steps through the open decisions one at a time, blocking first
 * (decision 28), from the start or from the line tapped (decision 47).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { listOpenDecisions, type Card, type ProjectSummary } from "../shared/contracts";
import { AlertCard } from "./alert-card";
import { SectionHeading } from "./badges";
import { useBoard, useRefreshBoard } from "./board-data";
import { walkOrder } from "./walk-order";
import { DecisionCard, askedBy } from "./decision-card";
import { KeyboardScrollView } from "./keyboard";
import { paneGutter, SPACE } from "./spacing";
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
  const refetch = () => void decisions.refetch();

  if (walking) {
    const current = ordered[Math.min(step, ordered.length - 1)];
    return (
      <KeyboardScrollView contentContainerStyle={{ paddingVertical: SPACE.lg, paddingHorizontal: paneGutter(compact), gap: SPACE.md, maxWidth: 760, width: "100%", alignSelf: "center" }}>
        <SectionHeading
          theme={theme}
          icon="ListChecks"
          color={colors.accent}
          text={`Walk me through · ${ordered.length === 0 ? "nothing open" : `${Math.min(step, ordered.length - 1) + 1} of ${ordered.length}`}`}
        >
          <IconButton icon="ChevronRight" label="Skip" showLabel theme={theme} disabled={step >= ordered.length - 1} onPress={() => setStep((value) => value + 1)} />
          <IconButton icon="X" label="Done" showLabel theme={theme} onPress={() => setWalking(false)} />
        </SectionHeading>
        {current === undefined ? (
          <Text style={{ color: colors.foregroundMuted }}>Every decision is answered.</Text>
        ) : (
          <DecisionCard key={current.key} decision={current} theme={theme} compact={compact} showAgent onAnswered={refetch} />
        )}
      </KeyboardScrollView>
    );
  }

  return (
    <KeyboardScrollView contentContainerStyle={{ paddingVertical: SPACE.lg, paddingHorizontal: paneGutter(compact), gap: SPACE.lg }}>
      <SectionHeading theme={theme} icon="MessageCircleQuestion" text={`Decisions · ${ordered.length}`} color={ordered.length === 0 ? colors.foregroundMuted : colors.statusWarning}>
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
      </SectionHeading>
      {ordered.length === 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>No open decisions.</Text> : null}
      {/* One line each (decision 47): answering happens one at a time in Walk me through, opened at the line tapped. */}
      {ordered.map((decision, index) => (
        <Pressable
          key={decision.key}
          accessibilityRole="button"
          accessibilityLabel={`Answer: ${decision.question}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: SPACE.sm,
            paddingHorizontal: SPACE.md,
            paddingVertical: SPACE.sm,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: decision.blocking ? colors.statusWarning : colors.border,
            backgroundColor: colors.surface1,
          }}
          onPress={() => {
            setStep(index);
            setWalking(true);
          }}
        >
          <Icon name="Hand" size={13} color={decision.blocking ? colors.statusWarning : colors.foregroundMuted} />
          <View style={{ flex: 1, gap: SPACE.xxs }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }} numberOfLines={1}>
              {askedBy(decision)}
            </Text>
            <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.small }} numberOfLines={2}>
              {decision.question}
            </Text>
          </View>
          <Text style={{ color: colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" }}>Answer →</Text>
        </Pressable>
      ))}
      {projects.map((summary) => (
        <InboxProject key={summary.config.project} summary={summary} theme={theme} compact={compact} onOpenTicket={onOpenTicket} />
      ))}
    </KeyboardScrollView>
  );
}

/** One project's paused ticket sync, alerts (threads, a crashed manager), and tickets that need you (acceptance, blockers) or are stalled; decisions are listed above. */
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
  const alerts = board.data?.alerts ?? [];
  if (waiting.length === 0 && syncProblem === null && alerts.length === 0) return null;
  return (
    <View style={{ gap: SPACE.md }}>
      <SectionHeading theme={theme} icon="FolderKanban" text={project} />
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
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} theme={theme} compact={compact} />
      ))}
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
