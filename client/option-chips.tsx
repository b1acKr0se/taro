/**
 * A question's options on a board or Inbox card (TR-045), in the agent's words and order, the
 * recommended one marked. Pressing one answers at once; one that asks for words ("Change…") opens the
 * full card instead, where the reasoning is and the words can be typed.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { answerDecision } from "../shared/contracts";
import { optionChips, type OptionChip } from "../shared/decision-view";
import type { StoredDecision } from "../shared/state";
import { errorText } from "./format";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE } from "./type-scale";
import { Spinner } from "./ui";

export function OptionChips({
  decision,
  theme,
  onOpen,
  onAnswered,
}: {
  decision: StoredDecision;
  theme: PluginTheme;
  /** Opens the full card, for an option that asks for words. */
  onOpen: () => void;
  onAnswered: () => void;
}) {
  const toast = useToast();
  const answer = useRpc(answerDecision);
  const [sending, setSending] = useState<string | null>(null);
  const chips = useMemo(() => optionChips(decision), [decision]);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      // Wraps rather than scrolls: every answer stays in view, however many there are.
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.xs + 2 },
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.xs,
        maxWidth: "100%" as const,
        paddingHorizontal: SPACE.sm + 2,
        paddingVertical: SPACE.xs,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      recommended: { borderColor: withAlpha(colors.accent, 0.6), backgroundColor: withAlpha(colors.accent, 0.08) },
      label: { flexShrink: 1, color: colors.foreground, fontSize: FONT_SIZE.small },
    }),
    [colors],
  );
  if (chips.length === 0) return null;

  function press(chip: OptionChip): void {
    if (chip.asksForWords) {
      onOpen();
      return;
    }
    setSending(chip.label);
    answer({ key: decision.key, label: chip.label, text: "", from: "screen" }).then(
      () => {
        setSending(null);
        onAnswered();
      },
      (caught: unknown) => {
        setSending(null);
        toast.error(errorText(caught));
      },
    );
  }

  return (
    <View style={styles.row}>
      {chips.map((chip, index) => {
        const busy = sending === chip.label;
        return (
          <Pressable
            key={`${index}:${chip.label}`}
            accessibilityRole="button"
            accessibilityLabel={`${chip.asksForWords ? "Open to answer" : "Answer"}: ${chip.label}${chip.recommended ? " (recommended)" : ""}`}
            accessibilityState={{ busy, disabled: sending !== null }}
            disabled={sending !== null}
            style={[styles.chip, chip.recommended ? styles.recommended : null, sending !== null && !busy ? { opacity: 0.5 } : null]}
            onPress={() => press(chip)}
          >
            {busy ? <Spinner size={12} color={colors.foregroundMuted} /> : chip.recommended ? <Icon name="Star" size={11} color={colors.accent} /> : null}
            <Text style={styles.label} numberOfLines={1}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
