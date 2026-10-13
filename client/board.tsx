/**
 * The project's board (decision 9): Needs you · Working · Stalled · Queued ·
 * Done, side by side on a wide screen; on a phone one column at a time behind
 * chips. The manager's own open decisions and suggestions sit above it. Done
 * cards carry their ticket's key stats.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { COLUMN_IDS, COLUMN_TITLES, type ColumnId } from "../shared/board";
import { dismissSuggestion, tellManager, type Card, type ProjectSummary } from "../shared/contracts";
import { AlertCard } from "./alert-card";
import { useBoard, useRefreshBoard } from "./board-data";
import { DecisionCard } from "./decision-card";
import { errorText } from "./format";
import { useStats } from "./queries";
import { SyncProblemCard } from "./sync-problem-card";
import { TicketCard } from "./ticket-card";
import { FONT_SIZE } from "./type-scale";
import { IconButton } from "./ui";

const phoneColumn: { current: ColumnId } = { current: "needs-you" };

/** Columns drawn even when empty; the others appear only with a card in them. */
const ALWAYS_SHOWN: ReadonlySet<ColumnId> = new Set(["needs-you", "working"]);

export function ProjectBoard({
  summary,
  theme,
  compact,
  selectedTicket,
  onOpenTicket,
}: {
  summary: ProjectSummary;
  theme: PluginTheme;
  compact: boolean;
  selectedTicket: string | null;
  onOpenTicket: (card: Card) => void;
}) {
  const project = summary.config.project;
  const board = useBoard(project);
  const stats = useStats(project);
  const refresh = useRefreshBoard(project);
  const toast = useToast();
  const tell = useRpc(tellManager);
  const dismiss = useRpc(dismissSuggestion);
  const [column, setColumn] = useState<ColumnId>(phoneColumn.current);
  const [doneOpen, setDoneOpen] = useState(false);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      root: { flex: 1, minHeight: 0 },
      top: { padding: 10, gap: 8 },
      columns: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 10, padding: 10, alignItems: "flex-start" as const },
      column: { flexGrow: 1, flexBasis: 220, minWidth: 200, maxWidth: 420, gap: 8 },
      columnHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      columnTitle: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "700" as const },
      count: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small },
      empty: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, padding: 6 },
      chips: { flexDirection: "row" as const, gap: 6, paddingHorizontal: 10, paddingTop: 8 },
      chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
      chipActive: { backgroundColor: colors.surface2, borderColor: colors.accent },
      chipText: { color: colors.foreground, fontSize: FONT_SIZE.small },
      suggestions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      suggestion: { flexDirection: "row" as const, alignItems: "center" as const, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingLeft: 10 },
      suggestionText: { color: colors.foreground, fontSize: FONT_SIZE.small, paddingVertical: 6 },
      error: { color: colors.statusDanger, padding: 10 },
      label: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
    }),
    [colors],
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

  const syncProblem = summary.trackerSyncProblem;
  const top = (
    <View style={styles.top}>
      {syncProblem === null ? null : (
        <SyncProblemCard
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
      {(board.data?.alerts ?? []).map((alert) => (
        <AlertCard key={alert.id} alert={alert} theme={theme} compact={compact} />
      ))}
      {(board.data?.managerDecisions ?? []).map((decision) => (
        <DecisionCard key={decision.key} decision={decision} theme={theme} compact={compact} onAnswered={refresh} showAgent />
      ))}
      {(board.data?.suggestions ?? []).length === 0 ? null : (
        <View style={{ gap: 4 }}>
          <Text style={styles.label}>SUGGESTED NEXT</Text>
          <View style={styles.suggestions}>
            {(board.data?.suggestions ?? []).map((suggestion) => (
              <View key={`${suggestion.label}:${suggestion.prompt}`} style={styles.suggestion}>
                <Pressable onPress={() => void tell({ project, text: suggestion.prompt }).then(refresh).catch((caught: unknown) => toast.error(errorText(caught)))}>
                  <Text style={styles.suggestionText}>{suggestion.label}</Text>
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
          {COLUMN_IDS.map((id) => (
            <Pressable
              key={id}
              style={[styles.chip, id === column ? styles.chipActive : null]}
              onPress={() => {
                phoneColumn.current = id;
                setColumn(id);
              }}
            >
              <Text style={styles.chipText}>
                {COLUMN_TITLES[id]} {byColumn.get(id)?.length ?? 0}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 10, gap: 8 }}>
          {top}
          {shown.length === 0 ? <Text style={styles.empty}>Nothing here.</Text> : shown.map(renderCard)}
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root}>
      {top}
      <View style={styles.columns}>
        {COLUMN_IDS.filter((id) => ALWAYS_SHOWN.has(id) || (byColumn.get(id)?.length ?? 0) > 0).map((id) => {
          const group = byColumn.get(id) ?? [];
          const folded = id === "done" && !doneOpen;
          return (
            <View key={id} style={[styles.column, folded ? { flexGrow: 0, flexBasis: 140, minWidth: 140 } : null]}>
              <Pressable style={styles.columnHead} onPress={id === "done" ? () => setDoneOpen((open) => !open) : undefined}>
                <Text style={styles.columnTitle}>{COLUMN_TITLES[id]}</Text>
                <Text style={styles.count}>{group.length}</Text>
                {id === "done" ? <Text style={styles.count}>{doneOpen ? "▾" : "▸"}</Text> : null}
              </Pressable>
              {folded ? null : group.length === 0 ? <Text style={styles.empty}>Nothing here.</Text> : group.map(renderCard)}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
