/**
 * A permission the Manager or one of its own subagents waits on, as a card at the top of Needs you
 * (TR-096), in a ticket card's language like the Manager's questions (`question-card.tsx`): who asks,
 * what it asks to do in its own words, how many more wait, and Review, which opens the agent that
 * asks, where Allow and Deny are.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";

import type { AgentAskView } from "../shared/contracts";
import { joined } from "./card-now";
import { CentredLabel } from "./centred-label";
import { Pressable } from "./focus";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";

/** Who asks on the Manager's side: the Manager itself, or one of its subagents by its job. */
export function managerAskerName(ask: Pick<AgentAskView, "role">): string {
  return ask.role === null || ask.role === "manager" || ask.role === "owner" ? "The Manager" : `The Manager's ${ask.role}`;
}

export function PermissionAskCard({ ask, theme, compact, onOpen }: { ask: AgentAskView; theme: PluginTheme; compact: boolean; onOpen: () => void }) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: compact ? SPACE.md : SPACE.lg - 2, gap: SPACE.sm, backgroundColor: colors.surface0 },
      head: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm },
      dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.statusWarning },
      asker: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      line: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: SPACE.sm },
      lineIcon: { width: 14, paddingTop: (lineHeightFor(FONT_SIZE.body) - 13) / 2 },
      lineText: { flex: 1, minWidth: 0, gap: SPACE.xs },
      title: { color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const, lineHeight: lineHeightFor(FONT_SIZE.body) },
      detail: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
      action: {
        flexDirection: "row" as const,
        alignSelf: "flex-start" as const,
        alignItems: "center" as const,
        gap: SPACE.xs,
        paddingHorizontal: SPACE.sm,
        paddingVertical: SPACE.xxs,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: withAlpha(colors.accent, 0.45),
      },
      actionText: { color: colors.accent, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), fontWeight: "600" as const },
    }),
    [colors, compact],
  );
  const asker = managerAskerName(ask);
  const more = ask.count > 1 ? `${ask.count - 1} more permission${ask.count === 2 ? "" : "s"}` : null;
  const detail = joined([ask.detail, more]);

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${asker} is asking permission: ${ask.title}`} onPress={onOpen} style={styles.card}>
      <View style={styles.head}>
        <View style={styles.dot} />
        {/* The asker alone, as on the Manager's question cards: the key and Allow …? say it is a permission. */}
        <Text style={styles.asker} numberOfLines={2}>
          {asker}
        </Text>
      </View>
      <View style={styles.line}>
        <View style={styles.lineIcon}>
          <Icon name="KeyRound" size={13} color={colors.statusWarning} />
        </View>
        <View style={styles.lineText}>
          <Text style={styles.title} numberOfLines={3}>
            {ask.title}
          </Text>
          {detail === null ? null : (
            <Text style={styles.detail} numberOfLines={3}>
              {detail}
            </Text>
          )}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Review: ${ask.title}`} style={styles.action} onPress={onOpen}>
        <CentredLabel style={styles.actionText}>Review</CentredLabel>
        <Icon name="ArrowRight" size={12} color={colors.accent} />
      </Pressable>
    </Pressable>
  );
}
