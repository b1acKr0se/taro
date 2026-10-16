/**
 * A card that has been dealt with (TR-149), left in the chat where the live card was. TR-159 drew it as
 * one quiet line rather than a card, so it reads as a record between messages: a toned mark, how it
 * ended, when, and what was asked; the user's own words quoted under it. One style for plans,
 * deliveries, questions and permission asks.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";

import type { FinishedTone } from "./finished-cards";
import { Pressable } from "./focus";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { SPACE } from "./spacing";
import { MONOSPACE } from "./ui";

export type { FinishedTone };

/** The most lines of the user's words shown; the rest is in the ticket. */
const WORDS_LINES = 6;
const MARK_SIZE = 13;
const TONE_MARK = { positive: "Check", warning: "Pencil", negative: "X", neutral: "Minus" } as const;
const LINE_HEIGHT = lineHeightFor(FONT_SIZE.small);

export function FinishedCard({
  theme,
  lead = null,
  subject = null,
  code = false,
  outcome,
  tone,
  time = null,
  words = null,
  action = null,
}: {
  theme: PluginTheme;
  /** Named before the subject, telling a question from a permission ask: "Question", "Permission". */
  lead?: string | null;
  /** The thing asked: a plan's ticket, the question, the command. */
  subject?: string | null;
  /** The subject is a command, drawn in monospace. */
  code?: boolean;
  outcome: string;
  tone: FinishedTone;
  time?: string | null;
  /** What the user typed with the answer, quoted under the line with its line breaks. */
  words?: string | null;
  /** A link at the line's end (View plan). */
  action?: { label: string; onPress: () => void } | null;
}) {
  const { colors } = theme;
  const toneColor = tone === "positive" ? colors.statusSuccess : tone === "warning" ? colors.statusWarning : tone === "negative" ? colors.statusDanger : colors.foregroundMuted;
  const hasSubject = subject !== null && subject !== "";
  const label = [outcome, time, lead, subject].filter((part) => part !== null && part !== "").join(", ");
  return (
    <View style={{ alignSelf: "stretch", gap: SPACE.xs }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm }}>
        {/* Grouped for a screen reader apart from the link, which must stay reachable. */}
        <View accessible accessibilityLabel={label} style={{ flex: 1, flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm }}>
          <View style={{ height: LINE_HEIGHT, justifyContent: "center" }}>
            <Icon name={TONE_MARK[tone]} size={MARK_SIZE} color={toneColor} />
          </View>
          <Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: LINE_HEIGHT }}>
            <Text style={{ color: toneColor, fontWeight: "600" }}>{outcome}</Text>
            {time === null ? null : ` · ${time}`}
            {hasSubject ? ` — ${lead === null ? "" : `${lead}: `}` : null}
            {hasSubject ? <Text style={code ? { fontFamily: MONOSPACE, fontSize: FONT_SIZE.code - 1, color: colors.foreground } : undefined}>{subject}</Text> : null}
          </Text>
        </View>
        {action === null ? null : (
          <Pressable accessibilityRole="link" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xxs, height: LINE_HEIGHT }}>
            <Text style={{ color: colors.accent, fontSize: FONT_SIZE.small, lineHeight: LINE_HEIGHT }}>{action.label}</Text>
            <Icon name="ChevronRight" size={12} color={colors.accent} />
          </Pressable>
        )}
      </View>
      {words === null || words === "" ? null : (
        <View style={{ marginLeft: MARK_SIZE + SPACE.sm, paddingLeft: SPACE.md - 2, borderLeftWidth: 2, borderLeftColor: colors.border }}>
          <Text numberOfLines={WORDS_LINES} style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: LINE_HEIGHT }}>
            {`“${words}”`}
          </Text>
        </View>
      )}
    </View>
  );
}
