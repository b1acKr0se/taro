/**
 * One ticket on the board (decision 10): id, title, phase and complexity
 * badges, the owner's live state and last status line, its open decisions as
 * buttons, children progress, the actions its column calls for, and once
 * finished its key stats.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { acceptTicket, compactAgent, nudgeAgent, relaunchOwner, requestChanges, type Card, type StatsSummary } from "../shared/contracts";
import { DecisionCard } from "./decision-card";
import { errorText, formatCost, formatDuration, formatTokenCount, relativeTime } from "./format";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { Chip, IconButton } from "./ui";

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
  const accept = useRpc(acceptTicket);
  const changes = useRpc(requestChanges);
  const nudge = useRpc(nudgeAgent);
  const relaunch = useRpc(relaunchOwner);
  const compactRpc = useRpc(compactAgent);
  const [changeText, setChangeText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [childrenOpen, setChildrenOpen] = useState(false);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        borderRadius: 10,
        padding: compact ? 10 : 12,
        gap: 8,
        backgroundColor: colors.surface0,
      },
      head: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, flexWrap: "wrap" as const },
      id: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      title: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
      status: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small },
      dot: { width: 8, height: 8, borderRadius: 4 },
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, alignItems: "center" as const },
      muted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      link: { color: colors.accent, fontSize: FONT_SIZE.caption },
      input: {
        color: colors.foreground,
        fontSize: FONT_SIZE.small,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        minHeight: 60,
        backgroundColor: colors.surface1,
        textAlignVertical: "top" as const,
      },
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
  const awaiting = card.status === "Awaiting acceptance";

  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: liveColor }]} />
        <Text style={styles.id}>{card.id}</Text>
        <Chip theme={theme} text={card.status} color={awaiting ? colors.statusWarning : colors.foregroundMuted} />
        {card.complexity === null ? null : <Chip theme={theme} text={card.complexity} color={colors.foregroundMuted} />}
        {card.investigation ? <Chip theme={theme} text="investigation" color={colors.accent} /> : null}
        {card.ownerElsewhere === null ? null : <Chip theme={theme} text={`on ${card.ownerElsewhere}`} color={colors.foregroundMuted} />}
      </View>
      <Text style={styles.title}>{card.title}</Text>
      {card.lastStatus === null ? null : (
        <Text style={styles.status} numberOfLines={3}>
          {card.lastStatus.state}: {card.lastStatus.text} · {relativeTime(card.lastStatus.at)}
        </Text>
      )}
      {card.stalledReason === null ? null : (
        <Text style={styles.status} numberOfLines={3}>
          {card.stalledReason}
        </Text>
      )}
      {stats === null ? null : (
        <Text style={styles.muted} numberOfLines={1}>
          {formatDuration(stats.wallMs)} wall · {formatDuration(stats.agentActiveMs)} active · {stats.turns} turn{stats.turns === 1 ? "" : "s"} · {formatCost(stats.costUsd)}
        </Text>
      )}
      {card.children.length === 0 ? null : (
        <View style={{ gap: 4 }}>
          <Pressable onPress={() => setChildrenOpen((open) => !open)}>
            <Text style={styles.link}>
              {childrenOpen ? "▾" : "▸"} children {childrenDone}/{card.children.length} done
            </Text>
          </Pressable>
          {childrenOpen
            ? card.children.map((child) => (
                <Text key={child.id} style={styles.muted}>
                  {child.id} · {child.status} · {child.title}
                </Text>
              ))
            : null}
        </View>
      )}
      {card.decisions.map((decision) => (
        <DecisionCard key={decision.key} decision={decision} theme={theme} compact={compact} onAnswered={onChanged} />
      ))}
      {awaiting && owner !== null ? (
        changeText === null ? (
          <View style={styles.row}>
            <IconButton icon="Check" label="Accept" showLabel tone="accent" theme={theme} disabled={busy} onPress={() => void run(() => accept({ project, ticket: card.id }), `Accepted ${card.id}.`)} />
            <IconButton icon="MessageSquare" label="Request changes…" showLabel theme={theme} disabled={busy} onPress={() => setChangeText("")} />
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <TextInput value={changeText} onChangeText={setChangeText} placeholder="What should change?" placeholderTextColor={colors.foregroundMuted} multiline style={styles.input} />
            <View style={styles.row}>
              <IconButton
                icon="Send"
                label="Send changes"
                showLabel
                tone="accent"
                theme={theme}
                disabled={busy || changeText.trim() === ""}
                onPress={() => void run(async () => {
                  await changes({ project, ticket: card.id, text: changeText });
                  setChangeText(null);
                }, "Sent to the owner.")}
              />
              <IconButton icon="X" label="Cancel" showLabel theme={theme} onPress={() => setChangeText(null)} />
            </View>
          </View>
        )
      ) : null}
      {card.column === "stalled" ? (
        <View style={styles.row}>
          {owner !== null && owner.status !== "error" ? (
            <IconButton icon="Zap" label="Nudge" showLabel theme={theme} disabled={busy} onPress={() => void run(() => nudge({ agentId: owner.id }), "Nudged.")} />
          ) : null}
          <IconButton icon="RotateCcw" label="Relaunch" showLabel theme={theme} disabled={busy} onPress={() => void run(() => relaunch({ project, ticket: card.id }), "A fresh owner is starting.")} />
        </View>
      ) : null}
      {owner !== null && owner.contextUsedTokens !== null ? (
        <View style={styles.row}>
          <Text style={styles.muted}>context {formatTokenCount(owner.contextUsedTokens)}</Text>
          {owner.status === "idle" && owner.contextUsedTokens > 150_000 ? (
            <Pressable onPress={() => void run(() => compactRpc({ agentId: owner.id }), "Compacting after a handoff.")}>
              <Text style={styles.link}>Compact</Text>
            </Pressable>
          ) : null}
          {card.helpers.length === 0 ? null : <Text style={styles.muted}>· {card.helpers.length} helper{card.helpers.length === 1 ? "" : "s"}</Text>}
        </View>
      ) : null}
    </Pressable>
  );
}
