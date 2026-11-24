/**
 * The Stats tab's review findings by author model: per model that wrote reviewed code, the tickets reviewed, the
 * High, Medium and Low findings the independent reviews recorded, High per ticket, and the defects found after
 * delivery (escapes), under an All models row. On a phone a row folds to the model and its count on one line and
 * the five numbers under it. Hidden while nothing has loaded, so a daemon without the RPC leaves the tab as it was.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View, type TextStyle } from "react-native";

import { SectionHeading } from "./badges";
import { useReviewFindings } from "./queries";
import { SPACE } from "./spacing";
import { findingsSection, highPerTicketText, reviewedText, type FindingsRowData } from "./stats-findings-state";
import { FONT_SIZE, labelLineHeightFor } from "./type-scale";

type DotColour = "statusDanger" | "statusWarning" | "foregroundMuted";

interface Column {
  key: string;
  label: string;
  width: number;
  /** Shown on a phone too; the tickets reviewed sit beside the model there. */
  phone: boolean;
  dot?: DotColour;
  value: (row: FindingsRowData) => string;
}

// A two-word header breaks onto two lines, so its column is only as wide as its numbers need.
const COLUMNS: readonly Column[] = [
  { key: "tickets", label: "Tickets\nreviewed", width: 84, phone: false, value: (row) => String(row.tickets) },
  { key: "high", label: "High", width: 60, phone: true, dot: "statusDanger", value: (row) => String(row.high) },
  { key: "medium", label: "Medium", width: 76, phone: true, dot: "statusWarning", value: (row) => String(row.medium) },
  { key: "low", label: "Low", width: 56, phone: true, dot: "foregroundMuted", value: (row) => String(row.low) },
  { key: "per-ticket", label: "High per\nticket", width: 80, phone: true, value: highPerTicketText },
  { key: "escapes", label: "Escapes", width: 64, phone: true, value: (row) => String(row.escapes) },
];

const MODEL_WIDTH = 220;
const DOT = 6;
const HEADER_LINE = labelLineHeightFor(FONT_SIZE.micro);
const CELL_LINE = labelLineHeightFor(FONT_SIZE.small);

export function StatsFindings({ project, theme, compact }: { project: string; theme: PluginTheme; compact: boolean }) {
  const query = useReviewFindings(project);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      section: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg },
      heading: { paddingBottom: SPACE.md },
      headerRow: { flexDirection: "row" as const, alignItems: "flex-end" as const, paddingTop: SPACE.sm, paddingBottom: SPACE.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
      header: { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, lineHeight: HEADER_LINE, fontWeight: "700" as const },
      headerCell: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.xs },
      row: { paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: SPACE.xxs },
      line: { flexDirection: "row" as const, alignItems: "center" as const },
      cell: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: CELL_LINE, paddingRight: SPACE.sm },
      total: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: CELL_LINE, paddingRight: SPACE.sm, fontWeight: "700" as const },
      reviewed: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "400" as const },
      note: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption) + 4, paddingTop: SPACE.md },
    }),
    [colors],
  );

  const section = findingsSection({ data: query.data, error: query.error });
  if (section.kind === "hidden") return null;

  const columns = COLUMNS.filter((column) => !compact || column.phone);
  // Every row's columns take the same widths, so they shrink alike on a narrow screen and stay lined up.
  const columnStyle = (column: Column) => ({ width: column.width, flexShrink: 1, minWidth: 0 });
  const modelStyle = { width: MODEL_WIDTH, flexShrink: 1, minWidth: 120 };

  const heading = (
    <View style={styles.heading}>
      <SectionHeading theme={theme} icon="Bug" text="Review findings by author model" />
    </View>
  );

  if (section.kind === "empty") {
    return (
      <View style={styles.section}>
        {heading}
        <Text style={[styles.note, { paddingTop: 0 }]}>No review has recorded findings yet. Each independent review adds them from now on.</Text>
      </View>
    );
  }

  const header = (
    <View style={styles.headerRow}>
      {compact ? null : (
        <Text style={[styles.header, modelStyle]} numberOfLines={1}>
          MODEL
        </Text>
      )}
      {columns.map((column) => (
        <View key={column.key} style={[styles.headerCell, columnStyle(column)]}>
          {column.dot === undefined ? null : <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: colors[column.dot] }} />}
          <Text style={styles.header}>{column.label.toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );

  function numbers(row: FindingsRowData, style: TextStyle) {
    return columns.map((column) => (
      <Text key={column.key} style={[style, columnStyle(column)]} numberOfLines={1}>
        {column.value(row)}
      </Text>
    ));
  }

  function tableRow(row: FindingsRowData, bold: boolean) {
    const style = bold ? styles.total : styles.cell;
    if (compact) {
      return (
        <View key={row.model} style={styles.row}>
          <Text style={[style, { paddingRight: 0 }]} numberOfLines={1}>
            {row.model} <Text style={styles.reviewed}>{reviewedText(row)}</Text>
          </Text>
          <View style={styles.line}>{numbers(row, style)}</View>
        </View>
      );
    }
    return (
      <View key={row.model} style={[styles.row, styles.line]}>
        <Text style={[style, modelStyle]} numberOfLines={1}>
          {row.model}
        </Text>
        {numbers(row, style)}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      {heading}
      {header}
      {tableRow(section.all, true)}
      {section.models.map((row) => tableRow(row, false))}
      <Text style={styles.note}>From each independent review’s findings, at the owner’s grade. Escapes are defects found after delivery.</Text>
    </View>
  );
}
