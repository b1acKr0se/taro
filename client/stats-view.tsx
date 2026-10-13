/**
 * A project's Stats tab: a totals row, then a row per ticket with its wall
 * time, agent time, time waiting on the user, turns, agents, cost, nudges,
 * decisions, crash recoveries and idle compactions (the totals add the manager's). Tapping a ticket shows its time per status. The table scrolls
 * sideways when the screen is narrower than it; on a phone the status sits
 * under the title so the first numbers fit.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { TICKET_STATUSES } from "../shared/project";
import { compareTickets, parentOf, projectTotals, type ProjectTotals } from "../shared/stats";
import { errorText, formatCost, formatDuration } from "./format";
import { SectionHeading } from "./badges";
import { useStats } from "./queries";
import { SPACE } from "./spacing";
import { FONT_SIZE } from "./type-scale";

const STATUS_ORDER: readonly string[] = TICKET_STATUSES;

type Counted = Omit<ProjectTotals, "tickets">;

const NUMBER_COLUMNS: ReadonlyArray<{ key: string; label: string; width: number; value: (counted: Counted) => string }> = [
  { key: "wall", label: "Wall", width: 72, value: (counted) => formatDuration(counted.wallMs) },
  { key: "active", label: "Active", width: 72, value: (counted) => formatDuration(counted.agentActiveMs) },
  { key: "waiting", label: "Waiting on you", width: 124, value: (counted) => formatDuration(counted.waitingOnUserMs) },
  { key: "turns", label: "Turns", width: 52, value: (counted) => String(counted.turns) },
  { key: "agents", label: "Agents", width: 56, value: (counted) => String(counted.agents) },
  { key: "cost", label: "Cost", width: 68, value: (counted) => formatCost(counted.costUsd) },
  { key: "nudges", label: "Nudges", width: 60, value: (counted) => String(counted.nudges) },
  { key: "decisions", label: "Decisions", width: 72, value: (counted) => String(counted.decisions) },
  { key: "recoveries", label: "Recoveries", width: 80, value: (counted) => String(counted.recoveries) },
  { key: "idle-compactions", label: "Idle compactions", width: 132, value: (counted) => String(counted.idleCompactions) },
];

const NUMBERS_WIDTH = NUMBER_COLUMNS.reduce((total, column) => total + column.width, 0);

export function StatsView({ project, theme, compact }: { project: string; theme: PluginTheme; compact: boolean }) {
  const stats = useStats(project);
  const [open, setOpen] = useState<string | null>(null);
  const { colors } = theme;
  const ticketWidth = compact ? 150 : 230;
  const statusWidth = compact ? 0 : 120;
  const styles = useMemo(
    () => ({
      root: { flex: 1, minHeight: 0 },
      table: { width: ticketWidth + statusWidth + NUMBERS_WIDTH + 2 * SPACE.lg, padding: SPACE.lg, paddingTop: SPACE.md },
      row: { flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
      header: { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, fontWeight: "700" as const },
      cell: { color: colors.foreground, fontSize: FONT_SIZE.small, paddingRight: SPACE.sm },
      total: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "700" as const, paddingRight: SPACE.sm },
      id: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      under: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      detail: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, paddingVertical: SPACE.sm, paddingLeft: SPACE.md, borderBottomWidth: 1, borderBottomColor: colors.border },
      note: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, padding: SPACE.lg },
      error: { color: colors.statusDanger, padding: SPACE.lg },
    }),
    [colors, ticketWidth, statusWidth],
  );

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

  const ticketsLabel = `${totals.tickets} ticket${totals.tickets === 1 ? "" : "s"}`;

  return (
    <ScrollView style={styles.root}>
      <View style={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg }}>
        <SectionHeading theme={theme} icon="ChartColumn" text={`Time and cost · ${ticketsLabel}`} />
      </View>
      <ScrollView horizontal contentContainerStyle={styles.table}>
        <View>
          <View style={styles.row}>
            <Text style={[styles.header, { width: ticketWidth }]}>TICKET</Text>
            {compact ? null : <Text style={[styles.header, { width: statusWidth }]}>STATUS</Text>}
            {NUMBER_COLUMNS.map((column) => (
              <Text key={column.key} style={[styles.header, { width: column.width }]}>
                {column.label.toUpperCase()}
              </Text>
            ))}
          </View>
          <View style={styles.row}>
            <View style={{ width: ticketWidth }}>
              <Text style={styles.total}>Project total</Text>
              {compact ? <Text style={styles.under}>{ticketsLabel}</Text> : null}
            </View>
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
                  <View style={{ width: ticketWidth, paddingLeft: child ? SPACE.lg : 0, paddingRight: SPACE.sm }}>
                    <Text style={styles.cell} numberOfLines={1}>
                      <Text style={styles.id}>
                        {expanded ? "▾" : "▸"} {summary.ticket}
                      </Text>{" "}
                      {summary.title}
                    </Text>
                    {compact ? <Text style={styles.under}>{summary.status}</Text> : null}
                  </View>
                  {compact ? null : (
                    <Text style={[styles.cell, { width: statusWidth }]} numberOfLines={1}>
                      {summary.status}
                    </Text>
                  )}
                  {numbers(summary, styles.cell)}
                </Pressable>
                {expanded ? <Text style={styles.detail}>{byStatus === "" ? "No time recorded per status." : byStatus}</Text> : null}
              </View>
            );
          })}
          <Text style={styles.note}>A child ticket's agents, turns, cost and time also count on its parent, so the totals add those up once. Idle compactions in the total include the manager's.</Text>
        </View>
      </ScrollView>
    </ScrollView>
  );
}

/** Statuses in workflow order; anything unknown after them. */
function rank(status: string): number {
  const index = STATUS_ORDER.indexOf(status);
  return index === -1 ? STATUS_ORDER.length : index;
}
