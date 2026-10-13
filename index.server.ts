import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  acceptTicket,
  answerDecision,
  loadStats,
  catchUp,
  compactAgent,
  dismissSuggestion as dismissSuggestionRpc,
  findAgentTicket,
  listOpenDecisions,
  loadBoard as loadBoardRpc,
  loadTicket,
  nudgeAgent,
  relaunchOwner,
  requestChanges,
  resolveTrackerSync as resolveTrackerSyncRpc,
  tellAgent,
  checkPrerequisites as checkPrerequisitesRpc,
  compactManager as compactManagerRpc,
  launchManager as launchManagerRpc,
  listModels,
  listProjects,
  onboardProject as onboardProjectRpc,
  readProjectConfig as readProjectConfigRpc,
  readStandingOrders,
  restartManager as restartManagerRpc,
  tellManager as tellManagerRpc,
  writeProjectSettings,
  writeStandingOrders,
} from "./shared/contracts";
import { ProjectSettingsSchema } from "./shared/project";
import { Actions } from "./server/actions";
import { fetchLiveAgent } from "./server/agents";
import { dismissSuggestion, invalidateBoards, loadBoard, loadTicketDetail } from "./server/board";
import type { PaseoApi } from "./server/host-types";
import { PluginState } from "./server/state";
import { Stats } from "./server/stats";
import { summarize } from "./shared/stats";
import { Supervisor, identityFromLabels } from "./server/supervision";
import { sessionEnvironment } from "./server/environment";
import { readTextIfPresent, writeTextAtomically } from "./server/files";
import { catchUpText, compactManager, launchManager, restartManager, tellManager, writeManagerInstructions } from "./server/manager";
import { onboardProject } from "./server/onboard";
import { checkPrerequisites } from "./server/prerequisites";
import { listProjectConfigs, projectPaths, requireProjectConfig, taroHome, updateProjectConfig } from "./server/projects";
import { agentBrief, listModelOptions } from "./server/summaries";
import { TrackerWatch } from "./server/tracker-watch";

