// A stand-in for the GitHub CLI, for end-to-end runs of pull-request delivery that must publish
// nothing (TR-013). The repository's `origin` is a local bare repository; a PR's head is that
// origin's branch tip, read live, so a push moves it just as on GitHub. PR state lives in
// $GH_STUB_STATE/prs.json and every call is appended to $GH_STUB_STATE/calls.jsonl. It never
// touches the network. Unsupported commands fail loudly (exit 1) so a run shows what agents tried.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const stateDirectory = process.env.GH_STUB_STATE ?? join(tmpdir(), "gh-stub");
mkdirSync(stateDirectory, { recursive: true });
const prsPath = join(stateDirectory, "prs.json");
const args = process.argv.slice(2);

class Refusal extends Error {}

function git(gitArgs, options = {}) {
  return execFileSync("git", gitArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function loadPrs() {
  try {
    return JSON.parse(readFileSync(prsPath, "utf8"));
  } catch {
    return [];
  }
}

function savePrs(prs) {
  writeFileSync(prsPath, `${JSON.stringify(prs, null, 2)}\n`);
}

/** The value after a flag (`--title x`, `--title=x`, or a short alias), else null. */
function flag(names) {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    for (const name of names) {
      if (argument === name) return args[index + 1] ?? null;
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
    }
  }
  return null;
}

function has(name) {
  return args.includes(name);
}

/** Positional arguments after `pr <verb>`, skipping flags and their values. */
function positionals() {
  const valued = new Set(["--title", "-t", "--body", "-b", "--body-file", "-F", "--base", "-B", "--head", "-H", "--json", "--jq", "-q", "--match-head-commit", "--subject", "--state", "--repo", "-R", "--label", "-l", "--assignee", "-a", "--reviewer", "--template", "-T"]);
  const found = [];
  for (let index = 2; index < args.length; index++) {
    const argument = args[index];
    if (valued.has(argument)) index++;
    else if (!argument.startsWith("-")) found.push(argument);
  }
  return found;
}

function originPath() {
  try {
    return git(["remote", "get-url", "origin"]);
  } catch {
    throw new Refusal("no git remote named origin in this directory");
  }
}

function repositoryName(origin) {
  return basename(origin).replace(/\.git$/, "");
}

function originTip(origin, branch) {
  try {
    return git(["--git-dir", origin, "rev-parse", `refs/heads/${branch}`]);
  } catch {
    return null;
  }
}

/** The PR a selector names: a URL, a number, a branch, or (none) the current branch. */
function findPr(prs, selector) {
  const wanted = selector ?? git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const number = /^\d+$/.test(wanted) ? Number(wanted) : Number(/\/pull\/(\d+)$/.exec(wanted)?.[1] ?? Number.NaN);
  const pr = Number.isNaN(number)
    ? [...prs].reverse().find((candidate) => candidate.headRefName === wanted)
    : prs.find((candidate) => candidate.number === number);
  if (pr === undefined) throw new Refusal(`no pull requests found for ${wanted}`);
  return pr;
}

/** A PR as `gh pr view --json` reports it, with the head and merge state read live from origin. */
function viewOf(pr) {
  const head = pr.state === "MERGED" ? pr.mergedHeadRefOid : originTip(pr.origin, pr.headRefName);
  let mergeStateStatus = "UNKNOWN";
  if (pr.state === "OPEN" && head !== null) {
    if (pr.isDraft) mergeStateStatus = "DRAFT";
    else {
      const base = originTip(pr.origin, pr.baseRefName);
      mergeStateStatus = base !== null && mergesCleanly(pr.origin, base, head) ? "CLEAN" : "DIRTY";
    }
  }
  return {
    number: pr.number,
    url: pr.url,
    title: pr.title,
    body: pr.body,
    state: pr.state,
    isDraft: pr.isDraft,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    headRefOid: head,
    mergeStateStatus,
    mergeable: mergeStateStatus === "DIRTY" ? "CONFLICTING" : "MERGEABLE",
    mergeCommit: pr.mergeCommit === null ? null : { oid: pr.mergeCommit },
    comments: pr.comments,
    reviewDecision: "",
    statusCheckRollup: [],
  };
}

function mergesCleanly(origin, base, head) {
  try {
    git(["--git-dir", origin, "merge-tree", "--write-tree", base, head]);
    return true;
  } catch {
    return false;
  }
}

function printView(view) {
  const fields = flag(["--json"]);
  if (fields === null) {
    process.stdout.write(`${view.title}\n${view.url}\nstate: ${view.isDraft && view.state === "OPEN" ? "DRAFT" : view.state}\nhead: ${view.headRefName} ${view.headRefOid}\nbase: ${view.baseRefName}\n`);
    return;
  }
  const picked = Object.fromEntries(fields.split(",").map((field) => [field, view[field] ?? null]));
  const jq = flag(["--jq", "-q"]);
  if (jq === null) process.stdout.write(`${JSON.stringify(picked, null, 2)}\n`);
  else if (/^\.[A-Za-z]+$/.test(jq)) {
    const value = picked[jq.slice(1)];
    process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);
  } else throw new Refusal(`stub gh supports only --jq .field, not ${jq}`);
}

function bodyText() {
  const file = flag(["--body-file", "-F"]);
  if (file !== null) return file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  return flag(["--body", "-b"]) ?? "";
}

