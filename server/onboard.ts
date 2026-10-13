/**
 * Adding a project (decision 13, spec §8 Phase 1): register the repository's
 * Paseo project, create the manager's home and the tracker worktree, write
 * `taro.json`, and start the manager.
 */
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ProjectNameSchema, ProjectSettingsSchema, type ProjectConfig, type ProjectSettings } from "../shared/project";
import { createProject } from "./cli";
import { writeTextIfMissing } from "./files";
import type { PaseoApi } from "./host-types";
import { launchManager } from "./manager";
import { TEMPLATES, readTemplate } from "./package-files";
import { runChecked } from "./process";
import { listProjectConfigs, projectPaths, readProjectConfig, writeProjectConfig } from "./projects";
import { serialized } from "./serialize";
import { commitTracker, ensureTracker, gitCommonDirectory } from "./tracker";

export interface OnboardInput {
  project: string;
  settings: ProjectSettings;
  startManager: boolean;
}

async function repositoryRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`The repository path must be absolute, not "${path}".`);
  const top = (await runChecked("git", ["-C", path, "rev-parse", "--show-toplevel"]).catch(() => {
    throw new Error(`${path} is not inside a git repository.`);
  })).trim();
  return realpath(top);
}

async function paseoProjectFor(paseo: PaseoApi, repoRoot: string): Promise<string> {
  const listing = await paseo.projects.list();
  const existing = listing.projects.find((project) => project.projectRootPath === repoRoot);
  if (existing !== undefined) return existing.projectId;
  return (await createProject(repoRoot)).projectId;
}

export function onboardProject(paseo: PaseoApi, input: OnboardInput): Promise<{ config: ProjectConfig; managerAgentId: string | null }> {
  const project = ProjectNameSchema.parse(input.project);
  return serialized("onboard", async () => {
    const settings = ProjectSettingsSchema.parse(input.settings);
    const repoRoot = await repositoryRoot(settings.repoPath);
    const commonDirectory = await gitCommonDirectory(repoRoot);

    const existing = await readProjectConfig(project);
    for (const other of await listProjectConfigs()) {
      if (other.project === project) continue;
      const otherCommon = await gitCommonDirectory(other.repoPath).catch(() => null);
      if (otherCommon === commonDirectory) throw new Error(`This repository is already the Taro project ${other.project}.`);
    }

    const paseoProjectId = await paseoProjectFor(paseo, repoRoot);
    const paths = await projectPaths(project);
    await mkdir(paths.home, { recursive: true });
    await writeTextIfMissing(paths.standingOrders, await readTemplate(TEMPLATES.standingOrders));
    await writeTextIfMissing(paths.suggestions, await readTemplate(TEMPLATES.suggestions));

    await ensureTracker({
      repoPath: repoRoot,
      trackerPath: paths.tracker,
      project,
      ticketPrefix: settings.ticketPrefix,
      baseBranch: settings.baseBranch,
    });
    await commitTracker(paths.tracker);

    const config = await writeProjectConfig({
      ...settings,
      repoPath: repoRoot,
      schemaVersion: 1,
      project,
      paseoProjectId,
      managerAgentId: existing?.managerAgentId ?? "",
      managerWorkspaceId: existing?.managerWorkspaceId ?? "",
    });

    if (!input.startManager) return { config, managerAgentId: null };
    const { agentId } = await launchManager(paseo, project);
    return { config: { ...config, managerAgentId: agentId }, managerAgentId: agentId };
  });
}
