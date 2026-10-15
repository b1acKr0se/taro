/** The sidebar row: Taro, with a badge counting what waits on the user across projects. */
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";

import { CountBadge } from "./count-badge";
import { needsYouTotal } from "./count-badge-text";
import { useProjects } from "./queries";
import { TARO_SCREEN_ID } from "./screen";
import { useNeedsYouNotifications } from "./use-notifications";

export function TaroSidebarItem({ currentScreen, openScreen, theme }: PluginSidebarItemProps) {
  const projects = useProjects();
  // The sidebar row is drawn on every screen of the desktop app, so it is where a window listens.
  useNeedsYouNotifications();
  const waiting = needsYouTotal(projects.data?.projects ?? []);
  return (
    <SidebarRow
      icon="ClipboardList"
      active={currentScreen?.screenId === TARO_SCREEN_ID}
      onPress={() => openScreen({ screenId: TARO_SCREEN_ID })}
      trailing={waiting === 0 ? undefined : <CountBadge theme={theme} count={waiting} />}
    />
  );
}
