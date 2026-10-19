/**
 * A question's options on a board or Inbox card (TR-045), in the agent's words and order, the
 * recommended one marked; options that only stand for typing ("Change…", "Other") are left out
 * (TR-061). Pressing one answers at once; one that asks for words ("Rename…") opens the full card
 * instead, where the reasoning is and the words can be typed.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { answerDecision } from "../shared/contracts";
import { optionChips, type OptionChip } from "../shared/decision-view";
import type { StoredDecision } from "../shared/state";
import { CentredLabel } from "./centred-label";
import { controlColors } from "./control-colors";
import { Pressable } from "./focus";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, labelLineHeightFor } from "./type-scale";
import { Spinner } from "./ui";
import { decisionCall, optionPress } from "./shared-presses";
import { useActions } from "./use-actions";

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
  const answer = useRpc(answerDecision);
  // One guard for every chip, shared with the same question in the chat and the Ticket tab (TR-191): it takes one answer.
  const presses = useActions(decisionCall(decision));
  // Stays set: the chips remain off until the board reloads without this question, so a second tap cannot answer it again.
  const [answered, setAnswered] = useState(false);
  const chips = useMemo(() => optionChips(decision), [decision]);
  const { colors } = theme;
  const control = useMemo(() => controlColors(colors), [colors]);
  const styles = useMemo(
    () => ({
      // Wraps rather than scrolls: every answer stays in view, however many there are.
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.xs },
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.xs,
        maxWidth: "100%" as const,
        paddingHorizontal: SPACE.sm,
        paddingVertical: SPACE.xxs + 1,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: control.border,
        backgroundColor: control.fill,
      },
      recommended: { borderColor: control.accentBorder, backgroundColor: withAlpha(colors.accent, 0.1) },
      label: { flexShrink: 1, color: colors.foreground, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption) },
    }),
    [colors, control],
  );
  if (chips.length === 0) return null;

  function press(chip: OptionChip): void {
    if (chip.asksForWords) {
      onOpen();
      return;
    }
    presses.press(optionPress(chip.label), () => answer({ key: decision.key, label: chip.label, text: "", from: "screen" }), {
      after: "hold",
      onSuccess: () => {
        setAnswered(true);
        onAnswered();
      },
    });
  }

  return (
    <View style={styles.row}>
      {chips.map((chip, index) => {
        const busy = presses.stateOf(optionPress(chip.label)) === "busy";
        const off = presses.busy || answered;
        return (
          <Pressable
            key={`${index}:${chip.label}`}
            accessibilityRole="button"
            accessibilityLabel={`${chip.asksForWords ? "Open to answer" : "Answer"}: ${chip.label}${chip.recommended ? " (recommended)" : ""}`}
            accessibilityState={{ busy, disabled: off }}
            disabled={off}
            style={[styles.chip, chip.recommended ? styles.recommended : null, off && !busy ? { opacity: 0.5 } : null]}
            onPress={() => press(chip)}
          >
            {busy ? <Spinner size={12} color={colors.foregroundMuted} /> : chip.recommended ? <Icon name="Star" size={11} color={colors.accent} /> : null}
            <CentredLabel style={styles.label} numberOfLines={1}>
              {chip.label}
            </CentredLabel>
          </Pressable>
        );
      })}
    </View>
  );
}
