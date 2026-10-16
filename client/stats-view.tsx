/**
 * A project's Stats tab: a totals row (its Wall the project's span, TR-100), then a row per ticket with its wall
 * time, agent time, time waiting on the user, turns, agents, cost, nudges,
 * decisions, crash recoveries and idle compactions (the totals add the manager's). A cost missing some
 * agents' share is marked, and explained under the table. Tapping a ticket shows its time per status. The table fits a
 * wide pane; on a narrower one it scrolls sideways beside a ticket column that stays put, with a fade on the right while
 * columns lie beyond it and, on a desktop, buttons that page through them (TR-107). On a phone the status sits under the
 * title so the first numbers fit.
 *
 * TR-155: the header row sticks to the top, and tickets come 25 to a page. Nothing is moved back by the scroll offset
 * any more (that trailed the scroll by a frame and shook): on the web the page is one scroll box, sideways and down,
 * whose header row and ticket column the browser pins (CSS sticky); a phone has no sticky, so its ticket column sits
 * beside the sideways scroll and its header row is one of React Native's sticky headers.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Platform,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import type { StatsSummary } from "../shared/contracts";
import { TICKET_STATUSES } from "../shared/project";
import { compareTickets, parentOf, projectTotals, type ProjectTotals } from "../shared/stats";
import { Pressable } from "./focus";
import { errorText, formatCost, formatDuration } from "./format";
import { SectionHeading } from "./badges";
import { useStats } from "./queries";
import { SPACE } from "./spacing";
import { clampPage, pageOffset, pageRange, scrollEdges, STATS_PAGE_SIZE, tableFit, ticketPages, trailingSpace, type ScrollEdges } from "./stats-table";
import { withAlpha } from "./tint";
import { FONT_SIZE, labelLineHeightFor } from "./type-scale";
import { IconButton } from "./ui";

const STATUS_ORDER: readonly string[] = TICKET_STATUSES;

type Counted = Omit<ProjectTotals, "tickets">;

// A two-word header breaks onto two lines, so its column is only as wide as its numbers need.
const NUMBER_COLUMNS: ReadonlyArray<{ key: string; label: string; width: number; value: (counted: Counted) => string }> = [
  { key: "wall", label: "Wall", width: 72, value: (counted) => formatDuration(counted.wallMs) },
  { key: "active", label: "Active", width: 72, value: (counted) => formatDuration(counted.agentActiveMs) },
  { key: "waiting", label: "Waiting\non you", width: 76, value: (counted) => formatDuration(counted.waitingOnUserMs) },
  { key: "turns", label: "Turns", width: 52, value: (counted) => String(counted.turns) },
  { key: "agents", label: "Agents", width: 56, value: (counted) => String(counted.agents) },
  { key: "cost", label: "Cost", width: 84, value: (counted) => costText(counted) },
  { key: "nudges", label: "Nudges", width: 60, value: (counted) => String(counted.nudges) },
  { key: "decisions", label: "Decisions", width: 72, value: (counted) => String(counted.decisions) },
  { key: "recoveries", label: "Recoveries", width: 88, value: (counted) => String(counted.recoveries) },
  { key: "idle-compactions", label: "Idle\ncompactions", width: 100, value: (counted) => String(counted.idleCompactions) },
  { key: "permission-denials", label: "Shell\ndenials", width: 64, value: (counted) => String(counted.permissionDenials) },
];

/** A cost that leaves out agents whose cost could not be recovered carries a mark; none at all reads "—". */
function costText(counted: Counted): string {
  const cost = formatCost(counted.costUsd);
  return counted.costUsd !== null && counted.agentsWithoutCost > 0 ? `${cost} *` : cost;
}

function unknownCostText(agentsWithoutCost: number, agents: number): string {
  return `Cost unknown for ${agentsWithoutCost} of ${agents} agent${agents === 1 ? "" : "s"}`;
}

const NUMBERS_WIDTH = NUMBER_COLUMNS.reduce((total, column) => total + column.width, 0);

/** The table's padding on each side; the ticket column covers the left one, so nothing shows beside it. */
const SIDE = SPACE.lg;
const WEB = Platform.OS === "web";
/** The fade over the right edge while columns lie beyond it: its width and steps (core React Native draws no gradient). */
const FADE_WIDTH = 56;
const FADE_STEPS = 14;
/** The ticket column's shadow once the numbers slide under it. */
const SHADOW_WIDTH = 6;
const SHADOW_STEPS = 3;

