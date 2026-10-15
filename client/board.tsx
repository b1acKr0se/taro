/**
 * The project's board (decision 9): Needs you · Working · Stalled · Queued ·
 * Done, always all five, side by side as equal panels on a wide screen; on a
 * phone one column at a time behind chips. Queued and Done show their newest cards, load more on
 * request (TR-082) and fold back to their newest with Show less (TR-117). The manager's open questions are cards in Needs you,
 * blocking first, ahead of the tickets, and count there (TR-045); its suggestions sit above its
 * composer, not here. Done cards carry their ticket's key stats.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { memo, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { boardCounts, COLUMN_IDS, COLUMN_META, COLUMN_TITLES, isPagedColumn, needsYouExtras, type ColumnId, type PagedColumn } from "../shared/board";
import type { Card, ProjectSummary } from "../shared/contracts";
import { AlertCard } from "./alert-card";
import { SectionHeading } from "./badges";
import { useBoard, useLoadMore, useRefreshBoard, useShowLess } from "./board-data";
import { columnPage, foldScrollTarget, type ColumnPage } from "./board-paging";
import { CentredLabel } from "./centred-label";
import { controlColors } from "./control-colors";
import { Pressable } from "./focus";
import { errorText } from "./format";
import { keptObject } from "./kept";
import { useLatestCallback } from "./latest-callback";
import { KeyboardScrollView } from "./keyboard";
import { QuestionCard } from "./question-card";
import { useStats } from "./queries";
import { paneGutter, SPACE } from "./spacing";
import { SyncProblemCard } from "./sync-problem-card";
import { IconButton } from "./ui";
import { PermissionAskCard } from "./permission-ask-card";
import { TicketCard } from "./ticket-card";
import { withAlpha } from "./tint";
import { FONT_SIZE, labelLineHeightFor } from "./type-scale";
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
  onOpenAgent = null,
}: {
  summary: ProjectSummary;
  theme: PluginTheme;
  compact: boolean;
  selectedTicket: string | null;
  /** Opens a ticket by id; the screen fetches its card when it is past its column's page (TR-082). */
  onOpenTicket: (card: Pick<Card, "id">) => void;
  /** Shows the manager's chat, where its decisions are answered. */
  onOpenManager: () => void;
  /** Opens an agent in Paseo: a subagent of the manager's that asks permission (TR-096); null where the host cannot. */
  onOpenAgent?: ((agentId: string) => void) | null;
}) {
  const project = summary.config.project;
  const board = useBoard(project);
  const stats = useStats(project);
  const refresh = useRefreshBoard(project);
  const loadMore = useLoadMore(project);
  const showLess = useShowLess(project);
  // The board's scroller, how far it is scrolled and where the columns start in it, for Show less (TR-117).
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const columnsTop = useRef(0);
  const trackScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  };
  // Folding a long column leaves the reader below it: back up to the column's top, when that went above the view.
  const fold = useLatestCallback(async (id: PagedColumn) => {
    const target = foldScrollTarget(scrollY.current, compact && top === null ? 0 : columnsTop.current);
    await showLess(id);
    if (target !== null) scroller.current?.scrollTo({ y: target, animated: true });
  });
  // Stable, so a card whose ticket did not change is not drawn again on each refresh (TR-069).
  const changed = useLatestCallback(refresh);
  const openCard = useLatestCallback(onOpenTicket);
  const [column, setColumn] = useState<ColumnId>(phoneColumn.current);
  const [paneWidth, setPaneWidth] = useState(0);
  const { colors } = theme;
  const control = useMemo(() => controlColors(colors), [colors]);
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
      // A ScrollView shrinks by default, by its share of the overflow: under a long column (Done) the cards'
      // scroller starts at its whole content height and squeezed the chips shorter, labels off centre (TR-094).
      chipRow: { flexGrow: 0, flexShrink: 0 },
      chips: { flexDirection: "row" as const, gap: SPACE.sm, paddingHorizontal: SPACE.md, paddingTop: SPACE.md },
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.sm,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.sm,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: control.border,
        backgroundColor: control.fill,
      },
      chipText: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: labelLineHeightFor(FONT_SIZE.small), fontWeight: "500" as const },
      pill: { minWidth: 20, alignItems: "center" as const, paddingHorizontal: SPACE.xs + 2, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.surface2 },
      pillText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, lineHeight: labelLineHeightFor(FONT_SIZE.micro), fontWeight: "700" as const },
      error: { color: colors.statusDanger, padding: SPACE.md },
    }),
    [colors, control, compact],
  );

  const cards = board.data?.cards ?? [];
  const byColumn = useMemo(() => {
    const content = board.data ?? { cards: [], totals: { "needs-you": 0, working: 0, stalled: 0, queued: 0, done: 0 }, offPage: [] };
    return new Map<ColumnId, ColumnPage>(COLUMN_IDS.map((id) => [id, columnPage(content, id)]));
  }, [board.data?.cards, board.data?.totals, board.data?.offPage]);

  // The manager's questions lead Needs you, blocking first (TR-045).
  const managerQuestions = useMemo(() => walkOrder(board.data?.managerDecisions ?? []), [board.data]);
  const managerAsk = board.data?.managerPermission ?? null;
  // The manager's own requests are answered in its chat; a subagent of its own has a chat only in Paseo.
  const openManagerAsk = useLatestCallback(() =>
    managerAsk !== null && managerAsk.role !== "manager" && managerAsk.agentId !== null && onOpenAgent !== null ? onOpenAgent(managerAsk.agentId) : onOpenManager(),
  );
  const syncProblem = summary.trackerSyncProblem;
  const alerts = board.data?.alerts ?? [];
  // Alerts and a paused sync wait on the user too, above the columns (TR-064).
  // True totals: a paged column carries only its loaded cards (TR-082).
  const counts = boardCounts(board.data?.totals ?? { "needs-you": 0, working: 0, stalled: 0, queued: 0, done: 0 }, needsYouExtras({ managerDecisions: managerQuestions, managerPermission: managerAsk, alerts }, syncProblem !== null));
  const waitingAbove = alerts.length > 0 || syncProblem !== null;

  const statsByTicket = useMemo(() => new Map((stats.data?.tickets ?? []).map((summary) => [summary.ticket, summary])), [stats.data]);

  function renderCard(card: Card) {
    return (
      <BoardCard
        key={card.id}
        card={card}
        project={project}
        theme={theme}
        compact={compact}
        selected={card.id === selectedTicket}
        stats={card.column === "done" ? (statsByTicket.get(card.id) ?? null) : null}
        onOpenCard={openCard}
        onChanged={changed}
      />
    );
  }

  /** A column's cards: in Needs you, the manager's side first (a permission, which holds it up, then its questions); a paged column ends with Load more while cards are left and Show less past its first page. */
  function columnCards(id: ColumnId, page: ColumnPage | undefined) {
    const group = page?.cards ?? [];
    const questions =
      id === "needs-you"
        ? [
            ...(managerAsk === null ? [] : [<PermissionAskCard key="manager-permission" ask={managerAsk} theme={theme} compact={compact} onOpen={openManagerAsk} />]),
            ...managerQuestions.map((decision) => (
              <QuestionCard key={decision.key} decision={decision} asker="The manager" theme={theme} compact={compact} onOpen={onOpenManager} onAnswered={changed} />
            )),
          ]
        : [];
    if (questions.length === 0 && group.length === 0) return empty(id, id === "needs-you" && waitingAbove ? "See above" : "Nothing here");
    const end =
      page !== undefined && (page.remaining > 0 || page.foldable) && isPagedColumn(id) ? (
        <ColumnEnd
          key="column-end"
          column={id}
          shown={group.length}
          total={page.total}
          canLoadMore={page.remaining > 0}
          canShowLess={page.foldable}
          theme={theme}
          onLoadMore={loadMore}
          onShowLess={fold}
        />
      ) : null;
    return [...questions, ...group.map(renderCard), end];
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
      <View
        style={styles.top}
        // On a phone the column starts under the alerts.
        onLayout={compact ? (event) => (columnsTop.current = event.nativeEvent.layout.y + event.nativeEvent.layout.height) : undefined}
      >
        {syncProblem === null ? null : (
          <SyncProblemCard
            startFolded
            project={project}
            problem={syncProblem}
            theme={theme}
            compact={compact}
            onOpenTicket={(ticket) => onOpenTicket({ id: ticket })}
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
    const shown = byColumn.get(column);
    return (
      <View style={styles.root}>
        <ScrollView horizontal style={styles.chipRow} contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false}>
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
                <CentredLabel style={[styles.chipText, active ? { color } : null]}>{COLUMN_TITLES[id]}</CentredLabel>
                <View style={[styles.pill, active ? { backgroundColor: withAlpha(color, 0.25) } : null]}>
                  <CentredLabel style={[styles.pillText, active ? { color } : null]}>{counts[id]}</CentredLabel>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <KeyboardScrollView scrollerRef={scroller} onScroll={trackScroll} contentContainerStyle={{ padding: SPACE.md, gap: SPACE.md }}>
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
    <ScrollView
      ref={scroller}
      style={styles.root}
      scrollEventThrottle={100}
      onScroll={trackScroll}
      onLayout={(event) => setPaneWidth(event.nativeEvent.layout.width)}
    >
      {top}
      <ScrollView horizontal contentContainerStyle={styles.columns} onLayout={(event) => (columnsTop.current = event.nativeEvent.layout.y)}>
        {COLUMN_IDS.map((id, index) => {
          const group = byColumn.get(id);
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

/** A ticket's card on the board, drawn again only when its ticket, stats or selection changed (TR-069). */
const BoardCard = memo(function BoardCard({ card, onOpenCard, ...rest }: Omit<Parameters<typeof TicketCard>[0], "onOpen"> & { onOpenCard: (card: Card) => void }) {
  return <TicketCard card={card} onOpen={() => onOpenCard(card)} {...rest} />;
});

/** The narrowest Load more or Show less keeps its label on one line beside the other. */
const SHARE_MIN_WIDTH = 116;

/**
 * The end of a paged column (TR-082): how many are shown of how many, Load more while cards are left,
 * and Show less once it shows more than its first page (TR-117). One call at a time.
 */
function ColumnEnd({
  column,
  shown,
  total,
  canLoadMore,
  canShowLess,
  theme,
  onLoadMore,
  onShowLess,
}: {
  column: PagedColumn;
  shown: number;
  total: number;
  canLoadMore: boolean;
  canShowLess: boolean;
  theme: PluginTheme;
  onLoadMore: (column: PagedColumn) => Promise<void>;
  onShowLess: (column: PagedColumn) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"more" | "less" | null>(null);
  const run = (which: "more" | "less", call: (column: PagedColumn) => Promise<void>) => {
    setBusy(which);
    void call(column).finally(() => setBusy(null));
  };
  // Load more and Show less take equal halves, whatever their labels' widths; in a narrow column they stack.
  const equalShare = { flexGrow: 1, flexShrink: 1, flexBasis: SHARE_MIN_WIDTH, flexDirection: "row" as const };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.md }}>
      <View style={{ flexGrow: 1, flexShrink: 1, flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm }}>
        {canLoadMore ? (
          <View style={equalShare}>
            <IconButton
              icon="ChevronsDown"
              label="Load more"
              showLabel
              grow
              theme={theme}
              disabled={busy !== null}
              state={busy === "more" ? "busy" : undefined}
              onPress={() => run("more", onLoadMore)}
            />
          </View>
        ) : null}
        {canShowLess ? (
          <View style={equalShare}>
            <IconButton
              icon="ChevronsUp"
              label="Show less"
              showLabel
              grow
              theme={theme}
              disabled={busy !== null}
              state={busy === "less" ? "busy" : undefined}
              onPress={() => run("less", onShowLess)}
            />
          </View>
        ) : null}
      </View>
      {/* The count keeps its one line; the buttons stack instead. */}
      <Text style={{ flexShrink: 0, color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small }}>
        {shown} of {total}
      </Text>
    </View>
  );
}
