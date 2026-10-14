/**
 * The project's board (decision 9): Needs you · Working · Stalled · Queued ·
 * Done, always all five, side by side as equal panels on a wide screen; on a
 * phone one column at a time behind chips. The Manager's open questions are cards in Needs you,
 * blocking first, ahead of the tickets, and count there (TR-045); its suggestions sit above its
 * composer, not here. Done cards carry their ticket's key stats.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { COLUMN_IDS, COLUMN_META, COLUMN_TITLES, columnCounts, needsYouExtras, type ColumnId } from "../shared/board";
import type { Card, ProjectSummary } from "../shared/contracts";
import { AlertCard } from "./alert-card";
import { SectionHeading } from "./badges";
import { useBoard, useRefreshBoard } from "./board-data";
import { Pressable } from "./focus";
import { errorText } from "./format";
import { keptObject } from "./kept";
import { KeyboardScrollView } from "./keyboard";
import { QuestionCard } from "./question-card";
import { useStats } from "./queries";
import { paneGutter, SPACE } from "./spacing";
import { SyncProblemCard } from "./sync-problem-card";
import { TicketCard } from "./ticket-card";
import { withAlpha } from "./tint";
import { FONT_SIZE } from "./type-scale";
import { toneColor } from "./visual-meta";
import { walkOrder } from "./walk-order";
import { MIN_COLUMN_WIDTH, columnWidths } from "./column-widths";

/** The column the phone shows, kept across remounts and reconnects (TR-038). */
const phoneColumn = keptObject(globalThis, "board-phone-column", { current: "needs-you" as ColumnId });

