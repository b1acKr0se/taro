/**
 * A project's tracker: a git worktree of the project's repository on the
 * `taro/backlog` branch, holding a Backlog.md project (decision 31). The plugin
 * creates it, reads tickets through the Backlog CLI's JSON output, appends
 * answer records, and is the only committer.
 */
import { access, constants, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import type { TrackerSyncProblem } from "../shared/contracts";
import { TICKET_STATUSES } from "../shared/project";
import { commandError, runChecked, runCommand, type CommandResult } from "./process";

export const TRACKER_BRANCH = "taro/backlog";

let backlogLookup: Promise<string | null> | null = null;

async function findBacklog(): Promise<string | null> {
  const onPath = (process.env.PATH ?? "").split(delimiter).filter((directory) => directory !== "");
  const directories = [...onPath, join(homedir(), ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"];
  for (const directory of directories) {
    const candidate = join(directory, "backlog");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

export function backlogBinary(): Promise<string | null> {
  backlogLookup ??= findBacklog();
  return backlogLookup;
}

async function requireBacklog(): Promise<string> {
  const binary = await backlogBinary();
  if (binary === null) throw new Error("The Backlog.md CLI (`backlog`) is not installed on the daemon host.");
  return binary;
}

export async function runBacklog(trackerPath: string, args: readonly string[]): Promise<string> {
  return runChecked(await requireBacklog(), args, { cwd: trackerPath, env: { BACKLOG_CWD: trackerPath }, timeoutMs: 60_000 });
}

function git(directory: string, args: readonly string[]): Promise<string> {
  return runChecked("git", ["-C", directory, ...args], { timeoutMs: 120_000 });
}

async function gitSucceeds(directory: string, args: readonly string[]): Promise<boolean> {
  return (await runCommand("git", ["-C", directory, ...args], { timeoutMs: 60_000 })).code === 0;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The repository's absolute git common directory, used to tell two checkouts of one repository apart from two repositories. */
export async function gitCommonDirectory(directory: string): Promise<string> {
  return (await git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
}

export async function hasOriginRemote(repoPath: string): Promise<boolean> {
  return (await git(repoPath, ["remote"])).split("\n").map((line) => line.trim()).includes("origin");
}

export interface TrackerSetup {
  repoPath: string;
  trackerPath: string;
  project: string;
  ticketPrefix: string;
  baseBranch: string;
}

/**
 * Creates the tracker worktree (reusing a local or remote `taro/backlog`) and
 * initialises Backlog.md in it when it has no project yet. An existing tracker
 * is adopted as it is, with Taro's statuses ensured.
 */
export async function ensureTracker(setup: TrackerSetup): Promise<{ adopted: boolean }> {
  const { repoPath, trackerPath } = setup;
  if (!(await gitSucceeds(repoPath, ["rev-parse", "--is-inside-work-tree"]))) {
    throw new Error(`${repoPath} is not a git repository.`);
  }
  if (!(await exists(trackerPath))) {
    const origin = await hasOriginRemote(repoPath);
    let start = `refs/heads/${setup.baseBranch}`;
    if (origin) {
      await git(repoPath, ["fetch", "origin", setup.baseBranch]).catch(() => "");
      start = `refs/remotes/origin/${setup.baseBranch}`;
      const remote = (await git(repoPath, ["ls-remote", "--heads", "origin", `refs/heads/${TRACKER_BRANCH}`]).catch(() => "")).trim();
      if (remote !== "") await git(repoPath, ["fetch", "origin", `refs/heads/${TRACKER_BRANCH}:refs/remotes/origin/${TRACKER_BRANCH}`]);
    }
    const references = (await git(repoPath, ["for-each-ref", "--format=%(refname)"])).split("\n");
    if (references.includes(`refs/heads/${TRACKER_BRANCH}`)) {
      await git(repoPath, ["worktree", "add", trackerPath, TRACKER_BRANCH]);
    } else {
      if (references.includes(`refs/remotes/origin/${TRACKER_BRANCH}`)) start = `refs/remotes/origin/${TRACKER_BRANCH}`;
      else if (!references.includes(start)) start = "HEAD";
      await git(repoPath, ["worktree", "add", "-b", TRACKER_BRANCH, trackerPath, start]);
    }
  }
  const branch = (await git(trackerPath, ["symbolic-ref", "--short", "HEAD"])).trim();
  if (branch !== TRACKER_BRANCH) throw new Error(`${trackerPath} is on ${branch}, not ${TRACKER_BRANCH}.`);
  if ((await gitCommonDirectory(trackerPath)) !== (await gitCommonDirectory(repoPath))) {
    throw new Error(`${trackerPath} belongs to another repository.`);
  }

  const configPath = join(trackerPath, "backlog", "config.yml");
  const adopted = await exists(configPath);
  if (!adopted) {
    await runBacklog(trackerPath, [
      "init",
      setup.project,
      "--defaults",
      "--integration-mode",
      "none",
      "--task-prefix",
      setup.ticketPrefix,
      "--zero-padded-ids",
      "3",
      "--check-branches",
      "false",
      "--include-remote",
      "false",
      "--auto-open-browser",
      "false",
    ]);
    await runBacklog(trackerPath, ["config", "set", "defaultStatus", "Backlog"]);
    await runBacklog(trackerPath, ["config", "set", "autoCommit", "false"]);
  }
  await ensureStatuses(configPath);
  return { adopted };
}

/** Rewrites the inline `statuses:` list to Taro's, keeping any extra columns before Done. */
export async function ensureStatuses(configPath: string): Promise<void> {
  const text = await readFile(configPath, "utf8");
  const next = withTaroStatuses(text);
  if (next !== text) await writeFile(configPath, next, "utf8");
}

export function withTaroStatuses(configText: string): string {
  const match = /^statuses:\s*(\[.*\])\s*$/m.exec(configText);
  if (match === null || match[1] === undefined) throw new Error("The Backlog config has no inline statuses list.");
  let current: unknown;
  try {
    current = JSON.parse(match[1]);
  } catch {
    throw new Error("The Backlog config's statuses list is not a JSON-style list.");
  }
  const existing = Array.isArray(current) ? current.filter((status): status is string => typeof status === "string") : [];
  const extras = existing.filter((status) => !(TICKET_STATUSES as readonly string[]).includes(status));
  const statuses = [...TICKET_STATUSES.slice(0, -1), ...extras, "Done"];
  if (JSON.stringify(existing) === JSON.stringify(statuses)) return configText;
  return configText.replace(match[0], `statuses: ${JSON.stringify(statuses)}`);
}

/** Commits everything changed under `backlog/`; returns the commit message, or null when nothing changed. */
export async function commitTracker(trackerPath: string): Promise<string | null> {
  await git(trackerPath, ["add", "-A", "backlog"]);
  const staged = (await git(trackerPath, ["diff", "--cached", "--name-only"])).split("\n").filter((line) => line.trim() !== "");
  if (staged.length === 0) return null;
  const ticketIds = [...new Set(staged.map(ticketIdInPath).filter((id): id is string => id !== null))].sort();
  const subject = ticketIds.length === 0 ? "taro: update tracker" : `taro: update ${ticketIds.slice(0, 8).join(", ")}${ticketIds.length > 8 ? ", …" : ""}`;
  await git(trackerPath, ["-c", "user.name=Taro", "-c", "user.email=taro@localhost", "commit", "--no-verify", "-q", "-m", subject]);
  return subject;
}

/** `backlog/tasks/sh-012 - Title.md` → `SH-012`. */
export function ticketIdInPath(path: string): string | null {
  const match = /(?:^|\/)([a-z]+-\d+(?:\.\d+)*) - /i.exec(path);
  return match?.[1] === undefined ? null : match[1].toUpperCase();
}

/**
 * How a pull settles lines changed on both sides: plain rebase stops on them;
 * the others let one side win in those lines only (in a rebase, "theirs" is
 * the local commits being replayed).
 */
export type SyncStrategy = "rebase" | "keep-local" | "keep-remote";

const STRATEGY_OPTIONS: Readonly<Record<SyncStrategy, readonly string[]>> = {
  rebase: [],
  "keep-local": ["-X", "theirs"],
  "keep-remote": ["-X", "ours"],
};

/**
 * Pulls (rebase) and pushes `taro/backlog`; returns null when in sync, or the
 * problem instead of throwing. A conflicting rebase is aborted, so the tracker
 * stays on its branch with nothing lost.
 */
export async function syncTracker(trackerPath: string, strategy: SyncStrategy = "rebase"): Promise<TrackerSyncProblem | null> {
  const pull = await runCommand(
    "git",
    ["-C", trackerPath, "pull", "--rebase", "--autostash", ...STRATEGY_OPTIONS[strategy], "origin", TRACKER_BRANCH],
    { timeoutMs: 120_000 },
  );
  if (pull.code !== 0 && !/couldn't find remote ref/i.test(pull.stderr)) {
    const unmerged = await runCommand("git", ["-C", trackerPath, "diff", "--name-only", "--diff-filter=U"], { timeoutMs: 30_000 });
    const files = unmerged.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    await runCommand("git", ["-C", trackerPath, "rebase", "--abort"], { timeoutMs: 30_000 });
    if (files.length > 0) return conflictProblem(files);
    return { kind: "failed", message: `Pulling from origin failed: ${gitComplaint(pull)}`, tickets: [] };
  }
  const push = await runCommand("git", ["-C", trackerPath, "push", "-u", "origin", TRACKER_BRANCH], { timeoutMs: 120_000 });
  if (push.code !== 0) return { kind: "failed", message: `Pushing to origin failed: ${gitComplaint(push)}`, tickets: [] };
  return null;
}

export function conflictProblem(files: readonly string[]): TrackerSyncProblem {
  const tickets = [...new Set(files.map(ticketIdInPath).filter((id): id is string => id !== null))].sort();
  const others = files.filter((file) => ticketIdInPath(file) === null);
  const named = [...tickets, ...others];
  const subject = named.length <= 3 ? named.join(", ") : `${named.slice(0, 3).join(", ")} and ${named.length - 3} more`;
  return { kind: "conflict", message: `${subject} changed both here and on the remote.`, tickets };
}

/** Git's own reason (its fatal/error line), not the progress chatter that comes first on stderr. */
export function gitComplaint(result: CommandResult): string {
  const lines = `${result.stderr}\n${result.stdout}`.split("\n").map((line) => line.trim());
  return lines.find((line) => /^(fatal|error):/i.test(line)) ?? commandError(result);
}
