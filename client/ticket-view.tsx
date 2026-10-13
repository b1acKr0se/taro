/**
 * The ticket beside its owner's chat: status, description, criteria, plan, children, delivery, its
 * records as a milestone timeline, and the raw records folded away.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { loadTicket } from "../shared/contracts";
import { ticketMilestones, type Milestone } from "../shared/milestones";
import { PhaseBadge, SectionHeading } from "./badges";
import { EvidenceBlock } from "./evidence-view";
import { errorText } from "./format";
import { Markdown } from "./markdown";
import { withAlpha } from "./tint";
import { milestoneRows } from "./milestone-rows";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { Chip, MONOSPACE } from "./ui";
import { recordKindLook, toneColor } from "./visual-meta";

/** The timeline's dot, the rail column it sits in, and the clock column before it. */
const DOT = 10;
const RAIL = 16;
const CLOCK = 40;
/** A long record shows this many lines until tapped. */
const CLIPPED_LINES = 3;

export function TicketView({ project, ticket, theme }: { project: string; ticket: string; theme: PluginTheme }) {
  const load = useRpc(loadTicket);
  const toast = useToast();
  const detail = useQuery({ queryKey: ["taro", "ticket", project, ticket], queryFn: () => load({ project, ticket }), refetchInterval: 6_000 });
  const [recordsOpen, setRecordsOpen] = useState(false);
  const notes = detail.data?.notes ?? null;
  const milestones = useMemo(() => ticketMilestones(notes), [notes]);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      body: { padding: SPACE.lg, gap: SPACE.xl },
      section: { gap: SPACE.sm },
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: SPACE.sm },
      line: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: SPACE.sm },
      lineIcon: { marginTop: 2 },
      text: { flex: 1, color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      muted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, padding: SPACE.lg },
      notes: { color: colors.foreground, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption), fontFamily: MONOSPACE },
      notesFrame: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: SPACE.md, backgroundColor: colors.surface1 },
    }),
    [colors],
  );
  if (detail.error !== null && detail.data === undefined) return <Text style={styles.muted}>{errorText(detail.error)}</Text>;
  const data = detail.data;
  if (data === undefined) return <Text style={styles.muted}>Loading the ticket…</Text>;
  const noop = () => undefined;
  // The delivery names the PR; the user opens it from here before accepting (decision 34).
  const openLink = (url: string) => void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));

  function section(icon: string, title: string, content: ReactNode, aside?: ReactNode) {
    return (
      <View style={styles.section}>
        <SectionHeading theme={theme} icon={icon} text={title}>
          {aside}
        </SectionHeading>
        {content}
      </View>
    );
  }

  const criteriaDone = data.acceptanceCriteria.filter((criterion) => criterion.checked).length;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {section(
        "Info",
        "Status",
        <View style={styles.row}>
          <PhaseBadge theme={theme} status={data.status} />
          {data.labels.map((label) => (
            <Chip key={label} theme={theme} icon="Tag" text={label} color={colors.foregroundMuted} />
          ))}
        </View>,
      )}
      {data.description === null ? null : section("FileText", "Description", <Markdown source={data.description} theme={theme} onOpenLink={noop} />)}
      {data.acceptanceCriteria.length === 0
        ? null
        : section(
            "ListChecks",
            "Acceptance criteria",
            <View style={{ gap: SPACE.sm }}>
              {data.acceptanceCriteria.map((criterion) => (
                <View key={criterion.index} style={styles.line}>
                  <View style={styles.lineIcon}>
                    <Icon name={criterion.checked ? "SquareCheck" : "Square"} size={15} color={criterion.checked ? colors.statusSuccess : colors.foregroundMuted} />
                  </View>
                  <Text style={styles.text}>{criterion.text}</Text>
                </View>
              ))}
            </View>,
            <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }}>
              {criteriaDone}/{data.acceptanceCriteria.length}
            </Text>,
          )}
      {data.plan === null ? null : section("Map", "Plan", <Markdown source={data.plan} theme={theme} onOpenLink={noop} />)}
      {data.children.length === 0
        ? null
        : section(
            "ListTree",
            "Children",
            <View style={{ gap: SPACE.sm }}>
              {data.children.map((child) => (
                <View key={child.id} style={styles.line}>
                  <PhaseBadge theme={theme} status={child.status ?? "Unknown"} />
                  <Text style={styles.text}>
                    <Text style={{ color: colors.foregroundMuted, fontWeight: "600" }}>{child.id}</Text> {child.title}
                  </Text>
                </View>
              ))}
            </View>,
          )}
      {data.evidence === null ? null : section("ClipboardCheck", "Evidence", <EvidenceBlock evidence={data.evidence} theme={theme} />)}
      {data.finalSummary === null ? null : section("PackageCheck", "Delivery", <Markdown source={data.finalSummary} theme={theme} onOpenLink={openLink} />)}
      {milestones.length === 0 ? null : section("Flag", "Milestones", <Timeline milestones={milestones} theme={theme} />)}
      {data.notes === null
        ? null
        : section(
            "ScrollText",
            "Records",
            recordsOpen ? (
              <View style={styles.notesFrame}>
                <Text selectable style={styles.notes}>
                  {data.notes}
                </Text>
              </View>
            ) : null,
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: recordsOpen }}
              style={styles.row}
              onPress={() => setRecordsOpen((open) => !open)}
            >
              <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }}>{recordsOpen ? "Hide" : "Show raw"}</Text>
              <Icon name={recordsOpen ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
            </Pressable>,
          )}
    </ScrollView>
  );
}

