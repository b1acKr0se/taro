import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  catchUp,
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
import { fetchLiveAgent } from "./server/agents";
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
  void trackers.refresh().catch((error: unknown) => {
    console.error("[taro] could not start tracker watches:", error);
  });

  server.handle(listProjects, async (_input, { paseo }) => {
    const configs = await listProjectConfigs();
    const projects = await Promise.all(
      configs.map(async (config) => {
        const manager = await fetchLiveAgent(paseo, config.managerAgentId);
        return { config, manager: manager === null ? null : agentBrief(manager), trackerSyncProblem: trackers.syncProblem(config.project) };
      }),
    );
    return { taroHome: await taroHome(), projects };
  });

  server.handle(checkPrerequisitesRpc, async (_input, { paseo }) => ({ checks: await checkPrerequisites(paseo) }));
  server.handle(listModels, async (_input, { paseo }) => ({ models: await listModelOptions(paseo) }));

  server.handle(onboardProjectRpc, async (input, { paseo }) => {
    const result = await onboardProject(paseo, input);
    await trackers.refresh();
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

  // Every Taro agent knows where its tracker and skill are, on create and on resume (decision 38).
  const removeSessionHook = server.before("agent.session_open", async ({ request }, { paseo }) => {
    const environment = await sessionEnvironment(paseo, request.agentId, request.cwd).catch(() => null);
    if (environment === null) return;
    return { ...request, env: { ...request.env, ...environment } };
  });

  return () => {
    removeSessionHook();
    trackers.stop();
  };
}