/**
 * Rows have fixed heights, so the ticket column and the numbers beside it line up on a phone, where they are
 * laid out apart: a header of two label lines, a ticket row of one line (two on a phone, the status under the title).
 */
const HEADER_LINE = labelLineHeightFor(FONT_SIZE.micro);
const CELL_LINE = labelLineHeightFor(FONT_SIZE.small);
const UNDER_LINE = labelLineHeightFor(FONT_SIZE.caption);
const HEADER_HEIGHT = 2 * HEADER_LINE + 2 * SPACE.sm;
function rowHeight(compact: boolean): number {
  return CELL_LINE + (compact ? UNDER_LINE : 0) + 2 * SPACE.sm;
}

/** Browser-only styles React Native's types do not know: the web's one scroll box and the cells it pins. */
const SCROLL_BOTH_WAYS = { overflowX: "auto", overflowY: "auto" } as unknown as ViewStyle;
function stickyStyle(edges: { top?: number; left?: number; right?: number }): ViewStyle {
  return { position: "sticky", ...edges } as unknown as ViewStyle;
}

/**
 * Where each scrolling column (the status first, on a desktop) starts, as the scroll offset that shows
 * it beside the ticket column with a gap: pages land on these, so no column is sliced at the ticket column's edge.
 */
function columnStartsFor(statusWidth: number): number[] {
  const widths = [statusWidth, ...NUMBER_COLUMNS.map((column) => column.width)].filter((width) => width > 0);
  return widths.map((_, index) => Math.max(widths.slice(0, index).reduce((total, width) => total + width, 0) - SPACE.sm, 0));
}

/** How the table meets a pane `viewport` wide, and its full width, blank space after the last column included. */
function tableLayout(viewport: number, compact: boolean) {
  const statusWidth = compact ? 0 : 120;
  const fit = tableFit({ viewport, side: SIDE, ticketMinWidth: compact ? 150 : 230, rest: statusWidth + NUMBERS_WIDTH });
  const columns = fit.ticketWidth + statusWidth + NUMBERS_WIDTH + 2 * SIDE;
  const columnStarts = columnStartsFor(statusWidth);
  return { fit, statusWidth, columnStarts, pinned: SIDE + fit.ticketWidth, content: columns + trailingSpace({ viewport, content: columns, columnStarts }) };
}

/** A web scroll view's visible width, its vertical scroll bar left out (the layout's width includes it). */
function visibleWidth(scrollView: ScrollView | null, layoutWidth: number): number {
  const node = (scrollView as unknown as { getScrollableNode?: () => { clientWidth?: unknown } | null } | null)?.getScrollableNode?.();
  return typeof node?.clientWidth === "number" && node.clientWidth > 0 ? node.clientWidth : layoutWidth;
}

/** One row of the table, cut where the phone lays it out apart: the ticket cell, and the status and numbers. */
type TableRow =
  | { key: string; kind: "cells"; height: number; ticket: ReactNode; rest: ReactNode; onPress?: () => void; indent: number }
  | { key: string; kind: "detail"; text: string };

