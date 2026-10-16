/**
 * A card that has been dealt with (TR-149), left in the chat where the live card was: what was
 * asked, how it ended, when, and the user's own words. One style for plans, deliveries, questions
 * and permission asks. Bordered like a live card but without its accent, so it reads as a record.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import type { FinishedTone } from "./finished-cards";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { SPACE } from "./spacing";

export type { FinishedTone };

/** The most lines of the user's words shown; the rest is in the ticket. */
const WORDS_LINES = 6;
const OUTCOME_ICON = { positive: "CircleCheck", warning: "TriangleAlert", negative: "CircleX", neutral: "Circle" } as const;

export function FinishedCard({
  theme,
  compact,
  icon,
  kind,
  subject = null,
  outcome,
  tone,
  time = null,
  words = null,
  actions = null,
  accessibilityLabel,
}: {
  theme: PluginTheme;
  compact: boolean;
  /** The kind's icon, beside its label. */
  icon: string;
  /** "Plan", "Acceptance", "Question", "Permission". */
  kind: string;
  /** The thing asked: a plan's ticket, the question, the command. */
  subject?: string | null;
  outcome: string;
  tone: FinishedTone;
  time?: string | null;
  /** What the user typed with the answer. */
  words?: string | null;
  /** Buttons at the foot (View plan). */
  actions?: ReactNode;
  accessibilityLabel?: string;
}) {
  const { colors } = theme;
  const toneColor = tone === "positive" ? colors.accent : tone === "warning" ? colors.statusWarning : tone === "negative" ? colors.statusDanger : colors.foregroundMuted;
  const label = accessibilityLabel ?? [kind, subject, outcome, time].filter((part) => part !== null && part !== "").join(", ");
  return (
    <View
      // Grouped for a screen reader only without buttons, which must stay reachable.
      accessible={actions === null}
      accessibilityLabel={actions === null ? label : undefined}
      style={{ alignSelf: "stretch", borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface1, padding: compact ? 10 : 12, gap: SPACE.sm }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
        <Icon name={icon} size={13} color={colors.foregroundMuted} />
        <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small), fontWeight: "600" }}>{kind}</Text>
      </View>
      {subject === null || subject === "" ? null : <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) }}>{subject}</Text>}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm }}>
        <View style={{ height: lineHeightFor(FONT_SIZE.small), justifyContent: "center" }}>
          <Icon name={OUTCOME_ICON[tone]} size={13} color={toneColor} />
        </View>
        <Text style={{ flex: 1, color: toneColor, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small), fontWeight: "600" }}>
          {outcome}
          {time === null ? null : <Text style={{ color: colors.foregroundMuted, fontWeight: "400" }}>{`  ${time}`}</Text>}
        </Text>
      </View>
      {words === null || words === "" ? null : (
        <Text numberOfLines={WORDS_LINES} style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small), fontStyle: "italic" }}>
          {`“${words}”`}
        </Text>
      )}
      {actions === null ? null : <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm }}>{actions}</View>}
    </View>
  );
}
