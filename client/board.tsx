/**
 * The project's board (decision 9): Needs you · Working · Stalled · Queued ·
 * Done, always all five, side by side as equal panels on a wide screen; on a
 * phone one column at a time behind chips. The manager's own open decisions sit above it, one line
 * each that opens the manager's chat where they are answered (TR-022), and its suggestions in a card
 * of their own that sends one to the manager when tapped. Done cards carry their ticket's key stats.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { COLUMN_IDS, COLUMN_META, COLUMN_TITLES, type ColumnId } from "../shared/board";
import { dismissSuggestion, tellManager, type Card, type ProjectSummary } from "../shared/contracts";
import { AlertCard } from "./alert-card";
import { SectionHeading } from "./badges";
import { useBoard, useRefreshBoard } from "./board-data";
import { errorText } from "./format";
import { useStats } from "./queries";
import { SPACE } from "./spacing";
import { SyncProblemCard } from "./sync-problem-card";
import { TicketCard } from "./ticket-card";
import { withAlpha } from "./tint";
import { FONT_SIZE } from "./type-scale";
import { IconButton } from "./ui";
import { toneColor } from "./visual-meta";
import { MIN_COLUMN_WIDTH, columnWidths } from "./column-widths";

const phoneColumn: { current: ColumnId } = { current: "needs-you" };

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
  /** Shows the manager's chat, where its decisions are pinned. */
  onOpenManager: () => void;
}) {
  const project = summary.config.project;
  const board = useBoard(project);
  const stats = useStats(project);
  const refresh = useRefreshBoard(project);
  const toast = useToast();
  const tell = useRpc(tellManager);
  const dismiss = useRpc(dismissSuggestion);
  const [column, setColumn] = useState<ColumnId>(phoneColumn.current);
  const [paneWidth, setPaneWidth] = useState(0);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      root: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
      // On a phone the list it sits in already has the padding.
      top: { paddingHorizontal: compact ? 0 : SPACE.lg, paddingTop: compact ? 0 : SPACE.lg, gap: SPACE.md },
      section: { gap: SPACE.sm },
      ask: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.sm,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.sm,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      askText: { flex: 1, color: colors.foreground, fontSize: FONT_SIZE.small },
      askNote: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      askAction: { color: colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      columns: { flexDirection: "row" as const, gap: SPACE.md, padding: SPACE.lg, alignItems: "flex-start" as const },
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
      // Its own tinted card, so it reads as messages to send rather than more of the board.
      suggestionsCard: {
        gap: SPACE.sm,
        padding: SPACE.md,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: withAlpha(colors.accent, 0.35),
        backgroundColor: withAlpha(colors.accent, 0.06),
      },
      suggestionsHint: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      suggestions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm },
      suggestion: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        backgroundColor: colors.surface1,
      },
      suggestionSend: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, paddingLeft: SPACE.md, paddingRight: SPACE.sm, paddingVertical: SPACE.sm },
      suggestionText: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "500" as const },
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

  function empty(id: ColumnId) {
    return (
      <View style={styles.empty}>
        <Icon name={COLUMN_META[id].icon} size={20} color={colors.foregroundMuted} />
        <Text style={styles.emptyText}>Nothing here</Text>
      </View>
    );
  }

  const syncProblem = summary.trackerSyncProblem;
  const alerts = board.data?.alerts ?? [];
  const managerDecisions = board.data?.managerDecisions ?? [];
  const suggestions = board.data?.suggestions ?? [];
  const top =
    syncProblem === null && alerts.length === 0 && managerDecisions.length === 0 && suggestions.length === 0 ? null : (
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
              <AlertCard key={alert.id} alert={alert} theme={theme} compact={compact} />
            ))}
          </View>
        )}
        {managerDecisions.length === 0 ? null : (
          <View style={styles.section}>
            <SectionHeading theme={theme} icon="MessageCircleQuestion" text="The manager asks" color={colors.statusWarning} />
            {managerDecisions.map((decision) => (
              <Pressable
                key={decision.key}
                accessibilityRole="button"
                accessibilityLabel={`Answer the manager: ${decision.question}`}
                style={[styles.ask, decision.blocking ? { borderColor: withAlpha(colors.statusWarning, 0.6) } : null]}
                onPress={onOpenManager}
              >
                <Icon name="Hand" size={13} color={decision.blocking ? colors.statusWarning : colors.foregroundMuted} />
                <Text style={styles.askText} numberOfLines={1}>
                  {decision.question}
                </Text>
                {compact ? null : <Text style={styles.askNote}>{decision.blocking ? "blocking" : "not blocking"}</Text>}
                <Text style={styles.askAction}>Answer →</Text>
              </Pressable>
            ))}
          </View>
        )}
        {suggestions.length === 0 ? null : (
          <View style={styles.suggestionsCard}>
            <SectionHeading theme={theme} icon="Lightbulb" text="Suggested next" color={colors.accent}>
              {compact ? null : <Text style={styles.suggestionsHint}>tap one to send it to the manager</Text>}
            </SectionHeading>
            {compact ? <Text style={styles.suggestionsHint}>Tap one to send it to the manager.</Text> : null}
            <View style={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <View key={`${suggestion.label}:${suggestion.prompt}`} style={styles.suggestion}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Send to the manager: ${suggestion.label}`}
                    style={styles.suggestionSend}
                    onPress={() => void tell({ project, text: suggestion.prompt }).then(refresh).catch((caught: unknown) => toast.error(errorText(caught)))}
                  >
                    <Text style={styles.suggestionText}>{suggestion.label}</Text>
                    <Icon name="Send" size={13} color={colors.accent} />
                  </Pressable>
                  <IconButton icon="X" label={`Dismiss ${suggestion.label}`} theme={theme} onPress={() => void dismiss({ project, label: suggestion.label, prompt: suggestion.prompt }).then(refresh)} />
                </View>
              ))}
            </View>
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
                  <Text style={[styles.pillText, active ? { color } : null]}>{byColumn.get(id)?.length ?? 0}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: SPACE.md, gap: SPACE.md }}>
          {top}
          {shown.length === 0 ? empty(column) : shown.map(renderCard)}
        </ScrollView>
      </View>
    );
  }

  const widths = columnWidths(
    paneWidth - 2 * SPACE.lg - (COLUMN_IDS.length - 1) * SPACE.md,
    COLUMN_IDS.map((id) => byColumn.get(id)?.length ?? 0),
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
            <View key={id} style={[styles.panel, { width: columnWidth }, loud && group.length > 0 ? { borderColor: withAlpha(color, 0.5) } : null]}>
              <View style={styles.columnHead}>
                <Icon name={meta.icon} size={16} color={color} />
                <Text style={[styles.columnTitle, { color: meta.tone === "muted" ? colors.foreground : color }]}>{COLUMN_TITLES[id]}</Text>
                <Text style={styles.count}>{group.length}</Text>
                {/* A narrow empty column has room for its title and count only. */}
                {columnWidth < MIN_COLUMN_WIDTH ? null : (
                  <Text style={styles.hint} numberOfLines={1}>
                    {meta.hint}
                  </Text>
                )}
              </View>
              {group.length === 0 ? empty(id) : group.map(renderCard)}
            </View>
          );
        })}
      </ScrollView>
    </ScrollView>
  );
}
