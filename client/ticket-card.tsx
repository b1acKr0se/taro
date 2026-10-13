/**
 * One ticket on the board (decision 10): id, title, phase and complexity
 * badges, the owner's live state and last status line, children progress, one
 * line per thing it asks of you (TR-022: answered pinned above the owner's
 * chat, which the line opens), the one-tap actions its column calls for, and
 * once finished its key stats.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { compactAgent, nudgeAgent, relaunchOwner, type Card, type StatsSummary } from "../shared/contracts";
import { PhaseBadge } from "./badges";
import { callAction, cardCalls, type CardCall } from "./card-calls";
import { errorText, formatCost, pullRequestLabel, formatDuration, formatTokenCount, relativeTime } from "./format";
import { waitingOnText } from "./pane-agents";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { Chip, IconButton } from "./ui";
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
      track: { height: 3, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" as const },
      childRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, paddingLeft: SPACE.sm },
      calls: { gap: SPACE.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: SPACE.sm },
      call: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, paddingVertical: SPACE.xxs },
      callText: { flex: 1, color: colors.foreground, fontSize: FONT_SIZE.small },
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
  const calls = cardCalls(card);

  const head = (
    <View style={styles.head}>
      <View style={[styles.dot, { backgroundColor: liveColor }]} />
      <Text style={styles.id} numberOfLines={1}>
        {card.id}
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

  const statusLook = card.lastStatus === null ? null : statusStateLook(card.lastStatus.state);
  const milestone = (card.column === "working" || card.column === "stalled") && card.latestMilestone !== null ? card.latestMilestone : null;
  // From the subagents' labels and Paseo status: what the owner is waiting on while they run.
  const waitingOn = waitingOnText(card, now);
  const hasCalls = calls.length > 0 || card.column === "stalled";

  function callLine(call: CardCall) {
    const look =
      call.kind === "decision"
        ? { icon: "Hand", color: call.blocking ? colors.statusWarning : colors.foregroundMuted }
        : call.kind === "acceptance"
          ? { icon: "PackageCheck", color: colors.accent }
          : { icon: "KeyRound", color: colors.statusWarning };
    return (
      <View key={call.kind} style={{ gap: SPACE.xxs }}>
        {call.kind === "acceptance" && call.evidence !== null ? <Text style={styles.muted} numberOfLines={1}>{call.evidence}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`${callAction(call)}: ${call.text}`} style={styles.call} onPress={onOpen}>
          <Icon name={look.icon} size={13} color={look.color} />
          <Text style={styles.callText} numberOfLines={1}>
            {call.text}
          </Text>
          {call.kind === "decision" && call.more > 0 ? <Text style={styles.muted}>+{call.more}</Text> : null}
          <Text style={styles.callAction}>{callAction(call)} →</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.card}>
      {head}
      <Text style={styles.title}>{card.title}</Text>
      {card.complexity === null && !card.investigation && card.ownerElsewhere === null ? null : (
        <View style={styles.row}>
          {card.complexity === null ? null : <Chip theme={theme} icon="Gauge" text={card.complexity} color={colors.foregroundMuted} />}
          {card.investigation ? <Chip theme={theme} icon="Search" text="investigation" color={colors.accent} /> : null}
          {card.ownerElsewhere === null ? null : <Chip theme={theme} icon="Monitor" text={`on ${card.ownerElsewhere}`} color={colors.foregroundMuted} />}
        </View>
      )}
      {waitingOn === null ? null : (
        <View style={styles.line}>
          <View style={styles.lineIcon}>
            <Icon name="Hourglass" size={13} color={colors.statusSuccess} />
          </View>
          <Text style={[styles.status, { color: colors.foreground }]} numberOfLines={2}>
            {waitingOn}
          </Text>
        </View>
      )}
      {milestone === null ? null : (
        <View style={styles.line}>
          <View style={styles.lineIcon}>
            <Icon name="Flag" size={13} color={colors.foregroundMuted} />
          </View>
          <Text style={styles.status} numberOfLines={2}>
            {milestone.text}
          </Text>
        </View>
      )}
      {card.lastStatus === null || statusLook === null ? null : (
        <View style={styles.line}>
          <View style={styles.lineIcon}>
            <Icon name={statusLook.icon} size={13} color={toneColor(theme, statusLook.tone)} />
          </View>
          <Text style={styles.status} numberOfLines={3}>
            {card.lastStatus.text} · {relativeTime(card.lastStatus.at)}
          </Text>
        </View>
      )}
      {card.stalledReason === null ? null : (
        <View style={styles.line}>
          <View style={styles.lineIcon}>
            <Icon name="CircleAlert" size={13} color={colors.statusDanger} />
          </View>
          <Text style={styles.danger} numberOfLines={3}>
            {card.stalledReason}
          </Text>
        </View>
      )}
      {card.pullRequest === null ? null : (
        <Pressable
          accessibilityRole="link"
          style={styles.row}
          onPress={() => void openExternalUrl(card.pullRequest ?? "").catch((caught: unknown) => toast.error(errorText(caught)))}
        >
          <Icon name="GitPullRequest" size={13} color={colors.accent} />
          <Text style={styles.link} numberOfLines={1}>
            {pullRequestLabel(card.pullRequest)}
          </Text>
        </Pressable>
      )}
      {statsLine}
      {card.children.length === 0 ? null : (
        <View style={{ gap: SPACE.xs }}>
          <View style={styles.track}>
            <View style={{ width: `${Math.round((childrenDone / card.children.length) * 100)}%`, height: 3, backgroundColor: colors.statusSuccess }} />
          </View>
          <Pressable style={styles.row} onPress={() => setChildrenOpen((open) => !open)}>
            <Icon name={childrenOpen ? "ChevronDown" : "ChevronRight"} size={12} color={colors.foregroundMuted} />
            <Icon name="ListTree" size={13} color={colors.foregroundMuted} />
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
      {hasCalls ? (
        <View style={styles.calls}>
          {calls.map(callLine)}
          {card.column === "stalled" ? (
            <View style={styles.row}>
              {owner !== null && owner.status !== "error" ? (
                <IconButton icon="Zap" label="Nudge" showLabel theme={theme} disabled={busy} onPress={() => void run(() => nudge({ agentId: owner.id }), "Nudged.")} />
              ) : null}
              <IconButton icon="RotateCcw" label="Relaunch" showLabel theme={theme} disabled={busy} onPress={() => void run(() => relaunch({ project, ticket: card.id }), "A fresh owner is starting.")} />
            </View>
          ) : null}
        </View>
      ) : null}
      {owner !== null && owner.contextUsedTokens !== null ? (
        <View style={styles.row}>
          <Icon name="Brain" size={12} color={colors.foregroundMuted} />
          <Text style={styles.muted}>context {formatTokenCount(owner.contextUsedTokens)}</Text>
          {card.subagents.length === 0 ? null : <Text style={styles.muted}>· {card.subagents.length} subagent{card.subagents.length === 1 ? "" : "s"}</Text>}
          {owner.status === "idle" && owner.contextUsedTokens > 150_000 ? (
            <IconButton icon="Minimize2" label="Compact" showLabel theme={theme} disabled={busy} onPress={() => void run(() => compactRpc({ agentId: owner.id }), "Compacting after a handoff.")} />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