export function ProjectBoard({
  summary,
  theme,
  compact,
  selectedTicket,
  onOpenTicket,
  onOpenManager,
}: {
  summary: ProjectSummary;
  theme: PluginTheme;
  compact: boolean;
  selectedTicket: string | null;
  onOpenTicket: (card: Card) => void;
  /** Shows the manager's chat, where its decisions are answered. */
  onOpenManager: () => void;
}) {
  const project = summary.config.project;
  const board = useBoard(project);
  const stats = useStats(project);
  const refresh = useRefreshBoard(project);
  const [column, setColumn] = useState<ColumnId>(phoneColumn.current);
  const [paneWidth, setPaneWidth] = useState(0);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      root: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
      // On a phone the list it sits in already has the padding.
      top: { paddingHorizontal: compact ? 0 : paneGutter(false), paddingTop: compact ? 0 : SPACE.lg, gap: SPACE.md },
      section: { gap: SPACE.sm },
      columns: { flexDirection: "row" as const, gap: SPACE.lg, paddingVertical: SPACE.lg, paddingHorizontal: paneGutter(false), alignItems: "flex-start" as const },
      panel: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: SPACE.md, gap: SPACE.md },
      columnHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, paddingBottom: SPACE.xs },
      columnTitle: { fontSize: FONT_SIZE.body, fontWeight: "700" as const },
      count: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, fontWeight: "600" as const },
      hint: { flex: 1, textAlign: "right" as const, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      empty: { alignItems: "center" as const, gap: SPACE.sm, paddingVertical: SPACE.xl },
      emptyText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small },
      chips: { flexDirection: "row" as const, gap: SPACE.sm, paddingHorizontal: SPACE.md, paddingTop: SPACE.md },
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.sm,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.sm,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      chipText: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "500" as const },
      pill: { minWidth: 20, alignItems: "center" as const, paddingHorizontal: SPACE.xs + 2, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.surface2 },
      pillText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, fontWeight: "700" as const },
      error: { color: colors.statusDanger, padding: SPACE.md },
    }),
    [colors, compact],
  );

  const cards = board.data?.cards ?? [];
  const byColumn = useMemo(() => {
    const groups = new Map<ColumnId, Card[]>(COLUMN_IDS.map((id) => [id, []]));
    for (const card of cards) groups.get(card.column)?.push(card);
    for (const group of groups.values()) group.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
    return groups;
  }, [cards]);

  // The Manager's questions lead Needs you, blocking first (TR-045).
  const managerQuestions = useMemo(() => walkOrder(board.data?.managerDecisions ?? []), [board.data]);
  const syncProblem = summary.trackerSyncProblem;
  const alerts = board.data?.alerts ?? [];
  // Alerts and a paused sync wait on the user too, above the columns (TR-064).
  const counts = columnCounts(cards, needsYouExtras({ managerDecisions: managerQuestions, alerts }, syncProblem !== null));
  const waitingAbove = alerts.length > 0 || syncProblem !== null;

  const statsByTicket = useMemo(() => new Map((stats.data?.tickets ?? []).map((summary) => [summary.ticket, summary])), [stats.data]);

  function renderCard(card: Card) {
    return (
      <TicketCard
        key={card.id}
        card={card}
        project={project}
        theme={theme}
        compact={compact}
        selected={card.id === selectedTicket}
        stats={card.column === "done" ? (statsByTicket.get(card.id) ?? null) : null}
        onOpen={() => onOpenTicket(card)}
        onChanged={refresh}
      />
    );
  }

  /** A column's cards: in Needs you, the Manager's questions first. */
  function columnCards(id: ColumnId, group: readonly Card[]) {
    const questions =
      id === "needs-you"
        ? managerQuestions.map((decision) => (
            <QuestionCard key={decision.key} decision={decision} asker="Manager" theme={theme} compact={compact} onOpen={onOpenManager} onAnswered={refresh} />
          ))
        : [];
    if (questions.length === 0 && group.length === 0) return empty(id, id === "needs-you" && waitingAbove ? "See above" : "Nothing here");
    return [...questions, ...group.map(renderCard)];
  }

  function empty(id: ColumnId, text: string) {
    return (
      <View style={styles.empty}>
        <Icon name={COLUMN_META[id].icon} size={20} color={colors.foregroundMuted} />
        <Text style={styles.emptyText}>{text}</Text>
      </View>
    );
  }

  const top =
    syncProblem === null && alerts.length === 0 ? null : (
      <View style={styles.top}>
        {syncProblem === null ? null : (
          <SyncProblemCard
            startFolded
            project={project}
            problem={syncProblem}
            theme={theme}
            compact={compact}
            onOpenTicket={(ticket) => {
              const card = cards.find((candidate) => candidate.id === ticket);
              if (card !== undefined) onOpenTicket(card);
            }}
          />
        )}
        {alerts.length === 0 ? null : (
          <View style={styles.section}>
            <SectionHeading theme={theme} icon="TriangleAlert" text="Alerts" color={colors.statusWarning} />
            {alerts.map((alert) => (
              <AlertCard key={`${alert.id}:${alert.tickets.join(",")}`} project={project} alert={alert} theme={theme} compact={compact} />
            ))}
          </View>
        )}
      </View>
    );

  if (board.error !== null && board.data === undefined) return <Text style={styles.error}>{errorText(board.error)}</Text>;

  if (compact) {
    const shown = byColumn.get(column) ?? [];
    return (
      <View style={styles.root}>
        <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false}>
          {COLUMN_IDS.map((id) => {
            const active = id === column;
            const color = toneColor(theme, COLUMN_META[id].tone);
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active ? { borderColor: color, backgroundColor: withAlpha(color, 0.14) } : null]}
                onPress={() => {
                  phoneColumn.current = id;
                  setColumn(id);
                }}
              >
                <Icon name={COLUMN_META[id].icon} size={14} color={active ? color : colors.foregroundMuted} />
                <Text style={[styles.chipText, active ? { color } : null]}>{COLUMN_TITLES[id]}</Text>
                <View style={[styles.pill, active ? { backgroundColor: withAlpha(color, 0.25) } : null]}>
                  <Text style={[styles.pillText, active ? { color } : null]}>{counts[id]}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <KeyboardScrollView contentContainerStyle={{ padding: SPACE.md, gap: SPACE.md }}>
          {top}
          {columnCards(column, shown)}
        </KeyboardScrollView>
      </View>
    );
  }

  const widths = columnWidths(
    paneWidth - 2 * SPACE.lg - (COLUMN_IDS.length - 1) * SPACE.md,
    COLUMN_IDS.map((id) => counts[id]),
  );

  return (
    <ScrollView style={styles.root} onLayout={(event) => setPaneWidth(event.nativeEvent.layout.width)}>
      {top}
      <ScrollView horizontal contentContainerStyle={styles.columns}>
        {COLUMN_IDS.map((id, index) => {
          const group = byColumn.get(id) ?? [];
          const columnWidth = widths[index] ?? MIN_COLUMN_WIDTH;
          const meta = COLUMN_META[id];
          const color = toneColor(theme, meta.tone);
          // A column asking for something wears its colour on its frame; quiet ones stay neutral.
          const loud = meta.tone === "warning" || meta.tone === "danger";
          return (
            <View key={id} style={[styles.panel, { width: columnWidth }, loud && counts[id] > 0 ? { borderColor: withAlpha(color, 0.5) } : null]}>
              <View style={styles.columnHead}>
                <Icon name={meta.icon} size={16} color={color} />
                <Text style={[styles.columnTitle, { color: meta.tone === "muted" ? colors.foreground : color }]}>{COLUMN_TITLES[id]}</Text>
                <Text style={styles.count}>{counts[id]}</Text>
                {/* A narrow empty column has room for its title and count only. */}
                {columnWidth < MIN_COLUMN_WIDTH ? null : (
                  <Text style={styles.hint} numberOfLines={1}>
                    {meta.hint}
                  </Text>
                )}
              </View>
              {columnCards(id, group)}
            </View>
          );
        })}
      </ScrollView>
    </ScrollView>
  );
}
