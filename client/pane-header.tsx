/** The strip above a conversation: who it is, and its buttons. */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { FONT_SIZE } from "./type-scale";

export function PaneHeader({ theme, title, children }: { theme: PluginTheme; title: string; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Icon name="Bot" size={14} color={theme.colors.foregroundMuted} />
      <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" }} numberOfLines={1}>
        {title}
      </Text>
      {children}
    </View>
  );
}
