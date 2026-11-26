/**
 * Adding a project (decision 13, spec §8 Phase 1): register the repository's
 * Paseo project, create the manager's home and the tracker worktree, write
 * `taro.json`, and start the manager.
 */
import { mkdir } from "node:fs/promises";

import { ProjectNameSchema, ProjectSettingsSchema, TicketPrefixSchema, type ProjectConfig, type ProjectSettings } from "../shared/project";
import { createProject } from "./cli";
import { writeTextIfMissing } from "./files";
import type { PaseoApi } from "./host-types";
import { launchManager } from "./manager";
import { TEMPLATES, readTemplate } from "./package-files";
import { createRepository, ensureFirstCommit, isValidBranchName, planRepository, type RepositoryPlan } from "./new-repository";
import { runChecked } from "./process";
import { listProjectConfigs, projectPaths, readProjectConfig, writeProjectConfig } from "./projects";
import { serialized } from "./serialize";
import { commitTracker, ensureTracker, gitCommonDirectory } from "./tracker";

export interface OnboardInput {
  project: string;
  settings: ProjectSettings;
  startManager: boolean;
}

async function paseoProjectFor(paseo: PaseoApi, repoRoot: string): Promise<string> {
  const listing = await paseo.projects.list();
  const existing = listing.projects.find((project) => project.projectRootPath === repoRoot);
  if (existing !== undefined) return existing.projectId;
  return (await createProject(repoRoot)).projectId;
}

export type OnboardingProblems = Partial<Record<"project" | "repoPath" | "ticketPrefix" | "baseBranch", string>>;

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  const refs = [`refs/heads/${branch}`, ...(await runChecked("git", ["-C", repoRoot, "remote"]).catch(() => "")).split("\n").filter((remote) => remote.trim() !== "").map((remote) => `refs/remotes/${remote.trim()}/${branch}`)];
  for (const ref of refs) {
    if (await runChecked("git", ["-C", repoRoot, "rev-parse", "--verify", "--quiet", ref]).then(() => true, () => false)) return true;
  }
  // A repository with no commits yet has its branch only as the name HEAD points at.
  const unborn = (await runChecked("git", ["-C", repoRoot, "symbolic-ref", "--quiet", "HEAD"]).catch(() => "")).trim();
  return unborn === `refs/heads/${branch}`;
}

/**
 * What would make adding this project fail, by the field it concerns, checked before anything is
 * created so the form shows it beside the field (TR-056). Empty when adding can go ahead. A name
 * already used for this same repository is fine: adding again repairs that project.
 */
export async function onboardingProblems(input: { project: string; settings: ProjectSettings }): Promise<OnboardingProblems> {
  const problems: OnboardingProblems = {};
  const name = ProjectNameSchema.safeParse(input.project);
  if (!name.success) problems.project = name.error.issues[0]?.message ?? "Not a valid name.";
  const prefix = TicketPrefixSchema.safeParse(input.settings.ticketPrefix);
  if (!prefix.success) problems.ticketPrefix = prefix.error.issues[0]?.message ?? "Not a valid prefix.";
  let plan: RepositoryPlan;
  try {
    plan = await planRepository(input.settings.repoPath);
  } catch (error) {
    problems.repoPath = error instanceof Error ? error.message : String(error);
    return problems;
  }
  // A repository still to be created has no git directory yet and clashes with no other project.
  const commonDirectory = plan.kind === "existing" ? await gitCommonDirectory(plan.root) : null;
  for (const other of await listProjectConfigs()) {
    const otherCommon = await gitCommonDirectory(other.repoPath).catch(() => null);
    // A project whose repository is gone may be moved to this one under its name: adding repairs it.
    if (other.project === input.project && otherCommon !== null && otherCommon !== commonDirectory) problems.project = `A Taro project is already named ${other.project}; choose another name.`;
    if (other.project !== input.project && commonDirectory !== null && otherCommon === commonDirectory) problems.repoPath = `This repository is already the Taro project ${other.project}.`;
  }
  const branch = input.settings.baseBranch.trim();
  if (plan.kind === "create" && branch !== "" && !(await isValidBranchName(branch))) problems.baseBranch = `${branch} is not a name git accepts for a branch.`;
  if (plan.kind === "existing" && branch !== "" && !(await branchExists(plan.root, branch))) problems.baseBranch = `The repository has no branch named ${branch}.`;
  return problems;
}

export function onboardProject(paseo: PaseoApi, input: OnboardInput): Promise<{ config: ProjectConfig; managerAgentId: string | null }> {
  const project = ProjectNameSchema.parse(input.project);
  return serialized("onboard", async () => {
    const settings = ProjectSettingsSchema.parse(input.settings);
    const plan = await planRepository(settings.repoPath);
    const commonDirectory = plan.kind === "existing" ? await gitCommonDirectory(plan.root) : null;

    const existing = await readProjectConfig(project);
    for (const other of await listProjectConfigs()) {
      if (other.project === project) continue;
      const otherCommon = await gitCommonDirectory(other.repoPath).catch(() => null);
      if (commonDirectory !== null && otherCommon === commonDirectory) throw new Error(`This repository is already the Taro project ${other.project}.`);
    }

    const repoRoot = await createRepository(plan, settings.baseBranch);
    await ensureFirstCommit(repoRoot, settings.baseBranch);
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
      // Adding again repairs a project; it never asks the start question a second time.
      start: existing?.start ?? null,
    });

    if (!input.startManager) return { config, managerAgentId: null };
    const { agentId } = await launchManager(paseo, project);
    return { config: { ...config, managerAgentId: agentId }, managerAgentId: agentId };
  });
}
