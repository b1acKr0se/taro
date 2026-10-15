/**
 * A project's Stats tab: a totals row (its Wall the project's span, TR-100), then a row per ticket with its wall
 * time, agent time, time waiting on the user, turns, agents, cost, nudges,
 * decisions, crash recoveries and idle compactions (the totals add the manager's). A cost missing some
 * agents' share is marked, and explained under the table. Tapping a ticket shows its time per status. The table fits a
 * wide pane; on a narrower one it scrolls sideways under a pinned ticket column, with a fade on the right while columns
 * lie beyond it and, on a desktop, buttons that page through them (TR-107). On a phone the status sits under the title
 * so the first numbers fit.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, ScrollView, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ViewStyle } from "react-native";

import { TICKET_STATUSES } from "../shared/project";
import { compareTickets, parentOf, projectTotals, type ProjectTotals } from "../shared/stats";
import { Pressable } from "./focus";
import { errorText, formatCost, formatDuration } from "./format";
import { SectionHeading } from "./badges";
import { useStats } from "./queries";
import { SPACE } from "./spacing";
import { pageOffset, scrollEdges, tableFit, trailingSpace, type ScrollEdges } from "./stats-table";
import { withAlpha } from "./tint";
import { FONT_SIZE } from "./type-scale";
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

/** The table's padding on each side; the pinned column covers the left one, so nothing shows beside it. */
const SIDE = SPACE.lg;
const NATIVE_DRIVER = Platform.OS !== "web";
/** The fade over the right edge while columns lie beyond it: its width and steps (core React Native draws no gradient). */
const FADE_WIDTH = 56;
const FADE_STEPS = 14;
/** The pinned column's shadow once the numbers slide under it, and how far they slide before it shows in full. */
const SHADOW_WIDTH = 6;
const SHADOW_STEPS = 3;
const SHADOW_IN = 8;

