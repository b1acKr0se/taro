/**
 * Accept's merge, run by the plugin (TR-141) instead of the owner: every step an owner ran after
 * Accept (TR-109, TR-110), each safe to run again after a reload cut it off (TR-043). Commands go
 * through `run`, `runCommand` in the plugin, so tests answer them.
 */
import { acceptanceText, changedPaths, parsePullRequestView, shortSha, type AcceptOutcome } from "../shared/accept-merge";
import { MERGE_METHOD_TITLES, mergeFlag, parseAllowedMergeMethods, GH_ALLOWED_FIELDS, MERGE_METHODS } from "../shared/merge-method";
import type { MergeMethod } from "../shared/project";
import { commandError, type CommandOptions, type CommandResult } from "./process";

export type Run = (command: string, args: readonly string[], options?: CommandOptions) => Promise<CommandResult>;

/** Long enough for GitHub to merge and for a fetch over a slow link. */
const NETWORK_TIMEOUT_MS = 120_000;

interface Common {
  run: Run;
  ticket: string;
  at: () => string;
  baseBranch: string;
  repoPath: string;
}

export interface PullRequestAccept extends Common {
  url: string;
  head: string;
  method: MergeMethod;
}

export interface LocalAccept extends Common {
  /** The ticket's branch, most likely first: the first that exists is used. */
  branches: readonly string[];
  head: string;
}

