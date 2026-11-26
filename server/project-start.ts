/**
 * "Is this a brand new project?": asked in the manager's place while a project's repository is
 * empty, its tracker has no tickets and the user has not chosen. Brand new sends the manager the
 * new-project message (a manager not running gets it when it starts, `managerPrompt`); either
 * choice is stored in `taro.json` so the question never comes back.
 */
import type { ProjectConfig, ProjectStart } from "../shared/project";
import { PARENT_AGENT_LABEL } from "../shared/unlabelled-agents";
import type { PaseoApi } from "./host-types";
import { newProjectMessage, resolveManager, tellManager } from "./manager";
import { runCommand } from "./process";
import { projectPaths, trackerHasTickets, updateProjectConfigIf } from "./projects";
import { identityFromLabels } from "./supervision";

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
  const later = (reason: string) => ({ told: false, reason, message: `${stored} The manager will get this when it starts (${reason}).` });
  if ((await resolveManager(paseo, config)).agent === null) return later("no manager running");
  try {
    await tellManager(paseo, project, await newProjectMessage(config));
  } catch (error) {
    return later(error instanceof Error ? error.message : String(error));
  }
  return { told: true, message: `${stored} The manager was told and starts asking.` };
}

/** How far up an unlabelled agent's parents to look, as the ticket buttons' check does. */
const PARENT_DEPTH = 3;

/**
 * The `taro project start-*` commands are the user's: refused inside any of the project's own
 * agents (its manager, owners and their subagents), which must ask the user. A lookup that fails
 * refuses; an agent Paseo does not know or has archived is not the project's.
 */
export async function refuseProjectAgent(paseo: PaseoApi, caller: string | undefined, project: string, action: string): Promise<void> {
  if (caller === undefined || caller === "") return;
  let agentId = caller;
  for (let depth = 1; depth <= PARENT_DEPTH; depth++) {
    let refreshed;
    try {
      refreshed = await paseo.agents.ref(agentId).refresh();
    } catch {
      throw new Error(`${action}: could not check who is asking; try again.`);
    }
    if (refreshed === null || (refreshed.agent.archivedAt !== null && refreshed.agent.archivedAt !== undefined)) return;
    const labels = refreshed.agent.labels;
    const identity = identityFromLabels(labels, refreshed.agent.title ?? null);
    if (identity !== null) {
      if (identity.project === project) throw new Error(`${action} is the user's: it refuses inside the project's own agents. Ask the user.`);
      return;
    }
    const parent = labels[PARENT_AGENT_LABEL];
    if (parent === undefined || parent === "") return;
    agentId = parent;
  }
}
