/** The fixed top bar of a full page (TR-203, TR-205): an icon-only back arrow and the title, outside the page's scroll view. */
import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";

import { SPACE } from "./spacing";
import { FONT_SIZE } from "./type-scale";
import { IconButton } from "./ui";

export function TopBar({
  theme,
  title,
  backLabel,
  onBack,
  disabled = false,
}: {
  theme: PluginTheme;
  title: string;
  /** Read out for the arrow, which shows no text: where it goes. */
  backLabel: string;
  /** Null when there is nowhere to go back to: the bar shows the title alone. */
  onBack: (() => void) | null;
  disabled?: boolean;
}) {
  const { colors } = theme;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.sm,
        paddingHorizontal: SPACE.lg,
        paddingVertical: SPACE.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.surface0,
      }}
    >
      {onBack === null ? null : <IconButton theme={theme} icon="ArrowLeft" label={backLabel} disabled={disabled} onPress={onBack} />}
      <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: FONT_SIZE.heading, fontWeight: "700" }}>
        {title}
      </Text>
    </View>
  );
}
