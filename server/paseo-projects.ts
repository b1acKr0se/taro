/**
 * Paseo's projects, for adding one to Taro (TR-056): each git project with its remote, default
 * branch, last use, and the Taro project it already is. Paseo knows the path and name; git knows
 * the rest, read once per repository for a short while since the picker asks every few seconds.
 */
import { stat } from "node:fs/promises";

import type { PaseoProjectCandidate, SettingsTemplate } from "../shared/project-candidates";
import type { ProjectConfig } from "../shared/project";
import type { PaseoApi } from "./host-types";
import { projectPaths } from "./projects";
import { runCommand } from "./process";

const GIT_FACTS_LIFETIME_MS = 20_000;
const WORKSPACE_PAGE = 500;

interface GitFacts {
  commonDirectory: string;
  remoteUrl: string | null;
  defaultBranch: string;
}

const gitFactsCache = new Map<string, { readAt: number; facts: GitFacts | null }>();

async function gitOutput(directory: string, args: readonly string[]): Promise<string | null> {
  const result = await runCommand("git", ["-C", directory, ...args], { timeoutMs: 15_000 }).catch(() => null);
  if (result === null || result.code !== 0) return null;
  const text = result.stdout.trim();
  return text === "" ? null : text;
}

/** The remote work is pushed to: origin when there is one, else the first. */
async function remoteName(directory: string): Promise<string | null> {
  const remotes = (await gitOutput(directory, ["remote"]))?.split("\n").map((line) => line.trim()).filter((line) => line !== "") ?? [];
  return remotes.includes("origin") ? "origin" : (remotes[0] ?? null);
}

/** Null when the directory is gone or is no longer a git repository. */
async function readGitFacts(directory: string): Promise<GitFacts | null> {
  const commonDirectory = await gitOutput(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (commonDirectory === null) return null;
  const remote = await remoteName(directory);
  const remoteUrl = remote === null ? null : await gitOutput(directory, ["remote", "get-url", remote]);
  const remoteHead = remote === null ? null : await gitOutput(directory, ["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`]);
  const defaultBranch =
    (remoteHead === null ? null : remoteHead.slice(remote === null ? 0 : remote.length + 1)) ?? (await gitOutput(directory, ["symbolic-ref", "--short", "HEAD"])) ?? "main";
  return { commonDirectory, remoteUrl, defaultBranch };
}

async function gitFacts(directory: string, now: number): Promise<GitFacts | null> {
  const cached = gitFactsCache.get(directory);
  if (cached !== undefined && now - cached.readAt < GIT_FACTS_LIFETIME_MS) return cached.facts;
  const facts = await readGitFacts(directory);
  gitFactsCache.set(directory, { readAt: now, facts });
  return facts;
}

/** For tests: forget what git said. */
export function forgetGitFacts(): void {
  gitFactsCache.clear();
}

/** When each Paseo project was last active: the newest activity of its workspaces. */
async function lastActivity(paseo: PaseoApi): Promise<Map<string, string>> {
  const listing = await paseo.workspaces.list({ sort: [{ key: "activity_at", direction: "desc" }], page: { limit: WORKSPACE_PAGE } }).catch(() => null);
  const latest = new Map<string, string>();
  for (const workspace of listing?.entries ?? []) {
    const at = workspace.activityAt ?? workspace.statusEnteredAt ?? null;
    if (at === null) continue;
    const known = latest.get(workspace.projectId);
    if (known === undefined || at > known) latest.set(workspace.projectId, at);
  }
  return latest;
}

/** The Paseo git projects whose repository is still there, each with what the picker shows. */
export async function listPaseoProjects(paseo: PaseoApi, configs: readonly ProjectConfig[], now = Date.now()): Promise<PaseoProjectCandidate[]> {
  const [listing, activity] = await Promise.all([paseo.projects.list(), lastActivity(paseo)]);
  const taroByCommonDirectory = new Map<string, string>();
  await Promise.all(
    configs.map(async (config) => {
      const facts = await gitFacts(config.repoPath, now);
      if (facts !== null) taroByCommonDirectory.set(facts.commonDirectory, config.project);
    }),
  );
  const candidates = await Promise.all(
    listing.projects
      .filter((project) => project.projectKind === "git")
      .map(async (project): Promise<PaseoProjectCandidate | null> => {
        const facts = await gitFacts(project.projectRootPath, now);
        if (facts === null) return null;
        const byPaseoId = configs.find((config) => config.paseoProjectId === project.projectId)?.project ?? null;
        return {
          paseoProjectId: project.projectId,
          name: project.projectCustomName ?? project.projectDisplayName,
          repoPath: project.projectRootPath,
          remoteUrl: facts.remoteUrl,
          defaultBranch: facts.defaultBranch,
          lastActiveAt: activity.get(project.projectId) ?? null,
          taroProject: taroByCommonDirectory.get(facts.commonDirectory) ?? byPaseoId,
        };
      }),
  );
  return candidates.filter((candidate): candidate is PaseoProjectCandidate => candidate !== null);
}

/** The settings of the project whose `taro.json` changed last: the one added or edited most recently. */
export async function settingsTemplate(configs: readonly ProjectConfig[]): Promise<SettingsTemplate | null> {
  const timed = await Promise.all(
    configs.map(async (config) => ({ config, changedAt: (await stat((await projectPaths(config.project)).config).catch(() => null))?.mtimeMs ?? 0 })),
  );
  const newest = timed.sort((left, right) => right.changedAt - left.changedAt)[0]?.config;
  if (newest === undefined) return null;
  return {
    project: newest.project,
    manager: newest.manager,
    owner: newest.owner,
    subagentModels: newest.subagentModels,
    delivery: newest.delivery,
    acceptAlsoMerges: newest.acceptAlsoMerges,
    trackerSync: newest.trackerSync,
    compactThresholdTokens: newest.compactThresholdTokens,
    idleCompactThresholdTokens: newest.idleCompactThresholdTokens,
    maxParallelOwners: newest.maxParallelOwners,
  };
}
