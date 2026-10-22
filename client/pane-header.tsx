/** The strip above a conversation: who it is, and its buttons. */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { PANE_HEADER_HEIGHT, paneGutter, SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

export function PaneHeader({
  theme,
  title,
  subtitle,
  icon = "Bot",
  compact = false,
  leading,
  children,
}: {
  theme: PluginTheme;
  title: string;
  /** A muted line under the title: whose conversation it is and whether it still runs. */
  subtitle?: string | undefined;
  /** A phone: one slim row, so the conversation keeps the screen (TR-031). */
  compact?: boolean;
  /** Drawn in the icon's place: a phone's Back button, where a thumb looks for it. */
  leading?: ReactNode;
  /** A Lucide name drawn before the title. */
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.sm,
        paddingHorizontal: paneGutter(compact),
        ...(compact ? { paddingVertical: SPACE.xs + SPACE.xxs } : { height: PANE_HEADER_HEIGHT }),
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      {leading ?? (compact ? null : <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />)}
      <View style={{ flex: 1, minWidth: 0, gap: compact ? 0 : SPACE.xxs }}>
        <Text style={{ color: theme.colors.foreground, fontSize: compact ? FONT_SIZE.body : FONT_SIZE.subtitle, ...(compact ? {} : { lineHeight: lineHeightFor(FONT_SIZE.subtitle) }), fontWeight: "600" }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) }} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}
