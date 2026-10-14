/**
 * The environment every Taro agent gets (spec §3): where the tracker is, so
 * the Backlog CLI cannot write to the wrong place, and where the skill is.
 * Set at launch by whoever launches, and again by the `agent.session_open`
 * hook, which also runs when an agent resumes.
 */
import { delimiter, dirname, isAbsolute, relative } from "node:path";

import { TARO_LABELS } from "../shared/project";
import { nodeDirectory, taroBacklogDirectory } from "./backlog-install";
import type { PaseoApi } from "./host-types";
import { projectEvidenceDirectory } from "./evidence";
import { skillDirectory } from "./package-files";
import { projectPaths, projectsDirectory } from "./projects";
import { backlogBinary } from "./tracker";

/**
 * When the `backlog` in use is the copy Taro installed (TR-063), its folder and the daemon's Node
 * go first on the agent's PATH, so the agent runs `backlog` as the plugin does.
 */
export function pathWithBacklog(backlog: string | null, basePath: string | undefined): Record<string, string> {
  if (backlog === null || dirname(backlog) !== taroBacklogDirectory()) return {};
  const first = [taroBacklogDirectory(), nodeDirectory()];
  // A resumed agent's PATH may hold them already: never twice.
  const rest = (basePath ?? "").split(delimiter).filter((part) => part !== "" && !first.includes(part));
  return { PATH: [...first, ...rest].join(delimiter) };
}

export async function taroEnvironment(project: string, trackerPath: string, basePath: string | undefined = process.env.PATH): Promise<Record<string, string>> {
  return {
    BACKLOG_CWD: trackerPath,
    TARO_PROJECT: project,
    TARO_TRACKER: trackerPath,
    TARO_SKILL: await skillDirectory(),
    TARO_EVIDENCE: projectEvidenceDirectory(project),
    ...pathWithBacklog(await backlogBinary(), basePath),
  };
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** The project an agent belongs to: by working directory inside a manager home, else by its label. */
export async function projectForSession(paseo: PaseoApi, agentId: string, cwd: string): Promise<string | null> {
  const root = await projectsDirectory();
  if (isInside(root, cwd)) {
    const name = relative(root, cwd).split(/[\\/]/)[0];
    if (name !== undefined && name !== "") return name;
  }
  try {
    const refreshed = await paseo.agents.ref(agentId).refresh();
    const project = refreshed?.agent.labels[TARO_LABELS.project];
    return typeof project === "string" && project !== "" ? project : null;
  } catch {
    return null;
  }
}

/** `basePath`: the PATH the session already asks for, if any, else the daemon's. */
export async function sessionEnvironment(paseo: PaseoApi, agentId: string, cwd: string, basePath?: string): Promise<Record<string, string> | null> {
  const project = await projectForSession(paseo, agentId, cwd);
  if (project === null) return null;
  const paths = await projectPaths(project);
  return taroEnvironment(project, paths.tracker, basePath ?? process.env.PATH);
}
