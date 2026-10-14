/** The sidebar row: Taro, with a badge counting what waits on the user across projects. */
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";

import { useProjects } from "./queries";
import { TARO_SCREEN_ID } from "./screen";
import { useNeedsYouNotifications } from "./use-notifications";
import { FONT_SIZE } from "./type-scale";

export function TaroSidebarItem({ currentScreen, openScreen, theme }: PluginSidebarItemProps) {
  const projects = useProjects();
  // The sidebar row is drawn on every screen of the desktop app, so it is where a window listens.
  useNeedsYouNotifications();
  const waiting = (projects.data?.projects ?? []).reduce((total, summary) => total + summary.needsYou, 0);
  return (
    <SidebarRow
      icon="ClipboardList"
      active={currentScreen?.screenId === TARO_SCREEN_ID}
      onPress={() => openScreen({ screenId: TARO_SCREEN_ID })}
      trailing={
        waiting === 0 ? undefined : (
          <View style={{ minWidth: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: theme.colors.statusWarning, alignItems: "center" }}>
            <Text style={{ color: theme.colors.surface0, fontSize: FONT_SIZE.micro, fontWeight: "700" }}>{waiting}</Text>
          </View>
        )
      }
    />
  );
}
