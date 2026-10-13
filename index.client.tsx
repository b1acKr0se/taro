import type { PluginClientContext, PluginWorkspaceCommandContext } from "@getpaseo/plugin/client";

import { tellManager } from "./shared/contracts";
import { TARO_SCREEN_ID } from "./client/screen";
import { TaroScreen } from "./client/taro-screen";
import { TaroSidebarItem } from "./client/sidebar";

type CommandRpc = PluginWorkspaceCommandContext["rpc"];

/** `/taro <project> <message>` — an async function, not an arrow (Hermes; see the Paseo plugin notes). */
async function tellProjectManager(rpc: CommandRpc, args: string): Promise<void> {
  const match = /^\s*([a-z0-9][a-z0-9-]*)\s+([\s\S]+)$/.exec(args);
  if (match === null || match[1] === undefined || match[2] === undefined) throw new Error("Usage: /taro <project> <message>");
  await rpc(tellManager, { project: match[1], text: match[2] });
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: TARO_SCREEN_ID,
    title: (params) => (params.project === undefined ? "Taro" : `Taro · ${params.project}`),
    Component: TaroScreen,
  });
  client.addSidebarHeaderItem({ id: TARO_SCREEN_ID, title: "Taro", Component: TaroSidebarItem });

  client.addCommandCenterItem({
    id: "open-taro",
    title: "Open Taro",
    icon: "ClipboardList",
    keywords: ["taro", "board", "tickets", "manager"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: TARO_SCREEN_ID });
    },
  });

  client.addSlashCommand({
    name: "taro",
    description: "Tell a Taro project's manager",
    argumentHint: "<project> <message>",
    context: "workspace",
    onSubmit({ args, rpc }) {
      return tellProjectManager(rpc, args);
    },
  });

  return () => {};
}
