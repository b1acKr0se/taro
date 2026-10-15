/**
 * An open question as a card in a ticket card's language (TR-045): the manager's in Needs you, every
 * agent's in the Inbox. Who asked, then the question in the asker's words (three lines, then cut),
 * whether it blocks and how long ago, its options as chips that answer at once, and Answer, which
 * opens the full card with the reasoning and room to type.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";

import type { StoredDecision } from "../shared/state";
import { questionContext } from "./card-now";
import { CentredLabel } from "./centred-label";
import { controlColors } from "./control-colors";
import { Pressable } from "./focus";
import { OptionChips } from "./option-chips";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";
import { useNow } from "./use-now";

export function QuestionCard({
  decision,
  asker,
  theme,
  compact,
  onOpen,
  onAnswered,
}: {
  decision: StoredDecision;
  /** Who asked, where a ticket card has its id: "The manager", or the project, ticket and agent. */
  asker: string;
  theme: PluginTheme;
  compact: boolean;
  /** Opens the full card where it is answered. */
  onOpen: () => void;
  onAnswered: () => void;
}) {
  const now = useNow();
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: compact ? SPACE.md : SPACE.lg - 2, gap: SPACE.sm, backgroundColor: colors.surface0 },
      head: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm },
      dot: { width: 8, height: 8, borderRadius: 4 },
      asker: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      line: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: SPACE.sm },
      lineIcon: { width: 14, paddingTop: (lineHeightFor(FONT_SIZE.body) - 13) / 2 },
      lineText: { flex: 1, minWidth: 0, gap: SPACE.xs },
      question: { color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const, lineHeight: lineHeightFor(FONT_SIZE.body) },
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
        // At 45% the accent fell to about 1.5:1 on the card in dark themes (TR-093).
        borderColor: controlColors(colors).accentBorder,
        backgroundColor: withAlpha(colors.accent, 0.1),
      },
      actionText: { color: colors.accent, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), fontWeight: "600" as const },
    }),
    [colors, compact],
  );
  const context = questionContext(decision, now);
  const tone = decision.blocking ? colors.statusWarning : colors.foregroundMuted;

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${asker} asks: ${decision.question}`} onPress={onOpen} style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text style={styles.asker} numberOfLines={1}>
          {asker}
        </Text>
      </View>
      <View style={styles.line}>
        <View style={styles.lineIcon}>
          <Icon name="Hand" size={13} color={tone} />
        </View>
        <View style={styles.lineText}>
          <Text style={styles.question} numberOfLines={3}>
            {decision.question}
          </Text>
          {context === null ? null : <Text style={styles.detail}>{context}</Text>}
        </View>
      </View>
      {/* Buttons start at the card's left edge, under the asker, not under the question (TR-089). */}
      <OptionChips decision={decision} theme={theme} onOpen={onOpen} onAnswered={onAnswered} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Answer: ${decision.question}`} style={styles.action} onPress={onOpen}>
        <CentredLabel style={styles.actionText}>Answer</CentredLabel>
        <Icon name="ArrowRight" size={12} color={colors.accent} />
      </Pressable>
    </Pressable>
  );
}
