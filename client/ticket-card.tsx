/**
 * One ticket on the board (decision 10, TR-026, TR-031): id, phase and live dot, the title, what is
 * happening now (`card-now.ts`: a headline read whole, a muted detail under it, and the action on its
 * own line, all in one column beside the icon), children folded to one line, and one muted footer
 * (complexity, context, subagents, PR, and Compact when it applies). An ask is in the asker's words
 * (TR-045): a question with its options as chips that answer at once, what a permission asks to do, a
 * delivery's summary with Accept and Request changes as one pair; a scope approval with a template plan
 * is the compact plan card instead (TR-061). Once finished: what it was and what it cost.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { acceptTicket, compactAgent, nudgeAgent, pauseTicket, relaunchOwner, resumeTicket, type Card, type StatsSummary } from "../shared/contracts";
import { PhaseBadge } from "./badges";
import { cardFooterParts, cardNowLine, offersCompact, type NowLine } from "./card-now";
import { CentredLabel } from "./centred-label";
import { controlColors } from "./control-colors";
import { Pressable } from "./focus";
import { errorText, formatCost, pullRequestLabel, formatDuration } from "./format";
import { SPACE } from "./spacing";
import { OptionChips } from "./option-chips";
import { PlanDecision } from "./plan-card";
import { withAlpha } from "./tint";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";
import { AcceptancePair, IconButton } from "./ui";
import { useActions } from "./use-actions";
import { useNow } from "./use-now";
import { phaseLook, statusStateLook, toneColor } from "./visual-meta";

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
  const accept = useRpc(acceptTicket);
  const pause = useRpc(pauseTicket);
  const resume = useRpc(resumeTicket);
  const actions = useActions();
  const busy = actions.busy;
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
      // The icon keeps a column of its own, so a wrapped headline, its detail and the action all start at one edge.
      line: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: SPACE.sm },
      lineIcon: { width: 14, paddingTop: (lineHeightFor(FONT_SIZE.small) - 13) / 2 },
      lineText: { flex: 1, minWidth: 0, gap: SPACE.xxs },
      headline: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      strong: { color: colors.foreground, fontWeight: "600" as const },
      danger: { color: colors.statusDanger, fontWeight: "600" as const },
      detail: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
      now: { gap: SPACE.sm },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm },
      action: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.xs,
        paddingHorizontal: SPACE.sm,
        paddingVertical: SPACE.xxs,
        borderRadius: 6,
        borderWidth: 1,
        // At 45% the accent fell to about 1.5:1 on the card in dark themes (TR-093).
        borderColor: controlColors(colors).accentBorder,
        backgroundColor: withAlpha(colors.accent, 0.1),
      },
      dot: { width: 8, height: 8, borderRadius: 4 },
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm, alignItems: "center" as const },
      muted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      link: { color: colors.accent, fontSize: FONT_SIZE.caption },
      track: { width: 44, height: 3, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" as const },
      childRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: SPACE.sm },
      childIcon: { width: 14, paddingTop: (lineHeightFor(FONT_SIZE.caption) - 13) / 2 },
      footer: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: SPACE.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: SPACE.sm },
      actionText: { color: colors.accent, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), fontWeight: "600" as const },
    }),
    [colors, compact, selected],
  );

  const owner = card.owner;
  // A queued child's owner is its parent's, busy with other work (TR-080).
  const liveColor =
    owner === null || card.column === "queued"
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
  const hasFooter = footer.length > 0 || card.pullRequest !== null || compactOffered || card.pausable;
  // What Pause and Resume did is the server's to say: paused at once, pausing, started or queued (TR-088).
  const told = (result: { message: string }) => {
    toast.show(result.message, { variant: "success" });
    onChanged();
  };

  function lineLook(line: NowLine): { icon: string; color: string; headline: object | null } {
    switch (line.kind) {
      case "call": {
        const call = line.call;
        if (call.kind === "decision") return { icon: "Hand", color: call.decision.blocking ? colors.statusWarning : colors.foregroundMuted, headline: styles.strong };
        if (call.kind === "permission") return { icon: "KeyRound", color: colors.statusWarning, headline: styles.strong };
        return call.ready ? { icon: "PackageCheck", color: colors.accent, headline: styles.strong } : { icon: "PackageX", color: colors.statusWarning, headline: styles.strong };
      }
      case "stalled":
        return { icon: "CircleAlert", color: colors.statusDanger, headline: styles.danger };
      case "pause":
        return { icon: line.state === "queued-to-resume" ? "Clock" : "Pause", color: colors.foregroundMuted, headline: styles.strong };
      case "accepted":
        return { icon: "GitMerge", color: colors.statusSuccess, headline: styles.strong };
      case "subagent":
        return { icon: "Hourglass", color: colors.statusSuccess, headline: { color: colors.foreground } };
      case "working":
        return { icon: "Activity", color: colors.statusSuccess, headline: { color: colors.foreground } };
      case "milestone":
        return { icon: "Flag", color: colors.foregroundMuted, headline: null };
      case "elsewhere":
        return { icon: "Monitor", color: colors.foregroundMuted, headline: null };
      case "status": {
        const status = statusStateLook(line.state);
        return { icon: status.icon, color: toneColor(theme, status.tone), headline: null };
      }
    }
  }

  function nowRow(line: NowLine) {
    const look = lineLook(line);
    // Past the crash limit (a recorded reason) a nudge cannot help; only a fresh owner can.
    const nudgeable = owner !== null && owner.status !== "error" && card.stalledReason === null;
    return (
      <View style={styles.now}>
        <View style={styles.line}>
          <View style={styles.lineIcon}>
            <Icon name={look.icon} size={13} color={look.color} />
          </View>
          <View style={styles.lineText}>
            {/* Read whole: a long status wraps; six lines keep one card from filling the column. A question gets three, its options follow. */}
            <Text style={[styles.headline, look.headline]} numberOfLines={line.kind === "call" && line.call.kind === "decision" ? 3 : 6}>
              {line.headline}
            </Text>
            {line.detail === null ? null : (
              <Text style={styles.detail} numberOfLines={3}>
                {line.detail}
              </Text>
            )}
          </View>
        </View>
        {/* Buttons start at the card's left edge, under the id and title, not under the status text (TR-089). */}
        {line.kind === "call" && line.call.kind === "decision" ? (
          <OptionChips decision={line.call.decision} theme={theme} onOpen={onOpen} onAnswered={onChanged} />
        ) : null}
        {line.kind === "call" && line.call.kind === "acceptance" && line.call.ready ? (
          // Request changes opens the ticket, where its owner's chat holds the field to write them in.
          <AcceptancePair
            theme={theme}
            busy={busy}
            acceptState={actions.stateOf("accept")}
            requestLabel="Request changes"
            // The accepted ticket leaves this call, so Accept stays busy until it does.
            onAccept={() => actions.press("accept", () => accept({ project, ticket: card.id }), { after: "hold", success: `Accepted ${card.id}.`, onSuccess: onChanged })}
            onRequestChanges={onOpen}
          />
        ) : line.kind === "call" ? (
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${line.action}: ${line.headline}`} style={styles.action} onPress={onOpen}>
              <CentredLabel style={styles.actionText}>{line.action}</CentredLabel>
              <Icon name="ArrowRight" size={12} color={colors.accent} />
            </Pressable>
          </View>
        ) : null}
        {line.kind === "pause" && line.state === "paused" ? (
          <View style={styles.actions}>
            <IconButton
              icon="Play"
              label="Resume"
              showLabel
              theme={theme}
              disabled={busy}
              state={actions.stateOf("resume")}
              onPress={() => actions.press("resume", () => resume({ project, ticket: card.id }), { after: "hold", onSuccess: told })}
            />
          </View>
        ) : null}
        {line.kind === "stalled" ? (
          <View style={styles.actions}>
            {nudgeable ? (
              <IconButton
                icon="Zap"
                label="Nudge"
                showLabel
                theme={theme}
                disabled={busy}
                state={actions.stateOf("nudge")}
                onPress={() => actions.press("nudge", () => nudge({ agentId: owner.id }), { success: "Nudged.", onSuccess: onChanged })}
              />
            ) : null}
            <IconButton
              icon="RotateCcw"
              label="Relaunch"
              showLabel
              theme={theme}
              disabled={busy}
              state={actions.stateOf("relaunch")}
              onPress={() => actions.press("relaunch", () => relaunch({ project, ticket: card.id }), { success: "A fresh owner is starting.", onSuccess: onChanged })}
            />
          </View>
        ) : null}
      </View>
    );
  }

  const asked = nowLine !== null && nowLine.kind === "call" && nowLine.call.kind === "decision" ? nowLine.call.decision : null;
  const whole = (
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
                // A narrow column has no room for a badge beside the title: the status is its icon and colour in a
                // fixed column, so every id and title starts at one edge.
                <View key={child.id} style={styles.childRow} accessibilityLabel={`${child.id} ${child.title}, ${child.status}`}>
                  <View style={styles.childIcon}>
                    <Icon name={phaseLook(child.status).icon} size={13} color={toneColor(theme, phaseLook(child.status).tone)} />
                  </View>
                  <Text style={[styles.muted, { flex: 1, minWidth: 0, lineHeight: lineHeightFor(FONT_SIZE.caption) }]} numberOfLines={2}>
                    {child.id} · {child.title}
                  </Text>
                </View>
              ))
            : null}
        </View>
      )}
      {hasFooter ? (
        <View style={styles.footer}>
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
          {card.pausable ? (
            <IconButton
              icon="Pause"
              label="Pause"
              showLabel
              theme={theme}
              disabled={busy}
              state={actions.stateOf("pause")}
              onPress={() => actions.press("pause", () => pause({ project, ticket: card.id }), { after: "hold", onSuccess: told })}
            />
          ) : null}
          {compactOffered && owner !== null ? (
            <IconButton
              icon="Minimize2"
              label="Compact"
              showLabel
              theme={theme}
              disabled={busy}
              state={actions.stateOf("compact")}
              onPress={() => actions.press("compact", () => compactRpc({ agentId: owner.id }), { success: "Compacting after a handoff.", onSuccess: onChanged })}
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
  if (asked === null) return whole;
  // A scope approval with a template plan is the compact plan card, its ticket named on top (TR-061).
  return (
    <PlanDecision decision={asked} theme={theme} compact={compact} head={`${card.id} · ${card.title}`} onOpenHead={onOpen} brief onAnswered={onChanged}>
      {whole}
    </PlanDecision>
  );
}
