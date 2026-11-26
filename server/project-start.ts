/**
 * "Is this a brand new project?": asked in the manager's place while a project's repository is
 * empty, its tracker has no tickets and the user has not chosen. Brand new sends the manager the
 * new-project message (a manager not running gets it when it starts, `managerPrompt`); either
 * choice is stored in `taro.json` so the question never comes back.
 */
import { NO_MANAGER_RUNNING, type ProjectConfig, type ProjectStart } from "../shared/project";
import type { PaseoApi } from "./host-types";
import { newProjectMessage, resolveManager, tellManager } from "./manager";
import { runCommand } from "./process";
import { projectPaths, trackerHasTickets, updateProjectConfigIf } from "./projects";

/** What git answers about a repository: empty (at most one commit, no files) or not; null when git failed. */
export async function repositoryIsEmpty(repoPath: string): Promise<boolean | null> {
  const git = (args: string[]) => runCommand("git", ["-C", repoPath, ...args], { timeoutMs: 10_000 });
  // HEAD only, never --all: the tracker's branch lives in this repository too.
  const count = await git(["rev-list", "--count", "HEAD"]);
  if (count.code === 0) {
    if (Number(count.stdout.trim()) > 1) return false;
  } else {
    // No HEAD yet counts as no commits; any other failure is git's.
    const inside = await git(["rev-parse", "--is-inside-work-tree"]);
    if (inside.code !== 0 || inside.stdout.trim() !== "true") return null;
  }
  const tracked = await git(["ls-files"]);
  if (tracked.code !== 0) return null;
  if (tracked.stdout.trim() !== "") return false;
  // A folder of files never committed is not empty; ignored files alone are.
  const untracked = await git(["ls-files", "--others", "--exclude-standard"]);
  if (untracked.code !== 0) return null;
  return untracked.stdout.trim() === "";
}

/** Projects git found work in, by project and repository: they never ask again until the plugin restarts. */
const notEmpty = new Set<string>();

/** For tests: forget what git answered. */
export function forgetStartAnswers(): void {
  notEmpty.clear();
}

/** Whether the project asks the start question now; any failure answers no, so a project with work is never asked. */
export async function asksStart(config: ProjectConfig): Promise<boolean> {
  if (config.start !== null) return false;
  const key = `${config.project}\u0000${config.repoPath}`;
  if (notEmpty.has(key)) return false;
  try {
    if (await trackerHasTickets((await projectPaths(config.project)).tracker)) return false;
    const empty = await repositoryIsEmpty(config.repoPath);
    if (empty === false) notEmpty.add(key);
    return empty === true;
  } catch {
    return false;
  }
}

const CHOICE_WORDS: Record<ProjectStart, string> = { new: "brand new project", existing: "existing project" };

/**
 * The user's answer: stored under the config's lock only while the question still stands, so two
 * presses at once store one and send one message; then, for a brand new project, the manager is told.
 */
export async function chooseStart(paseo: PaseoApi, project: string, choice: ProjectStart): Promise<{ told: boolean; reason?: string; message: string }> {
  const config = await updateProjectConfigIf(
    project,
    async (current) => {
      if (current.start !== null) return `Already chosen: ${current.start}.`;
      if (!(await asksStart(current))) return "This project already has work; nothing to choose.";
      return null;
    },
    { start: choice },
  );
  const stored = `${project} is a ${CHOICE_WORDS[choice]}.`;
  if (choice === "existing") return { told: false, message: stored };
  if ((await resolveManager(paseo, config)).agent === null) return { told: false, reason: NO_MANAGER_RUNNING, message: `${stored} The manager will get this when it starts.` };
  try {
    await tellManager(paseo, project, await newProjectMessage(config));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { told: false, reason, message: `${stored} The manager could not be told (${reason}); a fresh manager gets this when it starts, or tell it yourself.` };
  }
  return { told: true, message: `${stored} The manager was told and starts asking.` };
}
