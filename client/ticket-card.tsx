/**
 * One ticket on the board (decision 10, TR-026): id, phase and live dot, the title, one line for
 * what is happening now (`card-now.ts`: why it stalled, what it asks of you — answered in the owner's
 * pane, which the line opens — the subagent it waits on, or its last status), children folded to one
 * line, and one muted footer (complexity, context, subagents, PR, and Nudge / Relaunch / Compact when
 * they apply). Once finished: what it was and what it cost.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { compactAgent, nudgeAgent, relaunchOwner, type Card, type StatsSummary } from "../shared/contracts";
import { PhaseBadge } from "./badges";
import { callAction } from "./card-calls";
import { cardFooterParts, cardNowLine, offersCompact, type NowLine } from "./card-now";
import { errorText, formatCost, pullRequestLabel, formatDuration, relativeTime } from "./format";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton } from "./ui";
import { useNow } from "./use-now";
import { statusStateLook, toneColor } from "./visual-meta";

export function TicketCard({
  card,
  project,
  theme,
  compact,
  selected,
  stats = null,
  onOpen,
  onChanged,
}: {
  card: Card;
  project: string;
  theme: PluginTheme;
  compact: boolean;
  selected: boolean;
  /** The board passes it for finished tickets only; null hides the line. */
  stats?: StatsSummary | null;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const nudge = useRpc(nudgeAgent);
  const relaunch = useRpc(relaunchOwner);
  const compactRpc = useRpc(compactAgent);
  const [busy, setBusy] = useState(false);
  const [childrenOpen, setChildrenOpen] = useState(false);
  const now = useNow();
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        borderRadius: 10,
        padding: compact ? SPACE.md : SPACE.lg - 2,
        gap: SPACE.sm,
        backgroundColor: colors.surface0,
      },
      // Wraps so a long phase ("Awaiting acceptance") moves under the id in a narrow column instead of truncating.
      head: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: SPACE.sm },
      id: { flexGrow: 1, flexShrink: 0, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      title: { color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const, lineHeight: lineHeightFor(FONT_SIZE.body) },
      line: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: SPACE.sm },
      lineIcon: { marginTop: 3 },
      status: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      danger: { flex: 1, color: colors.statusDanger, fontSize: FONT_SIZE.small, fontWeight: "600" as const, lineHeight: lineHeightFor(FONT_SIZE.small) },
      dot: { width: 8, height: 8, borderRadius: 4 },
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm, alignItems: "center" as const },
      muted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      link: { color: colors.accent, fontSize: FONT_SIZE.caption },
      track: { width: 44, height: 3, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" as const },
      childRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, paddingLeft: SPACE.sm },
      footer: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: SPACE.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: SPACE.sm },
      callText: { flex: 1, color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      callAction: { color: colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
    }),
    [colors, compact, selected],
  );

  async function run(action: () => Promise<unknown>, done?: string): Promise<void> {
    setBusy(true);
    try {
      await action();
      if (done !== undefined) toast.show(done, { variant: "success" });
      onChanged();
    } catch (caught) {
      toast.error(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  const owner = card.owner;
  const liveColor =
    owner === null
      ? colors.foregroundMuted
      : owner.status === "running" || owner.status === "initializing"
        ? colors.statusSuccess
        : owner.status === "error"
          ? colors.statusDanger
          : owner.pendingPermissions > 0
            ? colors.statusWarning
            : colors.foregroundMuted;
  const childrenDone = card.children.filter((child) => child.status === "Done").length;

  const head = (
    <View style={styles.head}>
      <View style={[styles.dot, { backgroundColor: liveColor }]} />
      <Text style={styles.id} numberOfLines={1}>
        {card.id}
        {card.parent === null ? "" : `  ↳ ${card.parent}`}
      </Text>
      <PhaseBadge theme={theme} status={card.status} />
    </View>
  );
  const statsLine =
    stats === null ? null : (
      <View style={styles.row}>
        <Icon name="Timer" size={12} color={colors.foregroundMuted} />
        <Text style={styles.muted} numberOfLines={1}>
          {formatDuration(stats.wallMs)} wall · {formatDuration(stats.agentActiveMs)} active · {stats.turns} turn{stats.turns === 1 ? "" : "s"}
        </Text>
        {/* No recorded cost says nothing worth a line of its own. */}
        {stats.costUsd === null ? null : (
          <>
            <Icon name="Coins" size={12} color={colors.foregroundMuted} />
            <Text style={styles.muted}>{formatCost(stats.costUsd)}</Text>
          </>
        )}
      </View>
    );

  // A finished ticket is history: what it was and what it cost.
  if (card.column === "done") {
    return (
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.card}>
        {head}
        <Text style={styles.title}>{card.title}</Text>
        {statsLine}
      </Pressable>
    );
  }

  const nowLine = cardNowLine(card, now);
  const footer = cardFooterParts(card);
  const compactOffered = offersCompact(card);
  const stalled = card.column === "stalled";
  const hasFooter = footer.length > 0 || card.pullRequest !== null || compactOffered || stalled;

  function nowRow(line: NowLine) {
    if (line.kind === "call") {
      const call = line.call;
      const look =
        call.kind === "decision"
          ? { icon: "Hand", color: call.blocking ? colors.statusWarning : colors.foregroundMuted }
          : call.kind === "acceptance"
            ? card.evidence !== null && !card.evidence.complete
              ? { icon: "PackageX", color: colors.statusWarning }
              : { icon: "PackageCheck", color: colors.accent }
            : { icon: "KeyRound", color: colors.statusWarning };
      const text = call.kind === "acceptance" && call.evidence !== null ? `${call.text} · ${call.evidence}` : call.text;
      return (
        <Pressable accessibilityRole="button" accessibilityLabel={`${callAction(call)}: ${text}`} style={styles.line} onPress={onOpen}>
          <View style={styles.lineIcon}>
            <Icon name={look.icon} size={13} color={look.color} />
          </View>
          {/* Two lines: a narrow column still reads the question, and a long one cannot grow the card. */}
          <Text style={styles.callText} numberOfLines={2}>
            {text}
          </Text>
          {line.more > 0 ? <Text style={styles.muted}>+{line.more}</Text> : null}
          <Text style={styles.callAction}>{callAction(call)} →</Text>
        </Pressable>
      );
    }
    const look =
      line.kind === "stalled"
        ? { icon: "CircleAlert", color: colors.statusDanger, style: styles.danger }
        : line.kind === "subagent"
          ? { icon: "Hourglass", color: colors.statusSuccess, style: [styles.status, { color: colors.foreground }] }
          : (() => {
              const status = statusStateLook(line.state);
              return { icon: status.icon, color: toneColor(theme, status.tone), style: styles.status };
            })();
    const at = line.kind === "subagent" ? null : line.at;
    return (
      <View style={styles.line}>
        <View style={styles.lineIcon}>
          <Icon name={look.icon} size={13} color={look.color} />
        </View>
        <Text style={look.style} numberOfLines={2}>
          {line.text}
          {at === null ? "" : ` · ${relativeTime(at, now)}`}
        </Text>
      </View>
    );
  }

  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.card}>
      {head}
      <Text style={styles.title}>{card.title}</Text>
      {nowLine === null ? null : nowRow(nowLine)}
      {card.children.length === 0 ? null : (
        <View style={{ gap: SPACE.xs }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: childrenOpen }} style={styles.row} onPress={() => setChildrenOpen((open) => !open)}>
            <Icon name={childrenOpen ? "ChevronDown" : "ChevronRight"} size={12} color={colors.foregroundMuted} />
            <View style={styles.track}>
              <View style={{ width: `${Math.round((childrenDone / card.children.length) * 100)}%`, height: 3, backgroundColor: colors.statusSuccess }} />
            </View>
            <Text style={styles.muted}>
              {childrenDone}/{card.children.length} children done
            </Text>
          </Pressable>
          {childrenOpen
            ? card.children.map((child) => (
                <View key={child.id} style={styles.childRow}>
                  <PhaseBadge theme={theme} status={child.status} />
                  <Text style={[styles.muted, { flex: 1 }]} numberOfLines={2}>
                    {child.id} · {child.title}
                  </Text>
                </View>
              ))
            : null}
        </View>
      )}
      {hasFooter ? (
        <View style={styles.footer}>
          {stalled && owner !== null && owner.status !== "error" ? (
            <IconButton icon="Zap" label="Nudge" showLabel theme={theme} disabled={busy} onPress={() => void run(() => nudge({ agentId: owner.id }), "Nudged.")} />
          ) : null}
          {stalled ? (
            <IconButton icon="RotateCcw" label="Relaunch" showLabel theme={theme} disabled={busy} onPress={() => void run(() => relaunch({ project, ticket: card.id }), "A fresh owner is starting.")} />
          ) : null}
          <Text style={[styles.muted, { flexShrink: 1 }]} numberOfLines={1}>
            {footer.join(" · ")}
          </Text>
          {card.pullRequest === null ? null : (
            <Pressable
              accessibilityRole="link"
              onPress={() => void openExternalUrl(card.pullRequest ?? "").catch((caught: unknown) => toast.error(errorText(caught)))}
            >
              <Text style={styles.link} numberOfLines={1}>
                {footer.length === 0 ? "" : "· "}
                {pullRequestLabel(card.pullRequest)}
              </Text>
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          {compactOffered && owner !== null ? (
            <IconButton icon="Minimize2" label="Compact" showLabel theme={theme} disabled={busy} onPress={() => void run(() => compactRpc({ agentId: owner.id }), "Compacting after a handoff.")} />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
