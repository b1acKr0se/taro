/**
 * The notification-style pill counting what waits on the user (TR-123): one look for the Taro sidebar
 * row, the project tabs, the wide Inbox tab and the phone's Inbox segment. Draws nothing at zero.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { View } from "react-native";

import { CentredLabel } from "./centred-label";
import { countBadgeText } from "./count-badge-text";
import { SPACE } from "./spacing";
import { FONT_SIZE, labelLineHeightFor } from "./type-scale";

export function CountBadge({ theme, count, background }: { theme: PluginTheme; count: number; background?: string }) {
  const text = countBadgeText(count);
  if (text === null) return null;
  return (
    <View style={{ minWidth: 18, alignItems: "center", paddingHorizontal: SPACE.xs + 1, borderRadius: 9, backgroundColor: background ?? theme.colors.statusWarning }}>
      <CentredLabel style={{ color: theme.colors.surface0, fontSize: FONT_SIZE.micro, lineHeight: labelLineHeightFor(FONT_SIZE.micro), fontWeight: "700" }}>{text}</CentredLabel>
    </View>
  );
}
