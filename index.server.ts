import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  acceptTicket,
  answerDecision,
  getDecision,
  loadStats,
  catchUp,
  compactAgent,
  dismissSuggestion as dismissSuggestionRpc,
  dismissQueueAlert,
  findAgentTicket,
  answeredPermissionAsks,
  listAgentDecisions,
  listOpenDecisions,
  loadBoard as loadBoardRpc,
  loadPastPlan,
  loadTicket,
  nudgeAgent,
  stopAgentTurn,
  pauseTicket,
  relaunchOwner,
  reopenTicket,
  closeRound,
  resumeTicket,
  requestChanges,
  changeQueuedSpec,
  resolveTrackerSync as resolveTrackerSyncRpc,
  tellAgent,
  listChatQueue,
  removeQueuedMessage,
  takeQueuedMessage,
  sendQueuedMessageNow,
  retryQueuedMessage,
  checkOnboarding,
  checkPrerequisites as checkPrerequisitesRpc,
  compactManager as compactManagerRpc,
  launchManager as launchManagerRpc,
  listModels,
  listPaseoProjects as listPaseoProjectsRpc,
  listProjects,
  listSentImages,
  listAgentCommands,
  listProjectFiles,
  listTicketsForPicks,
  readRecentCommands,
  rememberRecentCommand as rememberRecentCommandRpc,
  onboardProject as onboardProjectRpc,
  pollNotifications,
  readImageRpc,
  readMergeMethods,
  readProjectConfig as readProjectConfigRpc,
  readStandingOrders,
  reorderProjects,
  restartManager as restartManagerRpc,
  resumeManager as resumeManagerRpc,
  tellManager as tellManagerRpc,
  writeProjectSettings,
  writeStandingOrders,
  reportTrail,
  loadLastCrash,
  dismissCrash,
} from "./shared/contracts";
import { inboxCount } from "./shared/board";
import { askFromRequest } from "./shared/permission-asks";
import { ProjectSettingsSchema } from "./shared/project";
import { Actions } from "./server/actions";
import { inTabOrder, saveTabOrder } from "./server/project-order";
import { ChatQueue } from "./server/chat-queue";
import { createCrashTrail } from "./server/crash-trail";
import { backfillCosts, recordArchivedUsage } from "./server/cost-recording";
import { decisionsOfAgent } from "./server/agent-decisions";
import { fetchLiveAgent, isAgentLive } from "./server/agents";
import { dismissSuggestion, invalidateBoards, liveOpenDecisions, loadBoard, loadTicketDetail, loadTicketPastPlan } from "./server/board";
import type { PaseoApi } from "./server/host-types";
import { Recovery } from "./server/recovery";
import { PluginState } from "./server/state";
import { Stats, turnMayStillEnd } from "./server/stats";
import { withSavedContext } from "./shared/past-context";
import { summarize, waitingTickets } from "./shared/stats";
import { idleCompactAfterMs } from "./shared/idle-compaction";
import { Supervisor, identityFromLabels } from "./server/supervision";
import { sessionEnvironment } from "./server/environment";
import { readTextIfPresent, writeTextAtomically } from "./server/files";
import { trimAgentLaunch } from "./server/agent-trim";
import { ensureCompactHook, installCompactHook, removeReloadFile } from "./server/compact-hook";
import { forgetOwnerStart, markOwnerStarted } from "./server/owner-start";
import { catchUpText, compactManager, launchManager, restartManager, resumeManager, tellManager, writeManagerInstructions } from "./server/manager";
import { onboardProject, onboardingProblems } from "./server/onboard";
import { listPaseoProjects, settingsTemplate } from "./server/paseo-projects";
import { isTaroAsker, triageAsk } from "./server/permission-triage";
import { readImage } from "./server/images";
import { Notifier } from "./server/notifications";
import { allowedMergeMethods } from "./server/merge-methods";
import { checkPrerequisites } from "./server/prerequisites";
import { listProjectConfigs, projectPaths, readProjectConfig, requireProjectConfig, taroHome, updateProjectConfig } from "./server/projects";
import { sentImagesOf } from "./server/sent-images";
import { agentCommands, projectFiles, recentCommands, rememberRecentCommand, ticketsForPicks } from "./server/composer-picks";
import { agentBrief, listModelOptions } from "./server/summaries";
import { TrackerWatch } from "./server/tracker-watch";
import { stopCommands } from "./server/process";
import { isStopping, markStopping, reportFailure } from "./server/stopping";

