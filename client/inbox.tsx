/**
 * The Inbox (decision 8): everything waiting on you across projects — open
 * decisions as question cards (TR-045), acceptances, stalled tickets — and Walk me through,
 * which steps through the open decisions one at a time, blocking first
 * (decision 28), from the start or from the line tapped (decision 47).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Children, isValidElement, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { listOpenDecisions, type Card, type ProjectSummary } from "../shared/contracts";
import type { StoredDecision } from "../shared/state";
import { AlertCard } from "./alert-card";
import { SectionHeading } from "./badges";
import { useBoard, useRefreshBoard } from "./board-data";
import { walkOrder } from "./walk-order";
import { askedBy, SCOPE_APPROVAL } from "../shared/decision-view";
import { gridCardWidth, gridColumns, gridRows } from "./card-grid";
import { DecisionCard } from "./decision-card";
import { KeyboardScrollView } from "./keyboard";
import { keptObject } from "./kept";
import { PlanDecision } from "./plan-card";
import { QuestionCard } from "./question-card";
import { paneGutter, SPACE } from "./spacing";
import { SyncProblemCard } from "./sync-problem-card";
import { TicketCard } from "./ticket-card";
import { FONT_SIZE } from "./type-scale";
import { IconButton } from "./ui";
import { polled } from "./polling";

/** Between cards in a grid, across and down. */
const GRID_GAP = SPACE.md;

/**
 * Walk me through, kept: View plan on a walked question leaves the Inbox (the host unmounts it), and
 * Back from the plan returns to the same step rather than the list (TR-061).
 */
const walk = keptObject(globalThis, "inbox-walk", { walking: false, step: 0 });

export function Inbox({
  projects,
  theme,
  compact,
  onOpenTicket,
}: {
  projects: readonly ProjectSummary[];
  theme: PluginTheme;
  compact: boolean;
  onOpenTicket: (project: string, card: Pick<Card, "id">) => void;
}) {
  const listDecisions = useRpc(listOpenDecisions);
  const decisions = useQuery({ queryKey: ["taro", "decisions", "all"], queryFn: () => listDecisions({ project: null }), ...polled(4_000) });
  const [walking, setWalkingState] = useState(walk.walking);
  const [step, setStepState] = useState(walk.step);
  const [listWidth, setListWidth] = useState(0);
  const setWalking = (value: boolean) => {
    walk.walking = value;
    setWalkingState(value);
  };
  const setStep = (value: number) => {
    walk.step = value;
    setStepState(value);
  };
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
          <IconButton icon="ChevronRight" label="Skip" showLabel theme={theme} disabled={step >= ordered.length - 1} onPress={() => setStep(step + 1)} />
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
    <KeyboardScrollView
      onLayout={(event) => setListWidth(event.nativeEvent.layout.width - 2 * paneGutter(compact))}
      contentContainerStyle={{ paddingVertical: SPACE.lg, paddingHorizontal: paneGutter(compact), gap: SPACE.lg }}
    >
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
      {/* One card each, in the board's card language (TR-045): an option answers at once; Answer opens Walk me through at that question (decision 47). */}
      {/* A scope approval with a template plan is the compact plan card instead (TR-061). */}
      {/* Plans first, then questions, each kind in its own grid so cards side by side are alike; a plan card beside others is the board's clamped one (TR-105). */}
      {[ordered.filter(isPlanApproval), ordered.filter((decision) => !isPlanApproval(decision))].map((group, kind) => (
        <CardGrid key={kind} width={listWidth}>
          {group.map((decision) => (
            <PlanDecision key={decision.key} decision={decision} theme={theme} compact={compact} head={askedBy(decision)} brief={gridColumns(listWidth, GRID_GAP) > 1} fill onAnswered={refetch}>
              <QuestionCard
                decision={decision}
                asker={askedBy(decision)}
                theme={theme}
                compact={compact}
                fill
                onOpen={() => {
                  setStep(ordered.indexOf(decision));
                  setWalking(true);
                }}
                onAnswered={refetch}
              />
            </PlanDecision>
          ))}
        </CardGrid>
      ))}
      {projects.map((summary) => (
        <InboxProject key={summary.config.project} width={listWidth} summary={summary} theme={theme} compact={compact} onOpenTicket={onOpenTicket} />
      ))}
    </KeyboardScrollView>
  );
}

/** One project's paused ticket sync, alerts (threads, a crashed manager), and tickets that need you (acceptance, blockers) or are stalled; decisions are listed above. */
function InboxProject({
  width,
  summary,
  theme,
  compact,
  onOpenTicket,
}: {
  /** The list's width inside its gutters, for the ticket grid. */
  width: number;
  summary: ProjectSummary;
  theme: PluginTheme;
  compact: boolean;
  onOpenTicket: (project: string, card: Pick<Card, "id">) => void;
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
          onOpenTicket={(ticket) => onOpenTicket(project, { id: ticket })}
        />
      )}
      {alerts.map((alert) => (
        <AlertCard key={`${alert.id}:${alert.tickets.join(",")}`} project={project} alert={alert} theme={theme} compact={compact} />
      ))}
      <CardGrid width={width}>
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
            fill
          />
        ))}
      </CardGrid>
    </View>
  );
}

/** A scope approval, drawn as the plan card (TR-061). */
function isPlanApproval(decision: StoredDecision): boolean {
  return decision.id === SCOPE_APPROVAL && decision.ticket !== null;
}

/**
 * A section's cards side by side, as many as fit at a readable width (TR-105): one on a phone, up
 * to three on a wide desktop. Each row is as tall as its tallest card and every card in it grows to
 * that height, so edges and buttons line up.
 */
function CardGrid({ width, children }: { width: number; children: ReactNode }) {
  // Its own width once measured (the list's can include a scroll bar); the list's until then.
  const [measured, setMeasured] = useState(0);
  const gap = GRID_GAP;
  const columns = gridColumns(measured > 0 ? measured : width, gap);
  const cardWidth = gridCardWidth(measured > 0 ? measured : width, gap, columns);
  const rows = gridRows(Children.toArray(children), columns);
  if (rows.length === 0) return null;
  return (
    <View onLayout={(event) => setMeasured(event.nativeEvent.layout.width)} style={{ gap }}>
      {rows.map((row, index) => (
        <View key={index} style={{ flexDirection: "row", alignItems: "stretch", gap }}>
          {row.map((child) => (
            <View key={isValidElement(child) ? child.key : null} style={columns === 1 ? { flex: 1 } : { width: cardWidth }}>
              {child}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
