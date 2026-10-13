/**
 * What an agent asks of the user, pinned above its chat (TR-022): its open decisions. The board only
 * names them in one line; they are answered here, beside the conversation that explains them. Folds
 * to its heading. A delivered ticket's acceptance sits at the composer instead (`acceptance-row.tsx`).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { parseDecisionBlocks } from "../shared/reports";
import type { StoredDecision } from "../shared/state";
import { DecisionCard } from "./decision-card";
import { SPACE } from "./spacing";
import { FONT_SIZE } from "./type-scale";
import { walkOrder } from "./walk-order";

export function AsksYou({
  decisions,
  theme,
  compact,
  onChanged,
}: {
  decisions: readonly StoredDecision[];
  theme: PluginTheme;
  compact: boolean;
  onChanged: () => void;
}) {
  const [folded, setFolded] = useState(false);
  const ordered = useMemo(() => walkOrder(decisions), [decisions]);
  const { colors } = theme;
  const count = ordered.length;
  if (count === 0) return null;
  const blocking = ordered.some((decision) => decision.blocking);
  const color = blocking ? colors.statusWarning : colors.foregroundMuted;
  const inset = compact ? SPACE.md : SPACE.lg;
  return (
    // At most about half the pane, so the conversation that explains the question stays in view.
    <View style={{ maxHeight: "55%", borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !folded }}
        onPress={() => setFolded((value) => !value)}
        style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingHorizontal: inset, paddingVertical: SPACE.sm }}
      >
        <Icon name="Hand" size={14} color={color} />
        <Text style={{ flex: 1, color, fontSize: FONT_SIZE.micro, fontWeight: "700", letterSpacing: 0.5 }}>ASKS YOU · {count}</Text>
        <Icon name={folded ? "ChevronDown" : "ChevronUp"} size={14} color={colors.foregroundMuted} />
      </Pressable>
      {folded ? null : (
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingHorizontal: inset, paddingBottom: SPACE.md, gap: SPACE.sm }}>
          {ordered.map((decision) => (
            <DecisionCard key={decision.key} decision={decision} theme={theme} compact={compact} onAnswered={onChanged} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Where a message asked one of the pinned decisions: a line pointing up at it, in place of a
 * second copy of the card. Nothing for a message whose decisions are no longer open.
 */
export function AskedHere({ text, open, theme }: { text: string; open: readonly StoredDecision[]; theme: PluginTheme }) {
  const asked = parseDecisionBlocks(text)
    .map((block) => open.find((decision) => decision.id === block.id))
    .filter((decision) => decision !== undefined);
  if (asked.length === 0) return null;
  return (
    <View style={{ gap: SPACE.xs }}>
      {asked.map((decision) => (
        <View key={decision.key} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
          <Icon name="ArrowUp" size={13} color={theme.colors.statusWarning} />
          <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small }} numberOfLines={2}>
            Asked you: {decision.question} · answer it above
          </Text>
        </View>
      ))}
    </View>
  );
}