/**
 * Where each scrolling column (the status first, on a desktop) starts, as the scroll offset that shows
 * it beside the pinned column with a gap: pages land on these, so no column is sliced at the pinned edge.
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
  return { fit, statusWidth, columnStarts, content: columns + trailingSpace({ viewport, content: columns, columnStarts }) };
}

export function StatsView({ project, theme, compact }: { project: string; theme: PluginTheme; compact: boolean }) {
  const stats = useStats(project);
  const [open, setOpen] = useState<string | null>(null);
  const { colors } = theme;
  const [viewport, setViewport] = useState(0);
  const { fit, statusWidth, columnStarts, content } = tableLayout(viewport, compact);
  const ticketWidth = fit.ticketWidth;
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [edges, setEdges] = useState<ScrollEdges>({ moreLeft: false, moreRight: false });
  const styles = useMemo(
    () => ({
      root: { flex: 1, minHeight: 0 },
      table: { width: content, paddingHorizontal: SIDE, paddingBottom: SPACE.lg, paddingTop: SPACE.md },
      // Cells carry the vertical padding, so the pinned cell covers the row's full height.
      row: { flexDirection: "row" as const, alignItems: "center" as const, borderBottomWidth: 1, borderBottomColor: colors.border },
      headerRow: { flexDirection: "row" as const, alignItems: "flex-end" as const, borderBottomWidth: 1, borderBottomColor: colors.border },
      header: { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, paddingVertical: SPACE.sm },
      cell: { color: colors.foreground, fontSize: FONT_SIZE.small, paddingRight: SPACE.sm, paddingVertical: SPACE.sm },
      total: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "700" as const, paddingRight: SPACE.sm, paddingVertical: SPACE.sm },
      title: { color: colors.foreground, fontSize: FONT_SIZE.small },
      totalTitle: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "700" as const },
      id: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      under: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      detail: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, paddingVertical: SPACE.sm, paddingLeft: SPACE.md, borderBottomWidth: 1, borderBottomColor: colors.border },
      note: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, padding: SPACE.lg },
      notes: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg, gap: SPACE.sm },
      footnote: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      error: { color: colors.statusDanger, padding: SPACE.lg },
    }),
    [colors, content],
  );

  function showEdges(next: ScrollEdges) {
    setEdges((current) => (current.moreLeft === next.moreLeft && current.moreRight === next.moreRight ? current : next));
  }
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: NATIVE_DRIVER,
        listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
          offset.current = event.nativeEvent.contentOffset.x;
          showEdges(scrollEdges({ offset: offset.current, viewport: event.nativeEvent.layoutMeasurement.width, content: event.nativeEvent.contentSize.width }));
        },
      }),
    [scrollX],
  );
  function onLayout(event: LayoutChangeEvent) {
    const width = event.nativeEvent.layout.width;
    setViewport(width);
    // The table's width follows the pane's, so the edges are worked out from the width it is about to take.
    showEdges(scrollEdges({ offset: offset.current, viewport: width, content: tableLayout(width, compact).content }));
  }
  function page(direction: -1 | 1) {
    scroll.current?.scrollTo({ x: pageOffset({ offset: offset.current, viewport, content, pinned: SIDE + ticketWidth, direction, columnStarts }), animated: true });
  }
  // The pinned column rides along with the scroll, so it stays at the pane's left edge, and not past it when a scroll bounces.
  const pinnedShift = useMemo(() => scrollX.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp" }), [scrollX]);
  const shadowOpacity = useMemo(() => scrollX.interpolate({ inputRange: [0, SHADOW_IN], outputRange: [0, 1], extrapolate: "clamp" }), [scrollX]);

  const tickets = useMemo(() => [...(stats.data?.tickets ?? [])].sort((left, right) => compareTickets(left.ticket, right.ticket)), [stats.data]);
  const totals = useMemo(() => projectTotals(tickets, stats.data?.managerIdleCompactions ?? 0), [tickets, stats.data]);

  if (stats.error !== null && stats.data === undefined) return <Text style={styles.error}>{errorText(stats.error)}</Text>;
  if (stats.data === undefined) return <Text style={styles.note}>Loading…</Text>;
  // The manager's idle compactions count before any ticket moves, and show in the totals row.
  if (tickets.length === 0 && totals.idleCompactions === 0) return <Text style={styles.note}>No ticket has been recorded yet. Stats start when a ticket first moves.</Text>;

  function numbers(counted: Counted, style: typeof styles.cell) {
    return NUMBER_COLUMNS.map((column) => (
      <Text key={column.key} style={[style, { width: column.width }]} numberOfLines={1}>
        {column.value(counted)}
      </Text>
    ));
  }

  /** A ticket-column cell: it covers the table's left padding and the numbers sliding under it, with a shadow once they do. */
  function pinned(children: ReactNode, align: ViewStyle["justifyContent"], indent = 0) {
    return (
      <Animated.View
        style={{
          zIndex: 1,
          alignSelf: "stretch",
          justifyContent: align,
          width: SIDE + ticketWidth,
          marginLeft: -SIDE,
          paddingLeft: SIDE + indent,
          paddingRight: SPACE.sm,
          backgroundColor: colors.surface0,
          transform: [{ translateX: pinnedShift }],
        }}
      >
        {children}
        {fit.fits ? null : (
          <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: SHADOW_WIDTH, flexDirection: "row-reverse", opacity: shadowOpacity }}>
            {Array.from({ length: SHADOW_STEPS }, (_, step) => (
              <View key={step} style={{ flex: 1, backgroundColor: step === 0 ? colors.border : withAlpha(colors.foreground, 0.06 * (1 - step / SHADOW_STEPS)) }} />
            ))}
          </Animated.View>
        )}
      </Animated.View>
    );
  }

  const ticketsLabel = `${totals.tickets} ticket${totals.tickets === 1 ? "" : "s"}`;

  return (
    <ScrollView style={styles.root}>
      <View style={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg }}>
        <SectionHeading theme={theme} icon="ChartColumn" text={`Time and cost · ${ticketsLabel}`}>
          {/* A mouse wheel scrolls up and down only, and the sideways scroll bar sits at the foot of a long table. */}
          {compact || fit.fits || viewport === 0 ? null : (
            <View style={{ flexDirection: "row", gap: SPACE.xs }}>
              <IconButton theme={theme} icon="ChevronLeft" label="Earlier columns" disabled={!edges.moreLeft} onPress={() => page(-1)} />
              <IconButton theme={theme} icon="ChevronRight" label="Later columns" disabled={!edges.moreRight} onPress={() => page(1)} />
            </View>
          )}
        </SectionHeading>
      </View>
      <View onLayout={onLayout}>
        <Animated.ScrollView ref={scroll} horizontal contentContainerStyle={styles.table} onScroll={onScroll} scrollEventThrottle={16}>
          <View>
            <View style={styles.headerRow}>
              {pinned(<Text style={styles.header}>TICKET</Text>, "flex-end")}
              {compact ? null : <Text style={[styles.header, { width: statusWidth }]}>STATUS</Text>}
              {NUMBER_COLUMNS.map((column) => (
                <Text key={column.key} style={[styles.header, { width: column.width }]}>
                  {column.label.toUpperCase()}
                </Text>
              ))}
            </View>
            <View style={styles.row}>
              {pinned(
                <View style={{ paddingVertical: SPACE.sm }}>
                  <Text style={styles.totalTitle}>Project total</Text>
                  {compact ? <Text style={styles.under}>{ticketsLabel}</Text> : null}
                </View>,
                "center",
              )}
              {compact ? null : <Text style={[styles.total, { width: statusWidth }]}>{ticketsLabel}</Text>}
              {numbers(totals, styles.total)}
            </View>
            {tickets.map((summary) => {
              const expanded = open === summary.ticket;
              const child = parentOf(summary.ticket) !== null;
              const byStatus = Object.entries(summary.byStatus)
                .filter(([, ms]) => ms > 0)
                .sort(([left], [right]) => rank(left) - rank(right))
                .map(([status, ms]) => `${status} ${formatDuration(ms)}`)
                .join(" · ");
              return (
                <View key={summary.ticket}>
                  <Pressable accessibilityRole="button" style={styles.row} onPress={() => setOpen(expanded ? null : summary.ticket)}>
                    {pinned(
                      <View style={{ paddingVertical: SPACE.sm }}>
                        <Text style={styles.title} numberOfLines={1}>
                          <Text style={styles.id}>
                            {expanded ? "▾" : "▸"} {summary.ticket}
                          </Text>{" "}
                          {summary.title}
                        </Text>
                        {compact ? <Text style={styles.under}>{summary.status}</Text> : null}
                      </View>,
                      "center",
                      child ? SPACE.lg : 0,
                    )}
                    {compact ? null : (
                      <Text style={[styles.cell, { width: statusWidth }]} numberOfLines={1}>
                        {summary.status}
                      </Text>
                    )}
                    {numbers(summary, styles.cell)}
                  </Pressable>
                  {/* Held to the visible width and riding along with the scroll, so it reads without scrolling. */}
                  {expanded ? (
                    <Animated.View style={{ width: fit.fits ? undefined : Math.max(viewport - 2 * SIDE, 0), transform: [{ translateX: pinnedShift }] }}>
                      {/* Clear of the right-edge fade, which would otherwise wash out its last words. */}
                      <Text style={[styles.detail, fit.fits ? null : { paddingRight: FADE_WIDTH - SIDE }]}>
                        {[byStatus === "" ? "No time recorded per status." : byStatus, summary.agentsWithoutCost > 0 ? unknownCostText(summary.agentsWithoutCost, summary.agents) : null].filter((part) => part !== null).join(" · ")}
                      </Text>
                    </Animated.View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Animated.ScrollView>
        {edges.moreRight ? (
          <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: FADE_WIDTH, flexDirection: "row" }}>
            {Array.from({ length: FADE_STEPS }, (_, step) => (
              <View key={step} style={{ flex: 1, backgroundColor: withAlpha(colors.surface0, (step + 1) / FADE_STEPS) }} />
            ))}
          </View>
        ) : null}
      </View>
      {/* Under the table, not in its sideways scroll, so the notes wrap to the screen. */}
      <View style={styles.notes}>
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
    </ScrollView>
  );
}

/** Statuses in workflow order; anything unknown after them. */
function rank(status: string): number {
  const index = STATUS_ORDER.indexOf(status);
  return index === -1 ? STATUS_ORDER.length : index;
}
