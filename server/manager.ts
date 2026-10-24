/**
 * A project's manager: its instructions file, its workspace in the "Taro"
 * project, launching and restarting it, and carrying the user's words to it.
 * The manager triages and dispatches (decision 29); the plugin only sets it up.
 */
import { writeFile } from "node:fs/promises";

import { carriedSlot } from "../shared/chat-queue";
import { TARO_LABELS, type ProjectConfig } from "../shared/project";
import { refusedMessage } from "../shared/refused-commands";
import { fetchLiveAgent, isMidTurn } from "./agents";
import { runPaseoJson } from "./cli";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { bypassModeId, knownBypassMode } from "./models";
import { TEMPLATES, fill, message, readTemplate, skillDirectory } from "./package-files";
import { projectPaths, requireProjectConfig, updateProjectConfig } from "./projects";
import { sendFromPlugin } from "./send";
import { hasAttachments, sendWithAttachments, type Attachments } from "./uploads";
import type { ChatQueue } from "./chat-queue";
import { serialized } from "./serialize";
import type { PluginState } from "./state";
import { ensureTaroProject } from "./taro-project";
import { taroEnvironment } from "./environment";
import { identityFromLabels, type Supervisor } from "./supervision";

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

/** What carries a replaced manager's chat queue to the next one (TR-171). */
export type QueueCarrier = Pick<ChatQueue, "carry" | "claim">;

async function startManager(paseo: PaseoApi, config: ProjectConfig, restart: boolean, why: string | null, queue: QueueCarrier | null): Promise<{ agentId: string; workspaceId: string }> {
  await writeManagerInstructions(config);
  const workspaceId = await ensureManagerWorkspace(paseo, config);
  const values = await projectValues(config);
  const opening = await message(TEMPLATES.managerOpening, values);
  const prompt = [opening, ...(restart ? [await message(TEMPLATES.managerRestart, values)] : []), ...(why === null ? [] : [why])].join("\n\n");
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
  // The queue of the manager this one replaces, or of one replaced before a crash (TR-171).
  await queue?.claim(carriedSlot(config.project, "manager"), agent.id).catch((error: unknown) => console.warn(`[taro] ${config.project}: the new manager could not take over the chat queue: ${error instanceof Error ? error.message : String(error)}`));
  return { agentId: agent.id, workspaceId };
}

/** Starts the project's manager; refused when one is already running. */
export function launchManager(paseo: PaseoApi, project: string, queue: QueueCarrier | null = null): Promise<{ agentId: string; workspaceId: string }> {
  return serialized(`manager:${project}`, async () => {
    const config = await requireProjectConfig(project);
    const current = await resolveManager(paseo, config);
    if (current.agent !== null) throw new Error(`${project} already has a manager (${current.agent.title ?? current.agent.id}).`);
    return startManager(paseo, config, false, null, queue);
  });
}

/**
 * Archives the manager and starts a fresh one; refused mid-turn so a dispatch is never cut in half,
 * unless the caller judged the turn hung (`evenMidTurn`, TR-062). `why` is added to the new one's
 * first prompt.
 */
export function restartManager(
  paseo: PaseoApi,
  project: string,
  options: { why?: string; evenMidTurn?: boolean; queue?: QueueCarrier | null } = {},
): Promise<{ agentId: string; workspaceId: string }> {
  return serialized(`manager:${project}`, async () => {
    const config = await requireProjectConfig(project);
    const { agent } = await resolveManager(paseo, config);
    const queue = options.queue ?? null;
    if (agent !== null) {
      if (isMidTurn(agent) && options.evenMidTurn !== true) throw new Error(`The ${project} manager is in the middle of a turn. Restart it once it is idle.`);
      // The user's queued messages go to the fresh manager (TR-171): set aside before the archive, and again after it for one that came in between.
      const slot = carriedSlot(project, "manager");
      await queue?.carry(agent.id, slot);
      try {
        await paseo.agents.ref(agent.id).archive();
      } catch (error: unknown) {
        // Still the manager: its queue comes back.
        await queue?.claim(slot, agent.id).catch(() => undefined);
        throw error;
      }
      await queue?.carry(agent.id, slot);
    }
    return startManager(paseo, config, agent !== null, options.why ?? null, queue);
  });
}

