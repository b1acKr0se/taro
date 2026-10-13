/**
 * Paseo types, projected out of `@getpaseo/plugin` — the one package the host
 * provides at runtime. Never import `@getpaseo/client` or `@getpaseo/protocol`
 * from reachable code: an npm install omits them and the daemon refuses the
 * plugin (see `host-imports.test.ts`). Pattern from FirstMate (MIT).
 */
import type { PluginHandlerContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";

export type PaseoApi = PluginHandlerContext["paseo"];

export type PaseoAgent = Awaited<ReturnType<PaseoApi["agents"]["list"]>>["entries"][number]["agent"];

export type AgentListOptions = NonNullable<Parameters<PaseoApi["agents"]["list"]>[0]>;

export type TimelinePage = Awaited<ReturnType<ReturnType<PaseoApi["agents"]["ref"]>["timeline"]["refetch"]>>;

export type TimelineItem = PluginLifecycleEvents["agent.turn_ended"]["timeline"][number];

export type HookAgent = PluginLifecycleEvents["agent.turn_ended"]["agent"];

export type TurnOutcome = PluginLifecycleEvents["agent.turn_ended"]["outcome"];
