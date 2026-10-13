/**
 * The Paseo project named "Taro" that holds every manager's workspace
 * (decision 22). Created once, at the Taro home; each manager's home is
 * attached to it with `projectId`, so managers do not add a project each.
 */
import { mkdir } from "node:fs/promises";

import { readGlobalConfig, resolveTaroHome, updateGlobalConfig } from "./config";
import { createProject, renameProject } from "./cli";
import type { PaseoApi } from "./host-types";

export const TARO_PROJECT_NAME = "Taro";

async function projectExists(paseo: PaseoApi, projectId: string): Promise<boolean> {
  const listing = await paseo.projects.list();
  return listing.projects.some((project) => project.projectId === projectId);
}

export async function ensureTaroProject(paseo: PaseoApi): Promise<{ projectId: string; home: string }> {
  const config = await readGlobalConfig();
  const home = resolveTaroHome(config);
  if (config.taroProjectId !== "" && (await projectExists(paseo, config.taroProjectId))) {
    return { projectId: config.taroProjectId, home };
  }
  await mkdir(home, { recursive: true });
  const { projectId } = await createProject(home);
  await renameProject(projectId, TARO_PROJECT_NAME).catch((error: unknown) => {
    console.warn(`[taro] could not name the Taro project: ${error instanceof Error ? error.message : String(error)}`);
  });
  await updateGlobalConfig({ taroProjectId: projectId });
  return { projectId, home };
}
