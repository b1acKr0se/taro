/**
 * A project's manager: its instructions file, its workspace in the "Taro"
 * project, launching and restarting it, and carrying the user's words to it.
 * The manager triages and dispatches (decision 29); the plugin only sets it up.
 */
import { writeFile } from "node:fs/promises";

import { TARO_LABELS, type ProjectConfig } from "../shared/project";
import { fetchLiveAgent, isMidTurn } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { bypassModeId, knownBypassMode } from "./models";
import { TEMPLATES, fill, message, readTemplate, skillDirectory } from "./package-files";
import { projectPaths, requireProjectConfig, updateProjectConfig } from "./projects";
import { sendCommand, sendWithoutInterrupting } from "./send";
import { attachmentExtras, hasAttachments, type Attachments } from "./uploads";
import { serialized } from "./serialize";
import { ensureTaroProject } from "./taro-project";
import { taroEnvironment } from "./environment";

export function managerTitle(project: string): string {
  return `${project} · Manager`;
}

/** The values every manager-facing template is filled from. */
export async function projectValues(config: ProjectConfig): Promise<Record<string, string>> {
  const paths = await projectPaths(config.project);
  const skill = await skillDirectory();
  return {
    project: config.project,
    home: paths.home,
    repoPath: config.repoPath,
    baseBranch: config.baseBranch,
    ticketPrefix: config.ticketPrefix,
    tracker: paths.tracker,
    standingOrders: paths.standingOrders,
    suggestions: paths.suggestions,
    skill,
    paseoProjectId: config.paseoProjectId,
    ownerModel: config.owner.model,
    ownerThinking: config.owner.thinking === "" ? "(provider default)" : config.owner.thinking,
    ownerMode: knownBypassMode(config.owner.model) || "(provider default)",
    subagentModels: config.subagentModels.length === 0 ? config.owner.model : config.subagentModels.join(", "),
    delivery: config.delivery,
    acceptAlsoMerges: config.acceptAlsoMerges ? "yes" : "no",
    maxParallelOwners: String(config.maxParallelOwners),
  };
}

/** Rewrites the manager's AGENTS.md from the template (on every launch and settings save). */
export async function writeManagerInstructions(config: ProjectConfig): Promise<void> {
  const paths = await projectPaths(config.project);
  await writeFile(paths.agents, fill(await readTemplate(TEMPLATES.managerAgents), await projectValues(config)), "utf8");
}

async function ensureManagerWorkspace(paseo: PaseoApi, config: ProjectConfig): Promise<string> {
  if (config.managerWorkspaceId !== "") {
    const workspace = await paseo.workspaces.ref(config.managerWorkspaceId).refresh().catch(() => null);
    if (workspace !== null) return config.managerWorkspaceId;
  }
  const { projectId } = await ensureTaroProject(paseo);
  const paths = await projectPaths(config.project);
  const workspace = await paseo.workspaces.create({
    source: { kind: "directory", path: paths.home, projectId },
    title: managerTitle(config.project),
  });
  await updateProjectConfig(config.project, { managerWorkspaceId: workspace.id });
  return workspace.id;
}

export interface ManagerState {
  agent: PaseoAgent | null;
}

export async function resolveManager(paseo: PaseoApi, config: ProjectConfig): Promise<ManagerState> {
  return { agent: await fetchLiveAgent(paseo, config.managerAgentId) };
}

async function startManager(paseo: PaseoApi, config: ProjectConfig, restart: boolean): Promise<{ agentId: string; workspaceId: string }> {
  await writeManagerInstructions(config);
  const workspaceId = await ensureManagerWorkspace(paseo, config);
  const values = await projectValues(config);
  const opening = await message(TEMPLATES.managerOpening, values);
  const prompt = restart ? `${opening}\n\n${await message(TEMPLATES.managerRestart, values)}` : opening;
  const modeId = await bypassModeId(paseo, config.manager.model);
  const paths = await projectPaths(config.project);
  const agent = await paseo.workspaces.ref(workspaceId).agents.create({
    config: {
      provider: config.manager.model,
      ...(modeId === null ? {} : { modeId }),
      ...(config.manager.thinking === "" ? {} : { thinkingOptionId: config.manager.thinking }),
    },
    title: managerTitle(config.project),
    labels: { [TARO_LABELS.project]: config.project, [TARO_LABELS.role]: "manager" },
    env: await taroEnvironment(config.project, paths.tracker),
    prompt,
  });
  await updateProjectConfig(config.project, { managerAgentId: agent.id });
  return { agentId: agent.id, workspaceId };
}

/** Starts the project's manager; refused when one is already running. */
export function launchManager(paseo: PaseoApi, project: string): Promise<{ agentId: string; workspaceId: string }> {
  return serialized(`manager:${project}`, async () => {
    const config = await requireProjectConfig(project);
    const current = await resolveManager(paseo, config);
    if (current.agent !== null) throw new Error(`${project} already has a manager (${current.agent.title ?? current.agent.id}).`);
    return startManager(paseo, config, false);
  });
}

/** Archives the manager and starts a fresh one; refused mid-turn so a dispatch is never cut in half. */
export function restartManager(paseo: PaseoApi, project: string): Promise<{ agentId: string; workspaceId: string }> {
  return serialized(`manager:${project}`, async () => {
    const config = await requireProjectConfig(project);
    const { agent } = await resolveManager(paseo, config);
    if (agent !== null) {
      if (isMidTurn(agent)) throw new Error(`The ${project} manager is in the middle of a turn. Restart it once it is idle.`);
      await paseo.agents.ref(agent.id).archive();
    }
    return startManager(paseo, config, agent !== null);
  });
}

async function requireManager(paseo: PaseoApi, project: string): Promise<PaseoAgent> {
  const { agent } = await resolveManager(paseo, await requireProjectConfig(project));
  if (agent === null) throw new Error(`${project} has no manager yet. Start it from the project's settings.`);
  return agent;
}

export async function tellManager(paseo: PaseoApi, project: string, text: string, attachments: Attachments = {}): Promise<string> {
  const words = text.trim();
  if (words === "" && !hasAttachments(attachments)) throw new Error("Say something to the manager.");
  const agent = await requireManager(paseo, project);
  await sendWithoutInterrupting(paseo, agent.id, words, await attachmentExtras(attachments));
  return agent.id;
}

export async function compactManager(paseo: PaseoApi, project: string): Promise<string> {
  const agent = await requireManager(paseo, project);
  if (isMidTurn(agent)) throw new Error(`The ${project} manager is in the middle of a turn. Compact it once it is idle.`);
  await sendCommand(paseo, agent.id, "/compact");
  return agent.id;
}

export async function catchUpText(project: string): Promise<string> {
  return message(TEMPLATES.catchUp, await projectValues(await requireProjectConfig(project)));
}
