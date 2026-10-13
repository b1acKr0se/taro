/** The strip above a conversation: who it is, and its buttons. */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { SPACE } from "./spacing";
import { FONT_SIZE } from "./type-scale";

export function PaneHeader({
  theme,
  title,
  subtitle,
  icon = "Bot",
  children,
}: {
  theme: PluginTheme;
  title: string;
  /** A muted line under the title: whose conversation it is and whether it still runs. */
  subtitle?: string | undefined;
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
        paddingHorizontal: SPACE.lg,
        paddingVertical: SPACE.md,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />
      <View style={{ flex: 1, gap: SPACE.xxs }}>
        <Text style={{ color: theme.colors.foreground, fontSize: FONT_SIZE.subtitle, fontWeight: "600" }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.caption }} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}
