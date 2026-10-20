/** The saved order of the project tabs (`<taro home>/project-order.json`) and when each project was made. */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { orderProjects } from "../shared/project-order";
import type { ProjectConfig } from "../shared/project";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import { projectPaths, taroHome } from "./projects";
import { serialized } from "./serialize";

const SavedOrderSchema = z.array(z.string());

async function orderFile(): Promise<string> {
  return join(await taroHome(), "project-order.json");
}

async function savedOrder(): Promise<string[]> {
  try {
    return SavedOrderSchema.parse(await readJsonIfPresent(await orderFile()));
  } catch {
    // Null (no file yet) or a damaged file: the default order, never an error on the project list.
    return [];
  }
}

/** The folder's birth time; a file system that has none reports 0, so fall back to its change time. */
async function createdMs(project: string): Promise<number> {
  try {
    const { birthtimeMs, ctimeMs } = await stat((await projectPaths(project)).home);
    return birthtimeMs > 0 ? birthtimeMs : ctimeMs;
  } catch {
    return 0;
  }
}

/** The projects as the tabs show them. */
export async function inTabOrder(configs: readonly ProjectConfig[]): Promise<ProjectConfig[]> {
  const [saved, created] = await Promise.all([savedOrder(), Promise.all(configs.map((config) => createdMs(config.project)))]);
  const entries = configs.map((config, index) => ({ config, name: config.project, createdMs: created[index] ?? 0 }));
  return orderProjects(entries, saved).map((entry) => entry.config);
}

export async function saveTabOrder(names: readonly string[]): Promise<void> {
  const file = await orderFile();
  await serialized(file, () => writeJsonAtomically(file, [...new Set(names)]));
}
