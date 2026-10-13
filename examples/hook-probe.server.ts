/**
 * The throwaway plugin that verified the hooks the design relies on (Paseo 0.11.2,
 * 2026-10-13): `agent.turn_ended` carries the full final assistant message and the subagent's
 * `parentAgentId`; `before` hooks see the working directory and title (not labels); env set in
 * `before("agent.session_open")` reaches the agent and overrides `agent.create`'s.
 */
import { appendFileSync } from "node:fs";
import type { PluginServerContext } from "@getpaseo/plugin/server";

const EVENT_LOG = "/tmp/taro-probe/events.jsonl";
const PROBE_ROOT = "/tmp/taro-probe";

function record(event: string, payload: unknown) {
  appendFileSync(EVENT_LOG, JSON.stringify({ at: new Date().toISOString(), event, payload }) + "\n");
}

export default function contribute(server: PluginServerContext) {
  const removers = [
    server.before("agent.create", ({ request }) => {
      record("before.agent.create", { cwd: request.config.cwd, title: request.config.title, env: request.env ?? null });
      if (!request.config.cwd.startsWith(PROBE_ROOT)) return;
      return { ...request, env: { ...(request.env ?? {}), TARO_PROBE_MARKER: "injected-by-plugin" } };
    }),
    server.before("agent.session_open", ({ request }) => {
      record("before.agent.session_open", { agentId: request.agentId, cwd: request.cwd, reason: request.reason, envKeys: Object.keys(request.env) });
      if (!request.cwd.startsWith(PROBE_ROOT)) return;
      return { ...request, env: { ...request.env, TARO_PROBE_MARKER: "injected-on-open" } };
    }),
    server.on("agent.created", ({ agent }) => {
      record("agent.created", agent);
    }),
    server.on("agent.turn_ended", ({ agent, outcome, timeline }) => {
      if (!agent.cwd.startsWith(PROBE_ROOT)) return;
      const assistantMessages = timeline
        .filter((item) => item.type === "assistant_message")
        .map((item) => (item as { text?: string }).text ?? null);
      record("agent.turn_ended", {
        agent,
        outcome,
        timelineLength: timeline.length,
        timelineTypes: timeline.map((item) => item.type),
        assistantMessages,
      });
    }),
  ];
  record("plugin.started", {});
  return () => {
    for (const remove of removers) remove();
  };
}