/**
 * Brings the same manager back (TR-072): `paseo agent reload` (a new process, its conversation kept),
 * as crash recovery does, then one message saying it was restarted and why. A failed reload starts
 * nothing: the user chooses a fresh manager themselves.
 */
export function resumeManager(paseo: PaseoApi, project: string, state: Pick<PluginState, "agent" | "updateAgent">): Promise<{ agentId: string; workspaceId: string }> {
  return serialized(`manager:${project}`, async () => {
    const config = await requireProjectConfig(project);
    const { agent } = await resolveManager(paseo, config);
    if (agent === null) throw new Error(`${project} has no manager to resume. Start a fresh manager instead.`);
    if (isMidTurn(agent)) throw new Error(`The ${project} manager is in the middle of a turn, so it is not stopped; there is nothing to resume.`);
    const known = await state.agent(agent.id);
    const stalled = known?.stalledReason ?? null;
    try {
      await runPaseoJson(["agent", "reload", agent.id], "the manager cannot be reloaded");
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`The ${project} manager could not be resumed: ${reason}. Use Start a fresh manager instead; the old conversation is archived, not deleted.`);
    }
    // The crashed alert comes down now, not after the manager's next turn.
    if (known !== null && known.stalledReason !== null) {
      await state.updateAgent(agent.id, () => known, (record) => {
        record.stalled = false;
        record.stalledReason = null;
      });
    }
    const why =
      stalled !== null
        ? `after the plugin stopped recovering you (${stalled.replace(/^Crashed:\s*/, "").replace(/\.$/, "")})`
        : agent.status === "error"
          ? `after you stopped with an error (${(agent.lastError ?? "no reason given").replace(/\s+/g, " ").trim()})`
          : "at their request";
    await sendFromPlugin(paseo, agent.id, await message(TEMPLATES.managerResumed, { why, skill: await skillDirectory() }));
    return { agentId: agent.id, workspaceId: config.managerWorkspaceId };
  });
}

async function requireManager(paseo: PaseoApi, project: string): Promise<PaseoAgent> {
  const { agent } = await resolveManager(paseo, await requireProjectConfig(project));
  if (agent === null) throw new Error(`${project} has no manager yet. Start it from the project's settings.`);
  return agent;
}

/**
 * Words to the manager. From its chat (`chat` given) they wait in its queue while it works (TR-171),
 * unless they answer its pending request; anything else (Catch up, a spec change) is sent at once.
 */
export async function tellManager(
  paseo: PaseoApi,
  project: string,
  text: string,
  attachments: Attachments = {},
  chat: { queue: ChatQueue; answersRequest: boolean } | null = null,
): Promise<{ agentId: string; queued: boolean }> {
  const words = text.trim();
  if (words === "" && !hasAttachments(attachments)) throw new Error("Say something to the manager.");
  const refusal = refusedMessage(words);
  if (refusal !== null) throw new Error(refusal);
  const agent = await requireManager(paseo, project);
  if (chat !== null) return { agentId: agent.id, ...(await chat.queue.tell(paseo, agent, words, attachments, chat.answersRequest)) };
  await sendWithAttachments(paseo, agent.id, words, { ...attachments, agentMidTurn: isMidTurn(agent) });
  return { agentId: agent.id, queued: false };
}

/** The Compact button: the same handoff → /compact → reload pipeline as an idle compaction (TR-101), never a bare /compact. */
export async function compactManager(paseo: PaseoApi, project: string, supervisor: Pick<Supervisor, "startCompaction">): Promise<string> {
  const agent = await requireManager(paseo, project);
  if (isMidTurn(agent)) throw new Error(`The ${project} manager is in the middle of a turn. Compact it once it is idle.`);
  const identity = identityFromLabels(agent.labels, agent.title ?? null) ?? { project, role: "manager", ticket: null, title: agent.title ?? null };
  await supervisor.startCompaction(paseo, agent.id, identity, agent.lastUsage?.contextWindowUsedTokens ?? null, "button");
  return agent.id;
}

export async function catchUpText(project: string): Promise<string> {
  return message(TEMPLATES.catchUp, await projectValues(await requireProjectConfig(project)));
}