/**
 * The ticket's records, oldest first, on a rail: the time in its own column, a day heading where
 * the date changes, a small dot per record, coloured only for the records a reader looks for.
 */
function Timeline({ milestones, theme }: { milestones: readonly Milestone[]; theme: PluginTheme }) {
  const { colors } = theme;
  const rows = useMemo(() => milestoneRows(milestones), [milestones]);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const line = withAlpha(colors.foregroundMuted, 0.35);
  const caption = { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) };

  function rail(first: boolean, last: boolean, dot: ReactNode) {
    return (
      <View style={{ width: RAIL, alignItems: "center" }}>
        {/* The rail joins the dots: it starts at the first and stops at the last. */}
        <View style={{ position: "absolute", left: RAIL / 2 - 1, top: first ? 8 : 0, bottom: last ? undefined : 0, height: last ? 8 : undefined, width: 2, backgroundColor: line }} />
        {dot}
      </View>
    );
  }

  return (
    <View>
      {rows.map((row, index) => {
        const color = row.key ? toneColor(theme, recordKindLook(row.kind).tone) : colors.foregroundMuted;
        const first = index === 0;
        const last = index === rows.length - 1;
        const expanded = open.has(index);
        const toggle = () =>
          setOpen((current) => {
            const next = new Set(current);
            if (expanded) next.delete(index);
            else next.add(index);
            return next;
          });
        return (
          <View key={`${index}:${row.kind}`}>
            {row.day === null ? null : (
              <View style={{ flexDirection: "row", gap: SPACE.sm }}>
                <View style={{ width: CLOCK }} />
                {rail(first, false, null)}
                <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.caption, fontWeight: "700", paddingTop: first ? 0 : SPACE.sm, paddingBottom: SPACE.sm }}>{row.day}</Text>
              </View>
            )}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={toggle} style={{ flexDirection: "row", gap: SPACE.sm }}>
              <Text style={[caption, { width: CLOCK, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{row.clock ?? ""}</Text>
              {rail(
                first && row.day === null,
                last,
                <View
                  style={{
                    marginTop: 3,
                    width: DOT,
                    height: DOT,
                    borderRadius: DOT / 2,
                    borderWidth: 2,
                    borderColor: row.key ? color : colors.foregroundMuted,
                    backgroundColor: row.key ? color : colors.surface0,
                  }}
                />,
              )}
              <View style={{ flex: 1, gap: SPACE.xxs, paddingBottom: last ? 0 : SPACE.md }}>
                <Text style={{ color: row.key ? color : colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" }}>{row.label}</Text>
                {row.text === "" ? null : (
                  <Text numberOfLines={expanded ? undefined : CLIPPED_LINES} style={{ color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) }}>
                    {row.text}
                  </Text>
                )}
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