export default function contribute(server: PluginServerContext) {
  const trackers = new TrackerWatch();
  const state = new PluginState();
  const stats = new Stats();
  const supervisor = new Supervisor(state, stats);
  const actions = new Actions(state, supervisor, trackers, stats);
  // The server half is given Paseo only inside handlers and hooks; keep the first one for timers.
  let kept: PaseoApi | null = null;
  const keep = (paseo: PaseoApi): PaseoApi => {
    if (kept === null) {
      kept = paseo;
      // The first Paseo handle after a start: catch up on turns that ended while the plugin was down.
      void listProjectConfigs()
        .then((configs) => supervisor.reconcile(paseo, configs.map((config) => config.project)))
        .then((repaired) => {
          if (repaired > 0) console.log(`[taro] reconciled ${repaired} agents after start`);
        })
        .catch((error: unknown) => console.error("[taro] reconcile after start failed:", error));
    }
    return kept;
  };
  void actions.primeStatuses().catch((error: unknown) => console.error("[taro] could not read ticket statuses:", error));
  trackers.onChange((project) => {
    if (kept === null) return;
    void actions.onTrackerChanged(kept, project).catch((error: unknown) => {
      console.error(`[taro] after ${project}'s tracker changed:`, error);
    });
  });
  void trackers.refresh().catch((error: unknown) => {
    console.error("[taro] could not start tracker watches:", error);
  });

  server.handle(listProjects, async (_input, { paseo }) => {
    keep(paseo);
    const configs = await listProjectConfigs();
    const projects = await Promise.all(
      configs.map(async (config) => {
        const manager = await fetchLiveAgent(paseo, config.managerAgentId);
        const board = await loadBoard(paseo, state, config.project).catch(() => null);
        const trackerSyncProblem = config.trackerSync === "remote" ? trackers.syncProblem(config.project) : null;
        const needsYou =
          (board === null ? 0 : board.cards.filter((card) => card.column === "needs-you" || card.column === "stalled").length + board.managerDecisions.length) +
          (trackerSyncProblem === null ? 0 : 1);
        return { config, manager: manager === null ? null : agentBrief(manager), trackerSyncProblem, needsYou };
      }),
    );
    return { taroHome: await taroHome(), projects };
  });

  server.handle(checkPrerequisitesRpc, async (_input, { paseo }) => ({ checks: await checkPrerequisites(paseo) }));
  server.handle(listModels, async (_input, { paseo }) => ({ models: await listModelOptions(paseo) }));

  server.handle(onboardProjectRpc, async (input, { paseo }) => {
    const result = await onboardProject(keep(paseo), input);
    await trackers.refresh();
    await actions.primeStatuses();
    return result;
  });

  server.handle(readProjectConfigRpc, async ({ project }) => ({ config: await requireProjectConfig(project) }));
  server.handle(writeProjectSettings, async ({ project, settings }) => {
    const parsed = ProjectSettingsSchema.parse(settings);
    const current = await requireProjectConfig(project);
    const config = await updateProjectConfig(project, { ...parsed, repoPath: current.repoPath });
    await writeManagerInstructions(config);
    return { config };
  });

  server.handle(readStandingOrders, async ({ project }) => ({
    text: (await readTextIfPresent((await projectPaths(project)).standingOrders)) ?? "",
  }));
  server.handle(writeStandingOrders, async ({ project, text }) => {
    await requireProjectConfig(project);
    await writeTextAtomically((await projectPaths(project)).standingOrders, text);
    return {};
  });

  server.handle(launchManagerRpc, async ({ project }, { paseo }) => ({ agentId: (await launchManager(paseo, project)).agentId }));
  server.handle(restartManagerRpc, async ({ project }, { paseo }) => ({ agentId: (await restartManager(paseo, project)).agentId }));
  server.handle(compactManagerRpc, async ({ project }, { paseo }) => ({ agentId: await compactManager(paseo, project) }));
  server.handle(tellManagerRpc, async ({ project, text }, { paseo }) => ({ agentId: await tellManager(paseo, project, text) }));
  server.handle(catchUp, async ({ project }, { paseo }) => ({ agentId: await tellManager(paseo, project, await catchUpText(project)) }));

  server.handle(loadBoardRpc, async ({ project }, { paseo }) => loadBoard(keep(paseo), state, project));
  server.handle(loadTicket, async ({ project, ticket }) => loadTicketDetail(project, ticket));
  server.handle(findAgentTicket, async ({ agentId }, { paseo }) => {
    const agent = await fetchLiveAgent(paseo, agentId);
    const identity = agent === null ? null : identityFromLabels(agent.labels, agent.title ?? null);
    return { project: identity?.project ?? null, ticket: identity?.ticket ?? null, role: identity?.role ?? null };
  });
  server.handle(answerDecision, async ({ key, label, text }, { paseo }) => {
    await actions.answerDecision(keep(paseo), key, label, text);
    invalidateBoards();
    return {};
  });
  server.handle(listOpenDecisions, async ({ project }) => ({
    decisions: (await state.allDecisions()).filter((decision) => decision.status === "open" && (project === null || decision.project === project)),
  }));
  server.handle(tellAgent, async ({ agentId, text }, { paseo }) => {
    await actions.tellAgent(keep(paseo), agentId, text);
    return {};
  });
  server.handle(nudgeAgent, async ({ agentId }, { paseo }) => {
    await actions.nudge(keep(paseo), agentId);
    return {};
  });
  server.handle(compactAgent, async ({ agentId }, { paseo }) => {
    await actions.compact(keep(paseo), agentId);
    return {};
  });
  server.handle(relaunchOwner, async ({ project, ticket }, { paseo }) => ({ agentId: await actions.relaunchOwner(keep(paseo), project, ticket) }));
  server.handle(resolveTrackerSyncRpc, async ({ project, resolution }) => {
    await requireProjectConfig(project);
    return { problem: await trackers.resolve(project, resolution) };
  });
  server.handle(acceptTicket, async ({ project, ticket }, { paseo }) => {
    await actions.accept(keep(paseo), project, ticket);
    return {};
  });
  server.handle(requestChanges, async ({ project, ticket, text }, { paseo }) => {
    await actions.requestChanges(keep(paseo), project, ticket, text);
    return {};
  });
  server.handle(dismissSuggestionRpc, async ({ project, label, prompt }) => {
    await dismissSuggestion(project, label, prompt);
    invalidateBoards();
    return {};
  });

  server.handle(loadStats, async ({ project }) => ({ tickets: (await stats.all(project)).map((ticket) => summarize(ticket)) }));
  const removeTurnStartHook = server.on("agent.turn_started", ({ agent }) => {
    stats.turnStarted(agent.id);
  });

  // Supervision (decisions 28, 30, 35, 36): every Taro agent's turn end.
  const removeTurnHook = server.on("agent.turn_ended", async ({ agent, outcome, timeline, turnId }, { paseo }) => {
    keep(paseo);
    await supervisor.onTurnEnded(paseo, agent, outcome, timeline, turnId).catch((error: unknown) => {
      console.error(`[taro] supervising ${agent.id}:`, error);
    });
    invalidateBoards();
  });

  // Every Taro agent knows where its tracker and skill are, on create and on resume (decision 38).
  const removeSessionHook = server.before("agent.session_open", async ({ request }, { paseo }) => {
    const environment = await sessionEnvironment(paseo, request.agentId, request.cwd).catch(() => null);
    if (environment === null) return;
    return { ...request, env: { ...request.env, ...environment } };
  });

  return () => {
    removeTurnHook();
    removeTurnStartHook();
    removeSessionHook();
    trackers.stop();
  };
}
