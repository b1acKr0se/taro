/**
 * The environment every Taro agent gets (spec §3): where the tracker, the skill and the evidence
 * folder are, and the `taro` command first on PATH, run by the daemon's own Node (TR-081). Set at
 * launch by whoever launches, and again by the `agent.session_open` hook, which also runs when an
 * agent resumes.
 */
import { delimiter, isAbsolute, join, relative } from "node:path";

import { TARO_LABELS } from "../shared/project";
import type { PaseoApi } from "./host-types";
import { projectEvidenceDirectory } from "./evidence";
import { packageDirectory, skillDirectory } from "./package-files";
import { projectPaths, projectsDirectory } from "./projects";

/** PATH with the plugin's `bin` folder first, once: a resumed agent's PATH may hold it already. */
export function pathWithTaro(binDirectory: string, basePath: string | undefined): string {
  const rest = (basePath ?? "").split(delimiter).filter((part) => part !== "" && part !== binDirectory);
  return [binDirectory, ...rest].join(delimiter);
}

export async function taroEnvironment(project: string, trackerPath: string, basePath: string | undefined = process.env.PATH): Promise<Record<string, string>> {
  return {
    TARO_PROJECT: project,
    TARO_TRACKER: trackerPath,
    TARO_SKILL: await skillDirectory(),
    TARO_EVIDENCE: projectEvidenceDirectory(project),
    TARO_NODE: process.execPath,
    PATH: pathWithTaro(join(await packageDirectory(), "bin"), basePath),
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
