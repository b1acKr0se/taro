/**
 * A project's tracker: a git worktree of the project's repository on the
 * `taro/backlog` branch, holding Taro's ticket files (`tickets/`, `tracker.json`,
 * TR-081). The plugin creates it, reads and writes tickets in process through
 * the ticket store, and is the only committer.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TrackerSyncProblem } from "../shared/contracts";
import { commandError, runChecked, runCommand, type CommandResult } from "./process";

export const TRACKER_BRANCH = "taro/backlog";

/** What `.gitignore` at the tracker's root must list: the local lock folder and the store's temp files. */
export const TRACKER_IGNORED = [".taro/", "tickets/.*.tmp"] as const;

/** What a tracker commit takes: the tickets, tracker.json and .gitignore, never `.taro/` or a temp file, even when .gitignore lacks them. */
const COMMITTED_PATHS = ["tickets", "tracker.json", ".gitignore"] as const;
// `.taro/` lies outside these paths; naming it, even to exclude it, makes `git add` refuse once .gitignore lists it.
const NEVER_COMMITTED = [":(exclude)tickets/*.tmp"] as const;

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
 * Creates the tracker worktree (reusing a local or remote `taro/backlog`) and, when it has no
 * tracker yet, `tickets/`, `tracker.json` and `.gitignore`, committed. A tracker with tracker.json
 * is adopted as it is; one still in Backlog.md format is refused: `taro convert` converts it.
 */
export async function ensureTracker(setup: TrackerSetup): Promise<{ adopted: boolean }> {
  const { repoPath, trackerPath } = setup;
  // A branch made now from the base branch holds the project's files, not a tracker: a `backlog/` there is the project's own.
  let branchedFromBase = false;
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
      else {
        branchedFromBase = true;
        if (!references.includes(start)) start = "HEAD";
      }
      await git(repoPath, ["worktree", "add", "-b", TRACKER_BRANCH, trackerPath, start]);
    }
  }
  const branch = (await git(trackerPath, ["symbolic-ref", "--short", "HEAD"])).trim();
  if (branch !== TRACKER_BRANCH) throw new Error(`${trackerPath} is on ${branch}, not ${TRACKER_BRANCH}.`);
  if ((await gitCommonDirectory(trackerPath)) !== (await gitCommonDirectory(repoPath))) {
    throw new Error(`${trackerPath} belongs to another repository.`);
  }

  if (await exists(join(trackerPath, "tracker.json"))) return { adopted: true };
  if (!branchedFromBase && (await exists(join(trackerPath, "backlog", "config.yml")))) {
    throw new Error(
      `The tracker at ${trackerPath} is still in Backlog.md format (backlog/, no tracker.json). Convert it first: run \`taro convert --tracker ${trackerPath}\` (bin/taro in Taro's plugin folder), then add the project again.`,
    );
  }
  await mkdir(join(trackerPath, "tickets"), { recursive: true });
  const tracker = { schema: 1, prefix: setup.ticketPrefix, padding: 3, lastId: 0, lastChild: {} };
  await writeFile(join(trackerPath, "tracker.json"), `${JSON.stringify(tracker)}\n`, "utf8");
  const gitignore = join(trackerPath, ".gitignore");
  await writeFile(gitignore, withIgnoredEntries(await readFile(gitignore, "utf8").catch(() => "")), "utf8");
  await commitTracker(trackerPath);
  return { adopted: false };
}

/** `.gitignore` text with Taro's entries appended when missing; the repository's own lines are kept. */
export function withIgnoredEntries(existing: string): string {
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = TRACKER_IGNORED.filter((entry) => !present.has(entry));
  if (missing.length === 0) return existing;
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  return `${existing}${separator}${missing.join("\n")}\n`;
}

export interface TrackerCommit {
  /** The commit message, or null when nothing was committed. */
  subject: string | null;
  /** True when a ticket write held the tracker lock, so this pass committed nothing; a later pass does. */
  locked: boolean;
}

/** The committed paths that exist or are tracked: `git add` refuses a path that is neither. */
async function committablePaths(trackerPath: string): Promise<string[]> {
  const tracked = new Set((await git(trackerPath, ["ls-files", "--", ...COMMITTED_PATHS])).split("\n").map((line) => line.split("/")[0]));
  const paths: string[] = [];
  for (const path of COMMITTED_PATHS) {
    if (tracked.has(path) || (await exists(join(trackerPath, path)))) paths.push(path);
  }
  return paths;
}

/** The pathspecs a tracker commit and the backstop look at. */
export async function trackerPathspecs(trackerPath: string): Promise<string[]> {
  const paths = await committablePaths(trackerPath);
  return paths.length === 0 ? [] : [...paths, ...NEVER_COMMITTED];
}

/**
 * Commits the tickets, tracker.json and .gitignore. Skipped while a write holds `.taro/lock`, so a
 * half-made change of several files is never committed; the debounce or the backstop commits later.
 */
export async function commitTracker(trackerPath: string): Promise<TrackerCommit> {
  if (await exists(join(trackerPath, ".taro", "lock"))) return { subject: null, locked: true };
  const pathspecs = await trackerPathspecs(trackerPath);
  if (pathspecs.length === 0) return { subject: null, locked: false };
  await git(trackerPath, ["add", "-A", "--", ...pathspecs]);
  const staged = (await git(trackerPath, ["diff", "--cached", "--name-only"])).split("\n").filter((line) => line.trim() !== "");
  if (staged.length === 0) return { subject: null, locked: false };
  const ticketIds = [...new Set(staged.map(ticketIdInPath).filter((id): id is string => id !== null))].sort();
  const subject = ticketIds.length === 0 ? "taro: update tracker" : `taro: update ${ticketIds.slice(0, 8).join(", ")}${ticketIds.length > 8 ? ", …" : ""}`;
  await git(trackerPath, ["-c", "user.name=Taro", "-c", "user.email=taro@localhost", "commit", "--no-verify", "-q", "-m", subject]);
  return { subject, locked: false };
}

/** `tickets/TR-081.01.md` → `TR-081.01`. */
export function ticketIdInPath(path: string): string | null {
  const match = /(?:^|\/)tickets\/([A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*)\.md$/.exec(path);
  return match?.[1] ?? null;
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
 * Commits pending ticket writes, pulls (rebase) and pushes `taro/backlog`;
 * returns null when in sync, or the problem instead of throwing. Never
 * autostashes: popping a stash over a conflicting remote edit leaves conflict
 * markers in the tree, which the next commit would publish. A write landing
 * between the commit and the pull makes git refuse, so commit and try again.
 * A conflicting rebase is aborted, so the tracker stays on its branch with
 * nothing lost.
 */
export async function syncTracker(trackerPath: string, strategy: SyncStrategy = "rebase"): Promise<TrackerSyncProblem | null> {
  let pull: CommandResult | null = null;
  for (let attempt = 0; attempt < 3 && (pull === null || refusedForLocalChanges(pull)); attempt += 1) {
    await commitTracker(trackerPath);
    pull = await runCommand("git", ["-C", trackerPath, "pull", "--rebase", ...STRATEGY_OPTIONS[strategy], "origin", TRACKER_BRANCH], { timeoutMs: 120_000 });
  }
  if (pull === null || refusedForLocalChanges(pull)) {
    return { kind: "failed", message: "Tickets kept changing while syncing; it runs again after the next change.", tickets: [] };
  }
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

/** `git pull --rebase` refusing to start because the tree has uncommitted changes. */
function refusedForLocalChanges(result: CommandResult): boolean {
  return result.code !== 0 && /cannot pull with rebase|uncommitted changes|unstaged changes/i.test(result.stderr);
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