function create(prs) {
  const origin = originPath();
  const head = flag(["--head", "-H"]) ?? git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const base = flag(["--base", "-B"]) ?? git(["--git-dir", origin, "symbolic-ref", "--short", "HEAD"]);
  if (originTip(origin, head) === null) throw new Refusal(`you must first push the current branch to a remote: ${head} is not on origin`);
  if (originTip(origin, base) === null) throw new Refusal(`base branch ${base} is not on origin`);
  if (prs.some((pr) => pr.origin === origin && pr.headRefName === head && pr.state === "OPEN")) throw new Refusal(`a pull request for branch "${head}" into branch "${base}" already exists`);
  const number = prs.length + 1;
  const pr = {
    number,
    url: `https://github.com/stub-owner/${repositoryName(origin)}/pull/${number}`,
    origin,
    title: flag(["--title", "-t"]) ?? head,
    body: bodyText(),
    headRefName: head,
    baseRefName: base,
    isDraft: has("--draft") || has("-d"),
    state: "OPEN",
    comments: [],
    mergeCommit: null,
    mergedHeadRefOid: null,
  };
  prs.push(pr);
  savePrs(prs);
  process.stdout.write(`${pr.url}\n`);
}

function merge(prs) {
  const pr = findPr(prs, positionals()[0] ?? null);
  if (pr.state !== "OPEN") throw new Refusal(`pull request #${pr.number} is ${pr.state.toLowerCase()} and cannot be merged`);
  if (pr.isDraft) throw new Refusal(`pull request #${pr.number} is still a draft`);
  const head = originTip(pr.origin, pr.headRefName);
  const expected = flag(["--match-head-commit"]);
  // GitHub compares the full SHA: a short or stale one is refused, never matched by prefix.
  if (expected !== null && expected !== head) throw new Refusal(`Head branch was modified. Review and try the merge again. (expected ${expected}, head is ${head})`);
  const base = originTip(pr.origin, pr.baseRefName);
  if (!mergesCleanly(pr.origin, base, head)) throw new Refusal(`pull request #${pr.number} is not mergeable: the merge commit cannot be cleanly created`);
  const method = has("--rebase") || has("-r") ? "rebase" : has("--merge") || has("-m") ? "merge" : "squash";
  const work = mkdtempSync(join(tmpdir(), "gh-stub-merge-"));
  try {
    git(["clone", "--quiet", "--branch", pr.baseRefName, pr.origin, work]);
    const inWork = { cwd: work };
    git(["config", "user.name", "gh stub"], inWork);
    git(["config", "user.email", "gh-stub@example.invalid"], inWork);
    git(["fetch", "--quiet", "origin", pr.headRefName], inWork);
    if (method === "merge") git(["merge", "--no-ff", "-m", `Merge pull request #${pr.number} from ${pr.headRefName}`, "FETCH_HEAD"], inWork);
    else {
      git(["merge", "--squash", "FETCH_HEAD"], inWork);
      git(["commit", "--quiet", "-m", `${pr.title} (#${pr.number})`], inWork);
    }
    git(["push", "--quiet", "origin", `HEAD:${pr.baseRefName}`], inWork);
    pr.mergeCommit = git(["rev-parse", "HEAD"], inWork);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  pr.state = "MERGED";
  pr.mergedHeadRefOid = head;
  pr.mergeMethod = method;
  if (has("--delete-branch") || has("-d")) git(["--git-dir", pr.origin, "update-ref", "-d", `refs/heads/${pr.headRefName}`]);
  savePrs(prs);
  process.stdout.write(`✓ ${method === "squash" ? "Squashed and merged" : "Merged"} pull request #${pr.number} (${pr.title})\n`);
}

function run() {
  const [group, verb] = args;
  if (group === "--version" || group === "version") return void process.stdout.write("gh version 0.0.0-stub (TR-013 stub)\n");
  if (group === "auth" && verb === "status") return void process.stdout.write("github.com\n  ✓ Logged in to github.com as stub-user (stub gh: nothing is sent anywhere)\n");
  if (group !== "pr") throw new Refusal(`stub gh does not support "${args.join(" ")}"`);
  const prs = loadPrs();
  const selector = positionals()[0] ?? null;
  switch (verb) {
    case "create":
      return create(prs);
    case "view":
      return printView(viewOf(findPr(prs, selector)));
    case "list":
      return void process.stdout.write(`${prs.filter((pr) => pr.state === "OPEN").map((pr) => `${pr.number}\t${pr.title}\t${pr.headRefName}\t${pr.isDraft ? "DRAFT" : "OPEN"}`).join("\n")}\n`);
    case "ready": {
      const pr = findPr(prs, selector);
      pr.isDraft = has("--undo");
      savePrs(prs);
      return void process.stdout.write(`✓ Pull request #${pr.number} is ${pr.isDraft ? "converted to draft" : "marked as ready for review"}\n`);
    }
    case "comment": {
      const pr = findPr(prs, selector);
      pr.comments.push({ body: bodyText(), createdAt: new Date().toISOString() });
      savePrs(prs);
      return void process.stdout.write(`${pr.url}#issuecomment-${pr.comments.length}\n`);
    }
    case "merge":
      return merge(prs);
    case "diff": {
      const pr = findPr(prs, selector);
      return void process.stdout.write(`${git(["--git-dir", pr.origin, "diff", `refs/heads/${pr.baseRefName}...refs/heads/${pr.headRefName}`])}\n`);
    }
    default:
      throw new Refusal(`stub gh does not support "pr ${verb ?? ""}"`);
  }
}

let exitCode = 0;
try {
  run();
} catch (error) {
  exitCode = 1;
  process.stderr.write(`${error instanceof Refusal ? "" : "stub gh failed: "}${error instanceof Error ? error.message : String(error)}\n`);
}
appendFileSync(join(stateDirectory, "calls.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), cwd: process.cwd(), args, exitCode })}\n`);
process.exitCode = exitCode;