export default function contribute(server: PluginServerContext) {
  const startedAt = Date.now();
  const trackers = new TrackerWatch();
  const state = new PluginState();
  const stats = new Stats();
  const chatQueue = new ChatQueue(state);
  const recovery = new Recovery(state, stats, chatQueue);
  const supervisor = new Supervisor(state, stats, recovery, chatQueue);
  const actions = new Actions(state, supervisor, trackers, stats, recovery, chatQueue);
  recovery.setRelaunchOwner((paseo, project, ticket) => actions.relaunchOwner(paseo, project, ticket));
  // Each Needs-you check also records which cards wait on the user, for Stats' Waiting on you (TR-100).
  const crashTrail = createCrashTrail();
  const notifier = new Notifier({ onBoard: (project, board) => stats.waitingSeen(project, waitingTickets(board.cards)) });
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
        .catch((error: unknown) => reportFailure("[taro] reconcile after start failed:", error));
      // Changes made while the plugin was down (TR-043: the merge at an accept reloads it as the ticket
      // goes Done), and Done tickets whose agents were left open (an owner mid-turn at a reload).
      void actions.catchUpAfterStart(paseo).catch((error: unknown) => reportFailure("[taro] catching up after start failed:", error));
      // Once: entries into the status a ticket already had, which stretched wall times (TR-100).
      void stats
        .repairRepeats()
        .then((repair) => {
          if (repair !== null) console.log(`[taro] stats repair: removed ${repair.removed} repeated status entries (the file as it was is in stats.json.pre-repair)`);
        })
        .catch((error: unknown) => reportFailure("[taro] repairing stats failed:", error));
      // Once: costs of agents archived before every turn end recorded one (TR-097).
      void listProjectConfigs()
        .then((configs) => backfillCosts(paseo, stats, configs.map((config) => config.project)))
        .then((backfill) => {
          if (backfill !== null) console.log(`[taro] cost backfill from transcripts: ${backfill.filled} filled, ${backfill.missing} not recoverable`);
        })
        .catch((error: unknown) => reportFailure("[taro] backfilling costs failed:", error));
      void stats
        .dropFinishedTurns(async (agentId) => turnMayStillEnd(await fetchLiveAgent(paseo, agentId), startedAt))
        .catch((error: unknown) => reportFailure("[taro] dropping finished turn starts failed:", error));
    }
    return kept;
  };
  void actions.primeStatuses().catch((error: unknown) => reportFailure("[taro] could not read ticket statuses:", error));
  trackers.onChange((project) => {
    // A pull may have brought tickets edited elsewhere; the next read must not serve the cached board.
    invalidateBoards();
    if (kept === null || isStopping()) return;
    void actions
      .onTrackerChanged(kept, project)
      .catch((error: unknown) => {
        reportFailure(`[taro] after ${project}'s tracker changed:`, error);
      })
      .finally(checkNotifications);
  });
  void trackers.refresh().catch((error: unknown) => {
    reportFailure("[taro] could not start tracker watches:", error);
  });

  // A missed file-watch event must not stall the queue until something else writes the tracker (TR-050).
  let backstopping = false;
  const backstopTimer = setInterval(() => {
    if (backstopping) return;
    backstopping = true;
    void trackers
      .backstop()
      .catch((error: unknown) => reportFailure("[taro] tracker backstop failed:", error))
      // The queue check (TR-062) rides the same minute: queued tickets with a free slot and an idle manager.
      .then(() => (kept === null || isStopping() ? false : actions.checkQueues(kept)))
      .then((changed) => {
        if (changed) invalidateBoards();
      })
      .catch((error: unknown) => reportFailure("[taro] queue check failed:", error))
      .finally(() => {
        backstopping = false;
      });
  }, 60_000);

  // What entered Needs you (TR-059): after each turn end and tracker change, and every 15 seconds for
  // what neither shows (a permission asked mid-turn). One pass at a time; a call during one runs another after it.
  let notifying = false;
  let notifyAgain = false;
  const checkNotifications = (): void => {
    if (kept === null || isStopping()) return;
    if (notifying) {
      notifyAgain = true;
      return;
    }
    const paseo = kept;
    notifying = true;
    void listProjectConfigs()
      .then((configs) => Promise.all(configs.map((config) => notifier.check(paseo, state, config.project, actions.queueAlerts(config.project)).catch((error: unknown) => reportFailure(`[taro] notifications for ${config.project}:`, error)))))
      .catch((error: unknown) => reportFailure("[taro] notification check failed:", error))
      .finally(() => {
        notifying = false;
        if (notifyAgain) {
          notifyAgain = false;
          checkNotifications();
        }
      });
  };
  const notifyTimer = setInterval(checkNotifications, 15_000);

  // Chat messages queued while the plugin was down, or whose agent's turn end it missed (TR-171).
  let sweepingQueues = false;
  const queueTimer = setInterval(() => {
    if (kept === null || sweepingQueues || isStopping()) return;
    sweepingQueues = true;
    void chatQueue
      .sweep(kept)
      .then((sent) => {
        if (sent > 0) console.log(`[taro] sent ${sent} queued chat message(s) to idle agents`);
      })
      .catch((error: unknown) => reportFailure("[taro] chat queue sweep failed:", error))
      .finally(() => {
        sweepingQueues = false;
      });
  }, 15_000);

  // Idle compaction (TR-015): once a minute, so an agent is caught inside its 55–60 minute window.
  const idleAfterMs = idleCompactAfterMs(process.env.TARO_IDLE_COMPACT_AFTER_SECONDS);
  let checkingIdle = false;
  const idleTimer = setInterval(() => {
    if (kept === null || checkingIdle || isStopping()) return;
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
      .catch((error: unknown) => reportFailure("[taro] idle compaction check failed:", error))
      .finally(() => {
        checkingIdle = false;
      });
  }, 60_000);

  server.handle(listProjects, async (_input, { paseo }) => {
    keep(paseo);
    const configs = await inTabOrder(await listProjectConfigs());
    const projects = await Promise.all(
      configs.map(async (config) => {
        const manager = await fetchLiveAgent(paseo, config.managerAgentId);
        void trackers.pullIfDue(config.project);
        const board = await loadBoard(paseo, state, config.project, actions.queueAlerts(config.project)).catch(() => null);
        const trackerSyncProblem = config.trackerSync === "remote" ? trackers.syncProblem(config.project) : null;
        const needsYou = inboxCount(board, trackerSyncProblem !== null);
        const managerLastTurnEndedAt = manager === null ? null : ((await state.agent(manager.id))?.lastTurnEndedAt ?? null);
        return { config, manager: manager === null ? null : agentBrief(manager), managerLastTurnEndedAt, trackerSyncProblem, needsYou };
      }),
    );
    return { taroHome: await taroHome(), projects };
  });

  server.handle(reorderProjects, async (input) => {
    await saveTabOrder(input.order);
    return {};
  });

  server.handle(checkPrerequisitesRpc, async (_input, { paseo }) => ({ checks: await checkPrerequisites(paseo) }));
  server.handle(readMergeMethods, async (input) => ({ allowed: await allowedMergeMethods(input.repoPath) }));
  server.handle(listModels, async (_input, { paseo }) => ({ models: await listModelOptions(paseo) }));

  server.handle(onboardProjectRpc, async (input, { paseo }) => {
    const known = (await readProjectConfig(input.project).catch(() => null)) !== null;
    const result = await onboardProject(keep(paseo), input);
    if (!known) await state.forgetTicketStatuses(input.project);
    await trackers.refresh();
    await actions.primeStatuses();
    return result;
  });

  server.handle(checkOnboarding, async (input) => ({ problems: await onboardingProblems(input) }));
  server.handle(listPaseoProjectsRpc, async (_input, { paseo }) => {
    const configs = await listProjectConfigs();
    return {
      projects: await listPaseoProjects(keep(paseo), configs),
      template: await settingsTemplate(configs),
      takenPrefixes: configs.map((config) => config.ticketPrefix),
    };
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

  server.handle(launchManagerRpc, async ({ project }, { paseo }) => ({ agentId: (await launchManager(paseo, project, chatQueue)).agentId }));
  server.handle(restartManagerRpc, async ({ project }, { paseo }) => ({ agentId: (await restartManager(paseo, project, { queue: chatQueue })).agentId }));
  server.handle(resumeManagerRpc, async ({ project }, { paseo }) => ({ agentId: (await resumeManager(paseo, project, state)).agentId }));
  server.handle(compactManagerRpc, async ({ project }, { paseo }) => ({ agentId: await compactManager(paseo, project, supervisor) }));
  server.handle(tellManagerRpc, async ({ project, text, images, files, messageId, answersRequest }, { paseo }) => {
    const told = await tellManager(keep(paseo), project, text, { images, files, messageId }, { queue: chatQueue, answersRequest: answersRequest === true });
    actions.userToldManager(project);
    return told;
  });
  server.handle(catchUp, async ({ project }, { paseo }) => {
    const { agentId } = await tellManager(paseo, project, await catchUpText(project));
    // Asking the manager to catch up acts on a queued alert as a message does (TR-062).
    actions.userToldManager(project);
    return { agentId };
  });

  server.handle(loadBoardRpc, async ({ project, limits, include }, { paseo }) => {
    void trackers.pullIfDue(project);
    const [board, saved] = await Promise.all([loadBoard(keep(paseo), state, project, actions.queueAlerts(project), { limits, include }), stats.all(project)]);
    return withSavedContext(board, saved);
  });
  server.handle(loadTicket, async ({ project, ticket }, { paseo }) => {
    void trackers.pullIfDue(project);
    return loadTicketDetail(keep(paseo), project, ticket);
  });
  server.handle(loadPastPlan, async ({ project, ticket, answeredAt, askedAt }) => ({ plan: await loadTicketPastPlan(project, ticket, { answeredAt, askedAt }) }));
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
  server.handle(answeredPermissionAsks, async ({ agentId }) => ({ asks: await state.answeredPermissionAsks(agentId) }));
  server.handle(listAgentDecisions, async ({ agentId }) => ({ decisions: decisionsOfAgent(await state.allDecisions(), agentId) }));
  server.handle(tellAgent, async ({ agentId, text, images, files, messageId, answersRequest }, { paseo }) => {
    return actions.tellAgent(keep(paseo), agentId, text, { images, files, messageId }, answersRequest === true);
  });
  server.handle(listChatQueue, async ({ agentId }) => chatQueue.listing(agentId));
  server.handle(takeQueuedMessage, async ({ agentId, messageId }) => chatQueue.take(agentId, messageId));
  server.handle(removeQueuedMessage, async ({ agentId, messageId }) => {
    await chatQueue.remove(agentId, messageId);
    return {};
  });
  server.handle(sendQueuedMessageNow, async ({ agentId, messageId }, { paseo }) => {
    await chatQueue.sendNow(keep(paseo), agentId, messageId);
    return {};
  });
  server.handle(retryQueuedMessage, async ({ agentId, messageId }, { paseo }) => {
    await chatQueue.retry(keep(paseo), agentId, messageId);
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
  server.handle(stopAgentTurn, async ({ agentId }, { paseo }) => {
    await actions.stop(keep(paseo), agentId);
    return {};
  });
  server.handle(pauseTicket, async ({ project, ticket }, { paseo }) => {
    const text = await actions.pause(keep(paseo), project, ticket);
    invalidateBoards();
    return { message: text };
  });
  server.handle(resumeTicket, async ({ project, ticket }, { paseo }) => {
    const result = await actions.resume(keep(paseo), project, ticket);
    invalidateBoards();
    return result;
  });
  server.handle(reopenTicket, async ({ project, ticket, note }, { paseo }) => {
    const text = await actions.reopenTicket(keep(paseo), project, ticket, note);
    invalidateBoards();
    return { message: text };
  });
  server.handle(closeRound, async ({ project, ticket }, { paseo }) => {
    const text = await actions.closeRound(keep(paseo), project, ticket);
    invalidateBoards();
    return { message: text };
  });
  server.handle(relaunchOwner, async ({ project, ticket }, { paseo }) => ({ agentId: await actions.relaunchOwner(keep(paseo), project, ticket) }));
  server.handle(resolveTrackerSyncRpc, async ({ project, resolution }) => {
    await requireProjectConfig(project);
    return { problem: await trackers.resolve(project, resolution) };
  });
  server.handle(dismissQueueAlert, async ({ project, tickets }) => {
    await actions.dismissQueueAlert(project, tickets);
    invalidateBoards();
    return {};
  });
  server.handle(acceptTicket, async ({ project, ticket }, { paseo }) => {
    await actions.accept(keep(paseo), project, ticket);
    return {};
  });
  server.handle(requestChanges, async ({ project, ticket, text }, { paseo }) => {
    await actions.requestChanges(keep(paseo), project, ticket, text);
    return {};
  });
  server.handle(changeQueuedSpec, async ({ project, ticket, text }, { paseo }) => {
    await actions.changeQueuedSpec(keep(paseo), project, ticket, text);
    return {};
  });
  server.handle(dismissSuggestionRpc, async ({ project, label, prompt }) => {
    await dismissSuggestion(project, label, prompt);
    invalidateBoards();
    return {};
  });

  server.handle(pollNotifications, async ({ clientId, active, after }, { paseo }) => {
    keep(paseo);
    return notifier.poll(clientId, active, after);
  });

  server.handle(reportTrail, async (input) => {
    await crashTrail.report(input);
    return {};
  });
  server.handle(loadLastCrash, async ({ launch, device }) => ({ crash: await crashTrail.last(launch, device) }));
  server.handle(dismissCrash, async ({ launch }) => {
    await crashTrail.dismiss(launch);
    return {};
  });

  server.handle(readImageRpc, async ({ path }) => ({ image: await readImage(path) }));
  server.handle(listSentImages, async ({ agentId }, { paseo }) => ({ messages: await sentImagesOf(paseo, agentId) }));
  server.handle(listAgentCommands, async ({ agentId }, { paseo }) => agentCommands(paseo, agentId));
  server.handle(listProjectFiles, async ({ project, agentId }, { paseo }) => projectFiles(paseo, project, agentId));
  server.handle(listTicketsForPicks, async ({ project }) => ({ tickets: await ticketsForPicks(project) }));
  server.handle(readRecentCommands, async ({ project }) => ({ names: await recentCommands(project) }));
  server.handle(rememberRecentCommandRpc, async ({ project, name }) => ({ names: await rememberRecentCommand(project, name) }));

  server.handle(loadStats, async ({ project }) => ({
    tickets: (await stats.all(project)).map((ticket) => summarize(ticket)),
    managerIdleCompactions: (await stats.projectCounts(project)).idleCompactions,
  }));
  const removeTurnStartHook = server.on("agent.turn_started", async ({ agent }, { paseo }) => {
    await stats.turnStarted(agent.id).catch((error: unknown) => reportFailure(`[taro] recording ${agent.id}'s turn start:`, error));
    await ensureCompactHook(paseo, agent)
      .then((done) => (done === null ? undefined : console.log(`[taro] ${agent.id}: ${done}`)))
      .catch((error: unknown) => reportFailure(`[taro] compact hook for ${agent.id}:`, error));
    // An owner's ticket leaves Queued as the owner starts, not once it has read its rules (TR-173).
    await markOwnerStarted(paseo, agent.id)
      .then((ticket) => {
        if (ticket === null) return;
        console.log(`[taro] ${agent.id} started: ${ticket} is Planning`);
        invalidateBoards();
      })
      .catch((error: unknown) => reportFailure(`[taro] setting ${agent.id}'s ticket Planning:`, error));
  });

  // Supervision (decisions 28, 30, 35, 36): every Taro agent's turn end.
  const removeTurnHook = server.on("agent.turn_ended", async ({ agent, outcome, timeline, turnId }, { paseo }) => {
    // Every agent's turn start is taken here, first: queued before `keep` can queue the drop of stale
    // starts, and before supervision prompts the agent into a new turn whose start must survive.
    const taking = stats.takeTurnDuration(agent.id).catch(() => undefined);
    keep(paseo);
    const activeMs = await taking;
    await supervisor.onTurnEnded(paseo, agent, outcome, timeline, turnId, activeMs).catch((error: unknown) => {
      reportFailure(`[taro] supervising ${agent.id}:`, error);
    });
    // After supervision has read the turn: an agent mid-turn when its ticket reached Done is released now (TR-024).
    await actions.onAgentTurnEnded(paseo, agent.id).catch((error: unknown) => {
      reportFailure(`[taro] releasing ${agent.id} after its turn:`, error);
    });
    invalidateBoards();
    checkNotifications();
  });

  // An archived agent's questions are withdrawn, whoever archived it (decisions of dead agents message no one).
  const removeArchiveHook = server.on("agent.archived", async ({ agent }, { paseo }) => {
    await recordArchivedUsage(paseo, stats, agent.id).catch((error: unknown) => reportFailure(`[taro] recording ${agent.id}'s cost at archive:`, error));
    await removeReloadFile(agent.id).catch((error: unknown) => reportFailure(`[taro] removing ${agent.id}'s reload file:`, error));
    await chatQueue.forget(agent.id).catch((error: unknown) => reportFailure(`[taro] removing ${agent.id}'s chat queue:`, error));
    forgetOwnerStart(agent.id);
    const withdrawn = await supervisor.withdrawDecisionsOf(agent.id).catch((error: unknown) => {
      reportFailure(`[taro] withdrawing ${agent.id}'s decisions:`, error);
      return 0;
    });
    if (withdrawn > 0) {
      console.log(`[taro] ${agent.id} was archived; withdrew ${withdrawn} open decisions`);
      invalidateBoards();
    }
  });

  // A bypass-mode agent's shell ask is answered by fixed rules when they decide it; the rest wait for the user (TR-143).
  // A Taro agent's asks are recorded first, so the rules can mark one as theirs before they answer it (TR-149).
  const removePermissionHook = server.on("agent.permission_requested", async ({ agent, request }, { paseo }) => {
    await isTaroAsker(paseo, (agentId) => state.agent(agentId), agent.id)
      .then((taro) => (taro ? state.recordPermissionAsk(askFromRequest(agent.id, request, new Date().toISOString())) : undefined))
      .catch((error: unknown) => reportFailure(`[taro] recording ${agent.id}'s permission ask:`, error));
    const rulesMark = {
      mark: (requestId: string, rule: string) => state.markPermissionAskByRules(agent.id, requestId, rule),
      clear: (requestId: string) => state.clearPermissionAskRules(agent.id, requestId),
    };
    const decided = await triageAsk(paseo, stats, agent, request, rulesMark).catch((error: unknown) => {
      reportFailure(`[taro] triaging ${agent.id}'s permission ask:`, error);
      return null;
    });
    if (decided !== null) invalidateBoards();
  });
  // Whoever answered: the rules' mark on the ask says it was them, otherwise it was the user.
  const removePermissionResolvedHook = server.on("agent.permission_resolved", async ({ agent, requestId, resolution }) => {
    await state.resolvePermissionAsk(agent.id, requestId, resolution, new Date().toISOString()).catch((error: unknown) => reportFailure(`[taro] recording the answer to ${agent.id}'s permission ask:`, error));
  });

  // Every Taro agent knows where its tracker and skill are, and has `taro` on PATH, on create and on resume (decision 38).
  // A Claude manager or owner also gets the SessionStart hook that reloads its rules after any compaction (TR-101).
  const removeSessionHook = server.before("agent.session_open", async ({ request }, { paseo }) => {
    await installCompactHook(paseo, request)
      .then((done) => (done === null ? undefined : console.log(`[taro] ${request.agentId}: ${done}`)))
      .catch((error: unknown) => reportFailure(`[taro] compact hook for ${request.agentId}:`, error));
    const environment = await sessionEnvironment(paseo, request.agentId, request.cwd, request.env?.PATH, request.env?.TARO_PROJECT).catch(() => null);
    if (environment === null) return;
    return { ...request, env: { ...request.env, ...environment } };
  });

  // A Taro owner or subagent on Claude starts without the tools, MCP server and skills no role uses (TR-139).
  const removeCreateHook = server.before("agent.create", async ({ request }) => {
    const trimmed = await trimAgentLaunch(request).catch((error: unknown) => {
      reportFailure(`[taro] trimming a launch in ${request.config.cwd}:`, error);
      return null;
    });
    return trimmed ?? undefined;
  });

  // Paseo has already disposed the API when this runs: stop everything that could start a pass first,
  // so nothing new calls it, and keep what was in flight from logging the stop as errors (TR-067).
  return async () => {
    markStopping();
    trackers.stop();
    clearInterval(idleTimer);
    clearInterval(notifyTimer);
    clearInterval(queueTimer);
    clearInterval(backstopTimer);
    recovery.dispose();
    removeTurnHook();
    removeTurnStartHook();
    removeArchiveHook();
    removeSessionHook();
    removeCreateHook();
    removePermissionHook();
    removePermissionResolvedHook();
    // Last: commands under way get a moment to finish, then are killed with their children (TR-073).
    await stopCommands();
  };
}
