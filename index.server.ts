import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  acceptTicket,
  answerDecision,
  getDecision,
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
  listSentImages,
  onboardProject as onboardProjectRpc,
  readImageRpc,
  readProjectConfig as readProjectConfigRpc,
  readStandingOrders,
  restartManager as restartManagerRpc,
  tellManager as tellManagerRpc,
  writeProjectSettings,
  writeStandingOrders,
} from "./shared/contracts";
import { ProjectSettingsSchema } from "./shared/project";
import { Actions } from "./server/actions";
import { fetchLiveAgent, isAgentLive } from "./server/agents";
import { dismissSuggestion, invalidateBoards, liveOpenDecisions, loadBoard, loadTicketDetail } from "./server/board";
import type { PaseoApi } from "./server/host-types";
import { Recovery } from "./server/recovery";
import { PluginState } from "./server/state";
import { Stats, turnMayStillEnd } from "./server/stats";
import { summarize } from "./shared/stats";
import { idleCompactAfterMs } from "./shared/idle-compaction";
import { Supervisor, identityFromLabels } from "./server/supervision";
import { sessionEnvironment } from "./server/environment";
import { readTextIfPresent, writeTextAtomically } from "./server/files";
import { catchUpText, compactManager, launchManager, restartManager, tellManager, writeManagerInstructions } from "./server/manager";
import { onboardProject } from "./server/onboard";
import { readImage } from "./server/images";
import { checkPrerequisites } from "./server/prerequisites";
import { listProjectConfigs, projectPaths, readProjectConfig, requireProjectConfig, taroHome, updateProjectConfig } from "./server/projects";
import { sentImagesOf } from "./server/sent-images";
import { agentBrief, listModelOptions } from "./server/summaries";
import { TrackerWatch } from "./server/tracker-watch";

