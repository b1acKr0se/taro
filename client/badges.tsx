/**
 * Small pieces the board, the Ticket tab and the Inbox share: a ticket's phase badge (the same on a
 * card and in the Ticket tab, so a status reads the same everywhere) and a section heading with an icon.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE } from "./type-scale";
import { phaseLook, toneColor } from "./visual-meta";

export function PhaseBadge({ theme, status }: { theme: PluginTheme; status: string }) {
  const look = phaseLook(status);
  const color = toneColor(theme, look.tone);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        // In a narrow card the label shortens rather than pushing the badge out of it.
        flexShrink: 1,
        minWidth: 0,
        gap: SPACE.xs,
        paddingHorizontal: SPACE.sm,
        paddingVertical: SPACE.xxs,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: withAlpha(color, 0.45),
        backgroundColor: withAlpha(color, 0.12),
      }}
    >
      <Icon name={look.icon} size={12} color={color} />
      <Text style={{ flexShrink: 1, color, fontSize: FONT_SIZE.caption, fontWeight: "600" }} numberOfLines={1}>
        {status}
      </Text>
    </View>
  );
}

/** Small capitals over a section, after an icon. `children` sits at the row's right end. */
export function SectionHeading({
  theme,
  icon,
  text,
  color,
  children,
}: {
  theme: PluginTheme;
  icon: string;
  text: string;
  /** The icon's colour; the theme's muted colour by default. */
  color?: string;
  children?: ReactNode;
}) {
  const muted = theme.colors.foregroundMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
      <Icon name={icon} size={14} color={color ?? muted} />
      <Text style={{ flex: 1, color: muted, fontSize: FONT_SIZE.micro, fontWeight: "700", letterSpacing: 0.8 }}>{text.toUpperCase()}</Text>
      {children}
    </View>
  );
}