/** A command's result, or its failure to start or finish as a result with the reason in stderr. */
async function attempt(run: Run, command: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
  try {
    return await run(command, args, options);
  } catch (error) {
    return { code: null, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

function git(input: Common, args: readonly string[], timeoutMs?: number): Promise<CommandResult> {
  return attempt(input.run, "git", ["-C", input.repoPath, ...args], timeoutMs === undefined ? {} : { timeoutMs });
}

/** The main checkout's state for a merge into it: null when it is on the base branch with nothing uncommitted, else why not. */
async function checkoutProblem(input: Common): Promise<string | null> {
  const { baseBranch, repoPath } = input;
  const branch = await git(input, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.code !== 0) return `git could not read the main checkout (${repoPath}): ${commandError(branch)}`;
  const current = branch.stdout.trim();
  if (current !== baseBranch) return `the main checkout (${repoPath}) is on ${current === "HEAD" ? "a detached HEAD" : current}, not ${baseBranch}; switch it to ${baseBranch}, then Accept again`;
  const status = await git(input, ["status", "--porcelain"]);
  if (status.code !== 0) return `git could not read the main checkout (${repoPath}): ${commandError(status)}`;
  if (status.stdout.trim() !== "") return `the main checkout (${repoPath}) has uncommitted or untracked changes (${changedPaths(status.stdout)}); commit or discard them, then Accept again`;
  return null;
}

async function headOf(input: Common, ref: string): Promise<string | null> {
  const result = await git(input, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return result.code === 0 ? result.stdout.trim().toLowerCase() : null;
}

async function isAncestor(input: Common, ancestor: string, descendant: string): Promise<boolean> {
  return (await git(input, ["merge-base", "--is-ancestor", ancestor, descendant])).code === 0;
}

async function viewPullRequest(input: PullRequestAccept) {
  const result = await attempt(input.run, "gh", ["pr", "view", input.url, "--json", "state,headRefOid,mergeCommit"], { cwd: input.repoPath, timeoutMs: NETWORK_TIMEOUT_MS });
  if (result.code !== 0) return { error: `gh pr view ${input.url} failed: ${commandError(result)}` };
  const view = parsePullRequestView(result.stdout);
  return view === null ? { error: `gh pr view ${input.url} answered something unexpected` } : { view };
}

/** Whether GitHub allows the method; null when gh cannot say, and then the merge itself decides. */
async function methodAllowed(input: PullRequestAccept): Promise<boolean | null> {
  const fields = MERGE_METHODS.map((method) => GH_ALLOWED_FIELDS[method]).join(",");
  const result = await attempt(input.run, "gh", ["repo", "view", "--json", fields], { cwd: input.repoPath, timeoutMs: NETWORK_TIMEOUT_MS });
  const allowed = result.code === 0 ? parseAllowedMergeMethods(result.stdout) : null;
  return allowed === null ? null : allowed[input.method];
}

/**
 * Pull request (TR-110): merge it with the project's method only while its head is the reviewed
 * one, then try to bring the main checkout's base branch up to origin's. A PR already MERGED (an earlier
 * Accept cut off by a reload) goes straight to the second part. The ticket closes either way (TR-215).
 */
export async function acceptPullRequest(input: PullRequestAccept): Promise<AcceptOutcome> {
  const { url, head, method, baseBranch, repoPath } = input;
  const title = MERGE_METHOD_TITLES[method];
  const before = await viewPullRequest(input);
  if (before.view === undefined) return { kind: "surprise", found: before.error };
  let view = before.view;
  let mergedNow = false;
  if (view.state !== "MERGED") {
    if (view.state !== "OPEN") return { kind: "surprise", found: `the pull request ${url} is ${view.state.toLowerCase()}, not open` };
    if (view.headRefOid !== head) return { kind: "surprise", found: `the pull request's head moved to ${view.headRefOid} since the review head ${head}; present it again` };
    if ((await methodAllowed(input)) === false)
      return { kind: "not-merged", reason: `GitHub does not allow the ${title} method in this repository; pick another Merge method in the project's settings, or allow it on GitHub, then Accept again` };
    const merge = await attempt(input.run, "gh", ["pr", "merge", url, mergeFlag(method), "--match-head-commit", head], { cwd: repoPath, timeoutMs: NETWORK_TIMEOUT_MS });
    if (merge.code !== 0) return { kind: "surprise", found: `gh pr merge ${url} ${mergeFlag(method)} failed: ${commandError(merge)}` };
    const after = await viewPullRequest(input);
    if (after.view === undefined) return { kind: "surprise", found: `the merge was sent, then ${after.error}` };
    view = after.view;
    if (view.state !== "MERGED") return { kind: "surprise", found: `gh pr merge succeeded but the pull request is ${view.state.toLowerCase()}, not merged` };
    mergedNow = true;
  }
  const mergeCommit = view.mergeCommit ?? head;
  const merged = mergedNow ? `merged ${url} with ${title}` : `${url} was already merged`;

  // The pull request is merged: whatever stops the local base branch following it (TR-215) is a note on the closed ticket, not a reason to keep it open.
  const local = await syncLocalBase(input);
  return { kind: "done", acceptance: acceptanceText(input.at(), input.ticket, `Accepted ${head}, PR ${url}; ${merged}; ${local}`, `merged ${mergeCommit}`) };
}

/** Fast-forwards the main checkout's base branch to origin's; the ACCEPTANCE phrase for what happened, a failure included. */
async function syncLocalBase(input: PullRequestAccept): Promise<string> {
  const { baseBranch, repoPath } = input;
  const problem = await checkoutProblem(input);
  if (problem !== null) return `local ${baseBranch} not updated: ${problem}`;
  const old = await headOf(input, "HEAD");
  const fetch = await git(input, ["fetch", "origin", baseBranch], NETWORK_TIMEOUT_MS);
  if (fetch.code !== 0) return `local ${baseBranch} not updated: fetching origin ${baseBranch} into ${repoPath} failed (${commandError(fetch)})`;
  const forward = await git(input, ["merge", "--ff-only", `origin/${baseBranch}`]);
  if (forward.code !== 0) return `local ${baseBranch} not updated: ${baseBranch} in ${repoPath} has commits origin lacks`;
  const now = await headOf(input, "HEAD");
  return old === now ? `local ${baseBranch} already at ${shortSha(now ?? "")}` : `local ${baseBranch} ${shortSha(old ?? "")} → ${shortSha(now ?? "")}`;
}

/**
 * Local branch (TR-109): fast-forward the base branch in the main checkout to the reviewed head.
 * A base branch that moved needs a rebase and the project's checks, which only an owner can run.
 */
export async function acceptLocalBranch(input: LocalAccept): Promise<AcceptOutcome> {
  const { head, baseBranch, repoPath } = input;
  const base = await headOf(input, `refs/heads/${baseBranch}`);
  if (base === null) return { kind: "surprise", found: `${repoPath} has no branch ${baseBranch}` };
  // Already there: an earlier run fast-forwarded it and a reload cut it off before the record.
  if (await isAncestor(input, head, base)) return { kind: "done", acceptance: acceptanceText(input.at(), input.ticket, `Accepted ${head}; ${baseBranch} already contains it at ${shortSha(base)}`, `merged ${shortSha(base)} → ${shortSha(base)}`) };
  let branch = "";
  let branchHead: string | null = null;
  for (const candidate of input.branches) {
    branchHead = await headOf(input, `refs/heads/${candidate}`);
    branch = candidate;
    if (branchHead !== null) break;
  }
  if (branchHead === null) return { kind: "surprise", found: `${repoPath} has no branch ${[...new Set(input.branches)].join(" or ")}` };
  if (branchHead !== head) return { kind: "surprise", found: `${branch} moved to ${branchHead} since the review head ${head}; present it again` };
  const problem = await checkoutProblem(input);
  if (problem !== null) return { kind: "not-merged", reason: problem };
  if (!(await isAncestor(input, base, head)))
    return { kind: "surprise", found: `${baseBranch} moved to ${base} since ${branch}; rebase onto it, and fast-forward only if it applied with no conflicts and the checks pass` };
  const forward = await git(input, ["merge", "--ff-only", head]);
  if (forward.code !== 0) return { kind: "surprise", found: `git merge --ff-only ${head} in ${repoPath} failed: ${commandError(forward)}` };
  const now = await headOf(input, "HEAD");
  if (now !== head) return { kind: "surprise", found: `after the fast-forward ${baseBranch} is at ${now ?? "an unreadable head"}, not ${head}` };
  return { kind: "done", acceptance: acceptanceText(input.at(), input.ticket, `Accepted ${head}; fast-forwarded ${baseBranch}`, `merged ${shortSha(base)} → ${shortSha(head)}`) };
}
