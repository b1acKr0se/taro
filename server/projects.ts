/**
 * Projects: one directory per project under `<taro home>/projects/`, each a
 * manager's home holding `taro.json`, the manager's instructions, standing
 * orders, suggestions and the tracker worktree.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { migrateStoredConfig, ProjectConfigSchema, type ProjectConfig } from "../shared/project";
import { readGlobalConfig, resolveTaroHome } from "./config";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import { serialized } from "./serialize";

export interface ProjectPaths {
  home: string;
  config: string;
  agents: string;
  standingOrders: string;
  suggestions: string;
  tracker: string;
}

export async function taroHome(): Promise<string> {
  return resolveTaroHome(await readGlobalConfig());
}

export async function projectsDirectory(): Promise<string> {
  return join(await taroHome(), "projects");
}

export function pathsFor(projectsRoot: string, project: string): ProjectPaths {
  const home = join(projectsRoot, project);
  return {
    home,
    config: join(home, "taro.json"),
    agents: join(home, "AGENTS.md"),
    standingOrders: join(home, "standing-orders.md"),
    suggestions: join(home, "suggestions.md"),
    tracker: join(home, "tracker"),
  };
}

export async function projectPaths(project: string): Promise<ProjectPaths> {
  return pathsFor(await projectsDirectory(), project);
}

export async function readProjectConfig(project: string): Promise<ProjectConfig | null> {
  const raw = await readJsonIfPresent((await projectPaths(project)).config);
  return raw === null ? null : ProjectConfigSchema.parse(migrateStoredConfig(raw));
}

export async function requireProjectConfig(project: string): Promise<ProjectConfig> {
  const config = await readProjectConfig(project);
  if (config === null) throw new Error(`Taro has no project named ${project}.`);
  return config;
}

export async function writeProjectConfig(config: ProjectConfig): Promise<ProjectConfig> {
  const parsed = ProjectConfigSchema.parse(config);
  await writeJsonAtomically((await projectPaths(parsed.project)).config, parsed);
  return parsed;
}

export async function updateProjectConfig(project: string, patch: Partial<ProjectConfig>): Promise<ProjectConfig> {
  const paths = await projectPaths(project);
  return serialized(paths.config, async () => {
    const current = await requireProjectConfig(project);
    return writeProjectConfig({ ...current, ...patch, project: current.project });
  });
}

/** Every project with a readable `taro.json`, by name. A broken one is skipped and logged. */
export async function listProjectConfigs(): Promise<ProjectConfig[]> {
  const root = await projectsDirectory();
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const configs = await Promise.all(
    names.map(async (name) => {
      try {
        const raw = await readJsonIfPresent(pathsFor(root, name).config);
        return raw === null ? null : ProjectConfigSchema.parse(migrateStoredConfig(raw));
      } catch (error) {
        console.error(`[taro] skipping project ${name}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }),
  );
  return configs.filter((config): config is ProjectConfig => config !== null).sort((left, right) => left.project.localeCompare(right.project));
}
