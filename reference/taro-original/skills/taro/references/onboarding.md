# Onboarding

Read the repository's AGENTS.md, CLAUDE.md (deduplicate symlinks), README.md, applicable ancestor
instructions, and relevant scoped instructions before selecting the base branch and execution rules.
Do not read secrets, environment files, .wallets.local, or arbitrary links while discovering instructions.
Resolve a material conflict with the owner; don't make them repeat decisions already available.

If Backlog.md is not prepared, run scripts/setup.py prepare from this instruction directory.
It reuses or installs Backlog.md and does not install Taro skills by default.
Run this instruction directory's scripts/setup.py onboard with the repository path, a project slug, short uppercase
prefix (SH for shop, SA for shop-api), and the repository's required code base branch:

    python3 <skill>/scripts/setup.py onboard --repo <repo> --project shop --prefix SH --base-branch develop

Setup creates a separate taro/backlog worktree and initializes Backlog.md there.
It writes portable backlog/taro.json and a local connection in ~/.taro/projects/<project>/project.json.
It never changes the primary checkout, launches agents, commits, or pushes.
New projects default to executionBoundary=pull-request: after scope approval the worker completes
implementation/checks, pushes its feature branch and opens a draft PR without another approval request.
It then owns review/fixes and marks the PR ready. Merge and deployment remain separate.
Verified delivery moves to Awaiting acceptance, including local-review tasks. Done requires explicit
owner acceptance recorded by the manager or worker, whichever receives it.
Use --execution-boundary local-review for an explicit local-only workflow.
Repeating setup preserves the saved boundary. To change an existing project when the owner requests it,
rerun onboard with --execution-boundary pull-request (or local-review); it updates both connection and
shared backlog/taro.json without changing tickets. An inherited shared branch keeps its saved boundary.
Reload the manager after a requested policy change; new workers read the updated connection. Existing
workers/reviewers and ticket-specific limits remain unchanged unless the owner separately changes them.
Do not treat a setup default as a retroactive task instruction.
If interrupted, inspect the error and existing files before retrying. Existing unrelated Backlog projects
are not adopted or rewritten automatically. A fresh project needs no migration.
On repeat onboarding, setup adds Awaiting acceptance after Reviewing in Taro's inline status list,
preserving other columns and keeping Done last. It does not change existing ticket statuses or infer
acceptance for old Done tickets. Use [update](update.md) to refresh an existing project and its manager;
do not broadcast instruction reloads to existing workers/reviewers.

The backlog branch is shared task history. Commit only backlog/ on that branch at meaningful milestones;
push/fetch/merge according to owner authorization. Do not merge the task branch into application branches.
On another machine clone the application repository and rerun setup with the same project/prefix/base:
it can reuse origin/taro/backlog. Absolute paths are machine-local, not stored in the portable config.
Local file changes appear immediately on this machine's board; other machines see only synchronized commits.
Never reset someone else's task changes or silently resolve conflicting approvals/statuses.

To start the manager, follow [Paseo operations](paseo.md), choose the owner's profile or discover a
suitable profile, and create a manager session in the repository's existing Paseo project.
Use title "<Project> manager"; supply its connection and this skill path, role manager, and instruction
to wait for owner tasks. Record its session ID and daemon identity in local manager.json next to project.json.
This is a small connection record, not a task registry. Check an existing manager's status before replacing
it; don't create a second manager just because a request timed out. Never archive the old one implicitly.

Open the existing Backlog.md board directly:

    BACKLOG_CWD=<absolute backlogRoot> <absolute backlogBin> browser --no-open

Use a distinct --port per project when running multiple boards. This workflow does not start a permanent
service. New worker tabs get the role instructions at dispatch; updates leave existing worker/reviewer
tabs untouched unless the owner separately requests a change to those sessions.
If the owner enables automatic stall detection, use the optional separate Paseo schedule described in
[recovery](recovery.md). Otherwise explain that recovery checks happen on request; no watchdog is running.