export default function contribute(server: PluginServerContext) {
  const startedAt = Date.now();
  const trackers = new TrackerWatch();
  const state = new PluginState();
  const stats = new Stats();
  const recovery = new Recovery(state, stats);
  const supervisor = new Supervisor(state, stats, recovery);
  const actions = new Actions(state, supervisor, trackers, stats, recovery);
  recovery.setRelaunchOwner((paseo, project, ticket) => actions.relaunchOwner(paseo, project, ticket));
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
      // Changes made while the plugin was down (TR-043: the merge at an accept reloads it as the ticket
      // goes Done), and Done tickets whose agents were left open (an owner mid-turn at a reload).
      void actions.catchUpAfterStart(paseo).catch((error: unknown) => console.error("[taro] catching up after start failed:", error));
      void stats
        .dropFinishedTurns(async (agentId) => turnMayStillEnd(await fetchLiveAgent(paseo, agentId), startedAt))
        .catch((error: unknown) => console.error("[taro] dropping finished turn starts failed:", error));
    }
    return kept;
  };
  void actions.primeStatuses().catch((error: unknown) => console.error("[taro] could not read ticket statuses:", error));
  trackers.onChange((project) => {
    // A pull may have brought tickets edited elsewhere; the next read must not serve the cached board.
    invalidateBoards();
    if (kept === null) return;
    void actions.onTrackerChanged(kept, project).catch((error: unknown) => {
      console.error(`[taro] after ${project}'s tracker changed:`, error);
    });
  });
  void trackers.refresh().catch((error: unknown) => {
    console.error("[taro] could not start tracker watches:", error);
  });

  // Idle compaction (TR-015): once a minute, so an agent is caught inside its 55–60 minute window.
  const idleAfterMs = idleCompactAfterMs(process.env.TARO_IDLE_COMPACT_AFTER_SECONDS);
  let checkingIdle = false;
  const idleTimer = setInterval(() => {
    if (kept === null || checkingIdle) return;
    const paseo = kept;
    checkingIdle = true;
    void listProjectConfigs()
      .then((configs) => supervisor.compactIdleAgents(paseo, configs.map((config) => config.project), Date.now(), idleAfterMs))
      .then((started) => {
        if (started > 0) {
          console.log(`[taro] started idle compaction for ${started} agents`);
          invalidateBoards();
        }
      })
      .catch((error: unknown) => console.error("[taro] idle compaction check failed:", error))
      .finally(() => {
        checkingIdle = false;
      });
  }, 60_000);

  server.handle(listProjects, async (_input, { paseo }) => {
    keep(paseo);
    const configs = await listProjectConfigs();
    const projects = await Promise.all(
      configs.map(async (config) => {
        const manager = await fetchLiveAgent(paseo, config.managerAgentId);
        void trackers.pullIfDue(config.project);
        const board = await loadBoard(paseo, state, config.project).catch(() => null);
        const trackerSyncProblem = config.trackerSync === "remote" ? trackers.syncProblem(config.project) : null;
        const needsYou =
          (board === null ? 0 : board.cards.filter((card) => card.column === "needs-you" || card.column === "stalled").length + board.managerDecisions.length + board.alerts.length) +
          (trackerSyncProblem === null ? 0 : 1);
        return { config, manager: manager === null ? null : agentBrief(manager), trackerSyncProblem, needsYou };
      }),
    );
    return { taroHome: await taroHome(), projects };
  });

  server.handle(checkPrerequisitesRpc, async (_input, { paseo }) => ({ checks: await checkPrerequisites(paseo) }));
  server.handle(listModels, async (_input, { paseo }) => ({ models: await listModelOptions(paseo) }));

  server.handle(onboardProjectRpc, async (input, { paseo }) => {
    const known = (await readProjectConfig(input.project).catch(() => null)) !== null;
    const result = await onboardProject(keep(paseo), input);
    if (!known) await state.forgetTicketStatuses(input.project);
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
  server.handle(tellManagerRpc, async ({ project, text, images, files }, { paseo }) => ({ agentId: await tellManager(paseo, project, text, { images, files }) }));
  server.handle(catchUp, async ({ project }, { paseo }) => ({ agentId: await tellManager(paseo, project, await catchUpText(project)) }));

  server.handle(loadBoardRpc, async ({ project }, { paseo }) => {
    void trackers.pullIfDue(project);
    return loadBoard(keep(paseo), state, project);
  });
  server.handle(loadTicket, async ({ project, ticket }) => {
    void trackers.pullIfDue(project);
    return loadTicketDetail(project, ticket);
  });
  server.handle(findAgentTicket, async ({ agentId }, { paseo }) => {
    const agent = await fetchLiveAgent(paseo, agentId);
    const identity = agent === null ? null : identityFromLabels(agent.labels, agent.title ?? null);
    return { project: identity?.project ?? null, ticket: identity?.ticket ?? null, role: identity?.role ?? null };
  });
  server.handle(answerDecision, async ({ key, label, text, from }, { paseo }) => {
    await actions.answerDecision(keep(paseo), key, label, text, from);
    invalidateBoards();
    return {};
  });
  server.handle(getDecision, async ({ agentId, id }, { paseo }) => {
    const decision = await state.decision(`${agentId}:${id}`);
    // Only an open decision's card depends on the agent still being there.
    return { decision, agentLive: decision?.status === "open" ? await isAgentLive(keep(paseo), agentId) : true };
  });
  server.handle(listOpenDecisions, async ({ project }, { paseo }) => ({ decisions: await liveOpenDecisions(keep(paseo), state, project) }));
  server.handle(tellAgent, async ({ agentId, text, images, files }, { paseo }) => {
    await actions.tellAgent(keep(paseo), agentId, text, { images, files });
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

  server.handle(readImageRpc, async ({ path }) => ({ image: await readImage(path) }));
  server.handle(listSentImages, async ({ agentId }, { paseo }) => ({ messages: await sentImagesOf(paseo, agentId) }));

  server.handle(loadStats, async ({ project }) => ({
    tickets: (await stats.all(project)).map((ticket) => summarize(ticket)),
    managerIdleCompactions: (await stats.projectCounts(project)).idleCompactions,
  }));
  const removeTurnStartHook = server.on("agent.turn_started", async ({ agent }) => {
    await stats.turnStarted(agent.id).catch((error: unknown) => console.error(`[taro] recording ${agent.id}'s turn start:`, error));
  });

  // Supervision (decisions 28, 30, 35, 36): every Taro agent's turn end.
  const removeTurnHook = server.on("agent.turn_ended", async ({ agent, outcome, timeline, turnId }, { paseo }) => {
    // Every agent's turn start is taken here, first: queued before `keep` can queue the drop of stale
    // starts, and before supervision prompts the agent into a new turn whose start must survive.
    const taking = stats.takeTurnDuration(agent.id).catch(() => undefined);
    keep(paseo);
    const activeMs = await taking;
    await supervisor.onTurnEnded(paseo, agent, outcome, timeline, turnId, activeMs).catch((error: unknown) => {
      console.error(`[taro] supervising ${agent.id}:`, error);
    });
    // After supervision has read the turn: an agent mid-turn when its ticket reached Done is released now (TR-024).
    await actions.onAgentTurnEnded(paseo, agent.id).catch((error: unknown) => {
      console.error(`[taro] releasing ${agent.id} after its turn:`, error);
    });
    invalidateBoards();
  });

  // An archived agent's questions are withdrawn, whoever archived it (decisions of dead agents message no one).
  const removeArchiveHook = server.on("agent.archived", async ({ agent }) => {
    const withdrawn = await supervisor.withdrawDecisionsOf(agent.id).catch((error: unknown) => {
      console.error(`[taro] withdrawing ${agent.id}'s decisions:`, error);
      return 0;
    });
    if (withdrawn > 0) {
      console.log(`[taro] ${agent.id} was archived; withdrew ${withdrawn} open decisions`);
      invalidateBoards();
    }
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
    removeArchiveHook();
    removeSessionHook();
    clearInterval(idleTimer);
    recovery.dispose();
    trackers.stop();
  };
}
