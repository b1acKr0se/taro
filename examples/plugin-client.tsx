/**
 * Sketch: the client contributions the UI design needs (Paseo 0.11 plugin API,
 * types from @getpaseo/plugin/client). Not wired up or
 * tested; component bodies are placeholders. Structure follows FirstMate's
 * index.client.tsx (MIT), adapted to one screen with per-project params.
 */
import type { PluginClientContext } from "@getpaseo/plugin/client";

import { TaroScreen } from "./client/taro-screen";
import { TaroSidebarItem } from "./client/sidebar";
import { TicketPanel } from "./client/ticket-panel";
import { TaroSettings } from "./client/settings";
import { tellManager, askManager } from "./client/manager-send";

const TARO_SCREEN_ID = "taro";

export default function contribute(client: PluginClientContext) {
  // One screen. params: { project?: string, ticket?: string, view?: "inbox" | "setup" | "settings" }.
  client.addScreen({
    id: TARO_SCREEN_ID,
    title: (params) => (params.project ? `Taro · ${params.project}` : "Taro"),
    Component: TaroScreen,
  });

  // Sidebar row with the total "needs you" count across projects.
  client.addSidebarHeaderItem({ id: TARO_SCREEN_ID, title: "Taro", Component: TaroSidebarItem });

  // The ticket beside a task owner: status, criteria, approval, delivery,
  // milestones, and Accept / Request changes.
  client.addWorkspacePanel({
    id: "taro-ticket",
    title: "Ticket",
    icon: "ClipboardList",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: TicketPanel,
  });

  client.addSettingsScreen({ id: "taro", title: "Taro", icon: "ClipboardList", Component: TaroSettings });

  client.addCommandCenterItem({
    id: "open-taro",
    title: "Open Taro",
    icon: "ClipboardList",
    keywords: ["taro", "board", "tickets", "inbox"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: TARO_SCREEN_ID });
    },
  });

  // `/taro <message>` from any workspace goes to the manager of that workspace's project.
  client.addSlashCommand({
    name: "taro",
    description: "Tell this project's Taro manager",
    argumentHint: "<message>",
    context: "workspace",
    onSubmit({ args, rpc, workspace }) {
      return tellManager(rpc, workspace, args);
    },
  });

  for (const command of ["bearings", "ahoy"] as const) {
    client.addSlashCommand({
      name: command,
      description: command === "bearings" ? "Taro: where this project stands" : "Taro: what happened, and what needs your call",
      argumentHint: "",
      context: "workspace",
      onSubmit({ rpc, workspace, openScreen }) {
        openScreen({ screenId: TARO_SCREEN_ID });
        return askManager(rpc, workspace, command);
      },
    });
  }
}

/*
 * Inside TaroScreen:
 *   - props.layout.compact switches to the phone layout (Manager · Inbox · Board tabs).
 *   - props.navigation?.openAgent({ agentId }) backs "Open in Paseo ↗"; hide it when
 *     navigation is undefined (older hosts).
 *   - board data comes from a server RPC that joins the tracker's tickets
 *     with live agents found by label (project, ticket, role) and boardColumn()
 *     (examples/board-columns.ts).
 */
