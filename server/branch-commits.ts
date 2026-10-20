/**
 * What an owner's worktree holds past the base branch, for the NO-PLAN guard (TR-206). Every git call
 * goes through process.ts.
 */
import { runChecked } from "./process";

/**
 * Commits on the worktree's HEAD that neither the local base branch nor origin's has; 0 when git
 * cannot tell. Both, as either may lag: the owner branched from origin's, and a local base left
 * behind would count origin's new commits as the owner's.
 */
export async function commitsPast(cwd: string, base: string): Promise<number> {
  const git = (args: readonly string[]) => runChecked("git", ["-C", cwd, ...args], { timeoutMs: 15_000 });
  const refs: string[] = [];
  for (const ref of [`refs/heads/${base}`, `refs/remotes/origin/${base}`]) {
    if (await git(["rev-parse", "--verify", "--quiet", ref]).then(() => true, () => false)) refs.push(ref);
  }
  if (refs.length === 0) return 0;
  const counted = await git(["rev-list", "--count", "HEAD", "--not", ...refs]).catch(() => "0");
  return Number.parseInt(counted.trim(), 10) || 0;
}

/** The worktree's branch, or words that stand in for it in a message. */
export async function branchName(cwd: string): Promise<string> {
  const name = await runChecked("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 15_000 }).catch(() => "");
  return name.trim() === "" ? "its branch" : name.trim();
}
