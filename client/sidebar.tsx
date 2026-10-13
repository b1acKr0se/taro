/** The sidebar row: Taro, opening the screen. */
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";

import { TARO_SCREEN_ID } from "./screen";

export function TaroSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="ClipboardList" active={currentScreen?.screenId === TARO_SCREEN_ID} onPress={() => openScreen({ screenId: TARO_SCREEN_ID })} />;
}
