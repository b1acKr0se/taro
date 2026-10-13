/**
 * A project's Stats tab: a totals row, then a row per ticket with its wall
 * time, agent time, time waiting on the user, turns, agents, cost, nudges and
 * decisions. Tapping a ticket shows its time per status. The table scrolls
 * sideways when the screen is narrower than it.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { StatsSummary } from "../shared/contracts";
import { TICKET_STATUSES } from "../shared/project";
import { compareTickets, parentOf, projectTotals } from "../shared/stats";
import { errorText, formatCost, formatDuration } from "./format";
import { useStats } from "./queries";
import { FONT_SIZE } from "./type-scale";

const STATUS_ORDER: readonly string[] = TICKET_STATUSES;

interface Column {
  key: string;
  label: string;
  width: number;
}

const COLUMNS: readonly Column[] = [
  { key: "ticket", label: "Ticket", width: 260 },
  { key: "status", label: "Status", width: 130 },
  { key: "wall", label: "Wall", width: 72 },
  { key: "active", label: "Active", width: 72 },
  { key: "waiting", label: "Waiting on you", width: 104 },
  { key: "turns", label: "Turns", width: 52 },
  { key: "agents", label: "Agents", width: 56 },
  { key: "cost", label: "Cost", width: 68 },
  { key: "nudges", label: "Nudges", width: 60 },
  { key: "decisions", label: "Decisions", width: 72 },
];

const TABLE_WIDTH = COLUMNS.reduce((total, column) => total + column.width, 0) + 24;

export function StatsView({ project, theme }: { project: string; theme: PluginTheme }) {
  const stats = useStats(project);
  const [open, setOpen] = useState<string | null>(null);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      root: { flex: 1, minHeight: 0 },
      table: { width: TABLE_WIDTH, padding: 12 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
      header: { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, fontWeight: "700" as const },
      cell: { color: colors.foreground, fontSize: FONT_SIZE.small, paddingRight: 8 },
      total: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "700" as const, paddingRight: 8 },
      id: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      detail: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, paddingVertical: 6, paddingLeft: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
      note: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, padding: 12 },
      error: { color: colors.statusDanger, padding: 12 },
    }),
    [colors],
  );

  const tickets = useMemo(() => [...(stats.data?.tickets ?? [])].sort((left, right) => compareTickets(left.ticket, right.ticket)), [stats.data]);
  const totals = useMemo(() => projectTotals(tickets), [tickets]);

  if (stats.error !== null && stats.data === undefined) return <Text style={styles.error}>{errorText(stats.error)}</Text>;
  if (stats.data === undefined) return <Text style={styles.note}>Loading…</Text>;
  if (tickets.length === 0) return <Text style={styles.note}>No ticket has been recorded yet. Stats start when a ticket first moves.</Text>;

  function cells(values: readonly string[], style: typeof styles.cell) {
    return COLUMNS.slice(2).map((column, index) => (
      <Text key={column.key} style={[style, { width: column.width }]} numberOfLines={1}>
        {values[index]}
      </Text>
    ));
  }

  function numbers(summary: Omit<StatsSummary, "project" | "ticket" | "title" | "status" | "byStatus">): string[] {
    return [
      formatDuration(summary.wallMs),
      formatDuration(summary.agentActiveMs),
      formatDuration(summary.waitingOnUserMs),
      String(summary.turns),
      String(summary.agents),
      formatCost(summary.costUsd),
      String(summary.nudges),
      String(summary.decisions),
    ];
  }

  return (
    <ScrollView style={styles.root}>
      <ScrollView horizontal contentContainerStyle={styles.table}>
        <View>
          <View style={styles.row}>
            {COLUMNS.map((column) => (
              <Text key={column.key} style={[styles.header, { width: column.width }]}>
                {column.label.toUpperCase()}
              </Text>
            ))}
          </View>
          <View style={styles.row}>
            <Text style={[styles.total, { width: COLUMNS[0]?.width }]}>Project total</Text>
            <Text style={[styles.total, { width: COLUMNS[1]?.width }]}>
              {totals.tickets} ticket{totals.tickets === 1 ? "" : "s"}
            </Text>
            {cells(numbers(totals), styles.total)}
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
                  <Text style={[styles.cell, { width: COLUMNS[0]?.width, paddingLeft: child ? 14 : 0 }]} numberOfLines={1}>
                    <Text style={styles.id}>
                      {expanded ? "▾" : "▸"} {summary.ticket}
                    </Text>{" "}
                    {summary.title}
                  </Text>
                  <Text style={[styles.cell, { width: COLUMNS[1]?.width }]} numberOfLines={1}>
                    {summary.status}
                  </Text>
                  {cells(numbers(summary), styles.cell)}
                </Pressable>
                {expanded ? <Text style={styles.detail}>{byStatus === "" ? "No time recorded per status." : byStatus}</Text> : null}
              </View>
            );
          })}
          <Text style={styles.note}>A child ticket's agents, turns, cost and time also count on its parent, so the totals add those up once.</Text>
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