export function StatsView({ project, theme, compact }: { project: string; theme: PluginTheme; compact: boolean }) {
  const stats = useStats(project);
  const [open, setOpen] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const { colors } = theme;
  const [viewport, setViewport] = useState(0);
  const { fit, statusWidth, columnStarts, pinned, content } = tableLayout(viewport, compact);
  const ticketWidth = fit.ticketWidth;
  // The web's one scroll box is the page; a phone's page holds the sideways scroll of the numbers.
  const page = useRef<ScrollView>(null);
  const numbersScroll = useRef<ScrollView>(null);
  const offset = useRef({ x: 0, y: 0 });
  const scrollX = useRef(new Animated.Value(0)).current;
  const headerShift = useMemo(() => Animated.multiply(scrollX, -1), [scrollX]);
  const [edges, setEdges] = useState<ScrollEdges>({ moreLeft: false, moreRight: false });
  // A phone's opened row: its words are measured where they span the table, and both halves take their height.
  const [detailHeights, setDetailHeights] = useState<Record<string, number>>({});
  const height = rowHeight(compact);
  const styles = useMemo(
    () => ({
      root: { flex: 1, minHeight: 0 },
      row: { flexDirection: "row" as const, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface0 },
      header: { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, lineHeight: HEADER_LINE, fontWeight: "700" as const },
      cell: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: CELL_LINE, paddingRight: SPACE.sm },
      total: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: CELL_LINE, fontWeight: "700" as const, paddingRight: SPACE.sm },
      title: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: CELL_LINE },
      totalTitle: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: CELL_LINE, fontWeight: "700" as const },
      id: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      under: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: UNDER_LINE },
      detail: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, paddingVertical: SPACE.sm, paddingLeft: SPACE.md },
      note: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, padding: SPACE.lg },
      notes: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg, gap: SPACE.sm },
      footnote: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      pager: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: SPACE.md, padding: SPACE.lg },
      pagerText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small },
      error: { color: colors.statusDanger, padding: SPACE.lg },
    }),
    [colors],
  );

  function showEdges(next: ScrollEdges) {
    setEdges((current) => (current.moreLeft === next.moreLeft && current.moreRight === next.moreRight ? current : next));
  }
  function measured(width: number) {
    setViewport(width);
    // The table's width follows the pane's, so the edges are worked out from the width it is about to take.
    showEdges(scrollEdges({ offset: offset.current.x, viewport: width, content: tableLayout(width, compact).content }));
  }
  // Read through a ref, so the phone's scroll handler, made once, sees the table's latest width.
  const layout = useRef({ viewport, content });
  layout.current = { viewport, content };
  function onScrolled(x: number, y: number) {
    offset.current = { x, y };
    showEdges(scrollEdges({ offset: x, ...layout.current }));
  }
  const onWebScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => onScrolled(event.nativeEvent.contentOffset.x, event.nativeEvent.contentOffset.y);
  const onNumbersScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
        listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => onScrolled(event.nativeEvent.contentOffset.x, 0),
      }),
    [scrollX],
  );
  function pageColumns(direction: -1 | 1) {
    const x = pageOffset({ offset: offset.current.x, viewport, content, pinned, direction, columnStarts });
    if (WEB) page.current?.scrollTo({ x, y: offset.current.y, animated: true });
    else numbersScroll.current?.scrollTo({ x, animated: true });
  }

  const tickets = useMemo(() => [...(stats.data?.tickets ?? [])].sort((left, right) => compareTickets(left.ticket, right.ticket)), [stats.data]);
  const totals = useMemo(() => projectTotals(tickets, stats.data?.managerIdleCompactions ?? 0), [tickets, stats.data]);
  const pages = useMemo(() => ticketPages(tickets.map((summary) => summary.ticket), STATS_PAGE_SIZE), [tickets]);
  const shownPage = clampPage(pageIndex, pages.length);
  const byTicket = useMemo(() => new Map(tickets.map((summary) => [summary.ticket, summary])), [tickets]);

  if (stats.error !== null && stats.data === undefined) return <Text style={styles.error}>{errorText(stats.error)}</Text>;
  if (stats.data === undefined) return <Text style={styles.note}>Loading…</Text>;
  // The manager's idle compactions count before any ticket moves, and show in the totals row.
  if (tickets.length === 0 && totals.idleCompactions === 0) return <Text style={styles.note}>No ticket has been recorded yet. Stats start when a ticket first moves.</Text>;

  function numbers(counted: Counted, style: TextStyle) {
    return NUMBER_COLUMNS.map((column) => (
      <Text key={column.key} style={[style, { width: column.width }]} numberOfLines={1}>
        {column.value(counted)}
      </Text>
    ));
  }

  const ticketsLabel = `${totals.tickets} ticket${totals.tickets === 1 ? "" : "s"}`;

  function ticketRows(summary: StatsSummary): TableRow[] {
    const expanded = open === summary.ticket;
    const byStatus = Object.entries(summary.byStatus)
      .filter(([, ms]) => ms > 0)
      .sort(([left], [right]) => rank(left) - rank(right))
      .map(([status, ms]) => `${status} ${formatDuration(ms)}`)
      .join(" · ");
    const cells: TableRow = {
      key: summary.ticket,
      kind: "cells",
      height,
      indent: parentOf(summary.ticket) !== null ? SPACE.lg : 0,
      onPress: () => setOpen(expanded ? null : summary.ticket),
      ticket: (
        <>
          <Text style={styles.title} numberOfLines={1}>
            <Text style={styles.id}>
              {expanded ? "▾" : "▸"} {summary.ticket}
            </Text>{" "}
            {summary.title}
          </Text>
          {compact ? (
            <Text style={styles.under} numberOfLines={1}>
              {summary.status}
            </Text>
          ) : null}
        </>
      ),
      rest: (
        <>
          {compact ? null : (
            <Text style={[styles.cell, { width: statusWidth }]} numberOfLines={1}>
              {summary.status}
            </Text>
          )}
          {numbers(summary, styles.cell)}
        </>
      ),
    };
    if (!expanded) return [cells];
    const text = [byStatus === "" ? "No time recorded per status." : byStatus, summary.agentsWithoutCost > 0 ? unknownCostText(summary.agentsWithoutCost, summary.agents) : null]
      .filter((part) => part !== null)
      .join(" · ");
    return [cells, { key: `${summary.ticket}-detail`, kind: "detail", text }];
  }

  const rows: TableRow[] = [
    {
      key: "total",
      kind: "cells",
      height,
      indent: 0,
      ticket: (
        <>
          <Text style={styles.totalTitle} numberOfLines={1}>
            Project total
          </Text>
          {compact ? <Text style={styles.under}>{ticketsLabel}</Text> : null}
        </>
      ),
      rest: (
        <>
          {compact ? null : <Text style={[styles.total, { width: statusWidth }]}>{ticketsLabel}</Text>}
          {numbers(totals, styles.total)}
        </>
      ),
    },
    ...(pages[shownPage] ?? []).flatMap((ticket) => {
      const summary = byTicket.get(ticket);
      return summary === undefined ? [] : ticketRows(summary);
    }),
  ];

  const headerCells = (
    <>
      {compact ? null : <Text style={[styles.header, { width: statusWidth }]}>STATUS</Text>}
      {NUMBER_COLUMNS.map((column) => (
        <Text key={column.key} style={[styles.header, { width: column.width }]}>
          {column.label.toUpperCase()}
        </Text>
      ))}
    </>
  );

  /** A ticket-column cell: it covers the table's left padding, with a shadow once the numbers slide under it. */
  function ticketCell(children: ReactNode, cellHeight: number, align: ViewStyle["justifyContent"], indent: number, extra?: ViewStyle) {
    return (
      <View style={[{ width: pinned, height: cellHeight, justifyContent: align, paddingLeft: SIDE + indent, paddingRight: SPACE.sm, paddingVertical: SPACE.sm, backgroundColor: colors.surface0 }, extra]}>
        {children}
        {edges.moreLeft ? (
          <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: SHADOW_WIDTH, flexDirection: "row-reverse" }}>
            {Array.from({ length: SHADOW_STEPS }, (_, step) => (
              <View key={step} style={{ flex: 1, backgroundColor: step === 0 ? colors.border : withAlpha(colors.foreground, 0.06 * (1 - step / SHADOW_STEPS)) }} />
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  function fade(extra: ViewStyle) {
    return (
      <View pointerEvents="none" style={[{ width: FADE_WIDTH, flexDirection: "row" }, extra]}>
        {Array.from({ length: FADE_STEPS }, (_, step) => (
          <View key={step} style={{ flex: 1, backgroundColor: withAlpha(colors.surface0, (step + 1) / FADE_STEPS) }} />
        ))}
      </View>
    );
  }

  const fadeShown = edges.moreRight && !fit.fits;
  // On the web the heading, page bar and notes keep to the visible width while the table scrolls sideways under them.
  const pinToView: ViewStyle | null = WEB && viewport > 0 ? { ...stickyStyle({ left: 0 }), width: viewport } : null;

  const heading = (
    <View style={[{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg, paddingBottom: SPACE.md }, pinToView]}>
      <SectionHeading theme={theme} icon="ChartColumn" text={`Time and cost · ${ticketsLabel}`}>
        {/* A mouse wheel scrolls up and down only, and the sideways scroll bar sits at the foot of a long table. */}
        {compact || fit.fits || viewport === 0 ? null : (
          <View style={{ flexDirection: "row", gap: SPACE.xs }}>
            <IconButton theme={theme} icon="ChevronLeft" label="Earlier columns" disabled={!edges.moreLeft} onPress={() => pageColumns(-1)} />
            <IconButton theme={theme} icon="ChevronRight" label="Later columns" disabled={!edges.moreRight} onPress={() => pageColumns(1)} />
          </View>
        )}
      </SectionHeading>
    </View>
  );

  function showPage(index: number) {
    setPageIndex(index);
    // A new page starts from its first rows.
    if (WEB) page.current?.scrollTo({ x: offset.current.x, y: 0, animated: false });
    else page.current?.scrollTo({ y: 0, animated: false });
  }
  const range = pageRange(pages, shownPage);
  const footer = (
    <View style={pinToView}>
      {pages.length > 1 ? (
        <View style={styles.pager}>
          <IconButton theme={theme} icon="ChevronLeft" label="Previous" showLabel disabled={shownPage === 0} onPress={() => showPage(shownPage - 1)} />
          <Text style={styles.pagerText}>
            {range.first}–{range.last} of {range.total}
          </Text>
          <IconButton theme={theme} icon="ChevronRight" label="Next" showLabel iconAfterLabel disabled={shownPage >= pages.length - 1} onPress={() => showPage(shownPage + 1)} />
        </View>
      ) : null}
      {/* Under the table, so the notes wrap to the screen. */}
      <View style={[styles.notes, pages.length > 1 ? null : { paddingTop: SPACE.lg }]}>
        {totals.agentsWithoutCost > 0 ? (
          <Text style={styles.footnote}>
            * {totals.agentsWithoutCost} agent{totals.agentsWithoutCost === 1 ? " has" : "s have"} no recorded cost: one still at work gets it at its next turn end; one whose session ended without saving it (a crash or a forced stop) never will. A marked cost leaves theirs out.
          </Text>
        ) : null}
        <Text style={styles.footnote}>
          Project total: Wall is the project's elapsed time, from the first ticket filed to the last finished (or now while one is open). Active adds up every agent's working time, so agents working at once can exceed Wall; the manager's is left out. Waiting on you adds up each ticket's time waiting on you (for acceptance, a decision, a permission, or while Blocked), so tickets waiting at once each count.
        </Text>
        <Text style={styles.footnote}>A child ticket's agents, turns, cost and waiting also count on its parent, so the totals add those up once. Idle compactions in the total include the manager's.</Text>
      </View>
    </View>
  );

  const detailWidth = Math.max((fit.fits ? content : viewport) - 2 * SIDE, 0);

  if (WEB) {
    return (
      <ScrollView
        ref={page}
        style={[styles.root, SCROLL_BOTH_WAYS]}
        contentContainerStyle={{ width: viewport > 0 ? content : undefined }}
        onLayout={(event: LayoutChangeEvent) => measured(visibleWidth(page.current, event.nativeEvent.layout.width))}
        onContentSizeChange={() => {
          // A vertical scroll bar that comes or goes as rows change narrows or widens the box without a layout event.
          const width = visibleWidth(page.current, viewport);
          if (width !== viewport) measured(width);
        }}
        onScroll={onWebScroll}
        scrollEventThrottle={16}
      >
        {heading}
        {/* The rows, then a fade as tall as they are, pinned by the browser to the box's right edge. */}
        <View style={{ flexDirection: "row" }}>
          <View style={{ width: content, paddingRight: SIDE }}>
            <View style={[styles.row, { height: HEADER_HEIGHT, alignItems: "flex-end", zIndex: 3 }, stickyStyle({ top: 0 })]}>
              {ticketCell(<Text style={styles.header}>TICKET</Text>, HEADER_HEIGHT - 1, "flex-end", 0, { ...stickyStyle({ left: 0 }), zIndex: 2 })}
              <View style={{ flexDirection: "row", alignItems: "flex-end", paddingBottom: SPACE.sm }}>{headerCells}</View>
            </View>
            {rows.map((row) =>
              row.kind === "detail" ? (
                <View key={row.key} style={styles.row}>
                  <View style={[stickyStyle({ left: 0 }), { width: detailWidth + SIDE, paddingLeft: SIDE }]}>
                    <Text style={[styles.detail, fit.fits ? null : { paddingRight: FADE_WIDTH - SIDE }]}>{row.text}</Text>
                  </View>
                </View>
              ) : (
                <Pressable key={row.key} accessibilityRole={row.onPress ? "button" : undefined} disabled={!row.onPress} style={[styles.row, { alignItems: "center" }]} onPress={row.onPress}>
                  {ticketCell(row.ticket, row.height - 1, "center", row.indent, { ...stickyStyle({ left: 0 }), zIndex: 2 })}
                  {row.rest}
                </Pressable>
              ),
            )}
          </View>
          {fadeShown ? fade({ marginLeft: -FADE_WIDTH, zIndex: 4, ...stickyStyle({ right: 0 }) }) : null}
        </View>
        {footer}
      </ScrollView>
    );
  }

  // A phone: React Native's sticky header holds the header row; its labels follow the numbers' sideways scroll.
  return (
    <ScrollView ref={page} style={styles.root} stickyHeaderIndices={[1]} onLayout={(event: LayoutChangeEvent) => measured(event.nativeEvent.layout.width)}>
      {heading}
      <View style={[styles.row, { height: HEADER_HEIGHT }]}>
        {ticketCell(<Text style={styles.header}>TICKET</Text>, HEADER_HEIGHT - 1, "flex-end", 0, { zIndex: 1 })}
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Animated.View style={{ flexDirection: "row", alignItems: "flex-end", height: HEADER_HEIGHT - 1, paddingBottom: SPACE.sm, transform: [{ translateX: headerShift }] }}>{headerCells}</Animated.View>
          {fadeShown ? fade({ position: "absolute", top: 0, bottom: 0, right: 0 }) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row" }}>
        {/* Above the numbers, so an opened row's words span the table over the blank row beside them. */}
        <View style={{ width: pinned, zIndex: 1 }}>
          {rows.map((row) =>
            row.kind === "detail" ? (
              <View key={row.key} style={[styles.row, { height: (detailHeights[row.key] ?? height) + 1 }]}>
                <View
                  style={{ position: "absolute", top: 0, left: SIDE, width: detailWidth, backgroundColor: colors.surface0 }}
                  onLayout={(event: LayoutChangeEvent) => {
                    const measuredHeight = Math.ceil(event.nativeEvent.layout.height);
                    setDetailHeights((current) => (current[row.key] === measuredHeight ? current : { ...current, [row.key]: measuredHeight }));
                  }}
                >
                  <Text style={[styles.detail, fit.fits ? null : { paddingRight: FADE_WIDTH - SIDE }]}>{row.text}</Text>
                </View>
              </View>
            ) : (
              <Pressable key={row.key} accessibilityRole={row.onPress ? "button" : undefined} disabled={!row.onPress} style={styles.row} onPress={row.onPress}>
                {ticketCell(row.ticket, row.height - 1, "center", row.indent)}
              </Pressable>
            ),
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Animated.ScrollView ref={numbersScroll} horizontal contentContainerStyle={{ width: Math.max(content - pinned, 0), paddingRight: SIDE }} onScroll={onNumbersScroll} scrollEventThrottle={16}>
            <View style={{ flex: 1 }}>
              {rows.map((row) =>
                row.kind === "detail" ? (
                  <View key={row.key} style={[styles.row, { height: (detailHeights[row.key] ?? height) + 1 }]} />
                ) : (
                  <Pressable key={row.key} disabled={!row.onPress} style={[styles.row, { height: row.height, alignItems: "center" }]} onPress={row.onPress}>
                    {row.rest}
                  </Pressable>
                ),
              )}
            </View>
          </Animated.ScrollView>
          {fadeShown ? fade({ position: "absolute", top: 0, bottom: 0, right: 0 }) : null}
        </View>
      </View>
      {footer}
    </ScrollView>
  );
}

/** Statuses in workflow order; anything unknown after them. */
function rank(status: string): number {
  const index = STATUS_ORDER.indexOf(status);
  return index === -1 ? STATUS_ORDER.length : index;
}
