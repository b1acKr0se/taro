/**
 * A project's repository may not exist yet: a missing folder, or a folder that is not a git
 * repository, is created and initialised on the chosen base branch, and a repository with no
 * commits gets one empty commit so the first ticket has something to branch from. The user's
 * files are never staged or committed.
 */
import { access, constants, mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { runChecked, runCommand } from "./process";

export type RepositoryPlan = { kind: "existing"; root: string } | { kind: "create"; path: string };

async function gitOutput(directory: string, args: readonly string[]): Promise<string | null> {
  const result = await runCommand("git", ["-C", directory, ...args], { timeoutMs: 60_000 }).catch(() => null);
  return result === null || result.code !== 0 ? null : result.stdout.trim();
}

async function isDirectory(path: string): Promise<boolean | null> {
  return stat(path).then((entry) => entry.isDirectory(), () => null);
}

/** What adding this path does, or an error saying why it cannot be a project's repository. Creates nothing. */
export async function planRepository(path: string): Promise<RepositoryPlan> {
  if (!isAbsolute(path)) throw new Error(`The repository path must be absolute, not "${path}".`);
  const kind = await isDirectory(path);
  if (kind === false) throw new Error(`${path} is a file, not a folder.`);
  let probe = path;
  while ((await isDirectory(probe)) === null) probe = dirname(probe);
  const top = await gitOutput(probe, ["rev-parse", "--show-toplevel"]);
  if (top !== null && top !== "") {
    if (kind === true) return { kind: "existing", root: await realpath(top) };
    throw new Error(`${path} does not exist and would sit inside the git repository ${top}; choose a folder outside it, or one that exists.`);
  }
  const writable = await access(probe, constants.W_OK).then(() => true, () => false);
  if (!writable) throw new Error(`Taro cannot create ${path}: ${probe} is not writable.`);
  return { kind: "create", path };
}

/** Makes the folder and repository a plan asks for; returns the repository's root. */
export async function createRepository(plan: RepositoryPlan, baseBranch: string): Promise<string> {
  if (plan.kind === "existing") return plan.root;
  await mkdir(plan.path, { recursive: true });
  await runChecked("git", ["-C", plan.path, "init", "-q", "-b", baseBranch]);
  return realpath(plan.path);
}

/** One empty commit on the base branch when the repository has none; Taro's own identity only when git has none. */
export async function ensureFirstCommit(root: string, baseBranch: string): Promise<void> {
  if ((await gitOutput(root, ["rev-parse", "--verify", "--quiet", "HEAD"])) !== null) return;
  if ((await gitOutput(root, ["symbolic-ref", "--quiet", "HEAD"])) !== `refs/heads/${baseBranch}`) return;
  const identity: string[] = [];
  if (((await gitOutput(root, ["config", "user.name"])) ?? "") === "") identity.push("-c", "user.name=Taro");
  if (((await gitOutput(root, ["config", "user.email"])) ?? "") === "") identity.push("-c", "user.email=taro@localhost");
  await runChecked("git", ["-C", root, ...identity, "commit", "-q", "--allow-empty", "-m", "chore: start the project"]);
}
