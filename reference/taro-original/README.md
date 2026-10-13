# Taro

An agent workflow using **Backlog.md for tickets and Kanban** and **Paseo for agents**.
All instructions live in this repository. There is no Taro runtime CLI, database, or required skill install.

## Start with a link

Give your agent this:

> Set up Taro for this project using https://github.com/b1acKr0se/taro.
> Follow START.md and start the project manager.

**Agents: begin with [START.md](START.md).** Identify the target project, fetch this repository if needed,
read its workflow files, prepare Backlog.md, onboard the project, and start or reuse its Paseo manager.
The owner does not need to install Taro first.

## Workflow

1. Give a task to your project's manager.
2. The manager creates a ticket such as SH-001 and opens its task tab.
3. Brainstorm and approve the brief there.
4. The implementer finishes the implementation and checks, then pushes and opens a draft PR.
5. The implementer arranges review, fixes findings in that PR, and marks it ready after verification.
6. The worker moves the ticket to **Awaiting acceptance** and notifies the manager.
7. Verify the result and accept it in either tab; that agent records your acceptance and marks **Done**.

Reviewers open as separate agent tabs in the implementer's Paseo workspace. They share its checkout;
the implementer pauses code edits during review so the assigned revision stays stable.

Only real blockers and readiness for acceptance notify the manager. Ask it for progress when needed.

Tickets hold decisions, approvals, milestones, review evidence, and the next action.
The workflow requires these records; it does not intercept tools or prevent manual board edits.
The default delivery boundary is a verified PR ready for review; workers do not ask again before opening it. Merge and
deployment remain under your control. Explicit task limits or local-review projects override this default.

### Larger tasks

The task owner proposes child tickets when the work has distinct deliverables and waits for your
confirmation before creating them—even when splitting already-approved work. It maintains the child
tickets while using your chosen execution workflow or skills. Children track deliverables, not agents.
You keep one point of contact. The owner records progress during execution and verifies the combined
result; you can accept the complete listed feature once. See [parent tracking](skills/taro/references/parent.md).

## Task data and worktrees

Each project has a shared Backlog checkout on its taro/backlog branch:

    ~/.taro/
    ├── source/                         # Taro instructions, if cloned here
    ├── projects/shop/project.json  # local paths and instructionFile
    └── backlogs/shop/backlog/      # shared task files and config

All agents and the board target that checkout through BACKLOG_CWD. Code worktrees remain separate.
Ticket notes identify the active worker, reviewer, code path, and branch.

Commit task files on taro/backlog; push when authorized. Other machines can connect to the same branch.
Git synchronization shares tickets, not live sessions. No migration or automatic cross-machine sync.

## Board

Use backlogBin and backlogRoot from the project's connection file:

    BACKLOG_CWD=/absolute/backlog-checkout /absolute/backlog browser --no-open

The board sees local task updates without involving the manager. Use a different --port for each project.
Workers record phase changes and milestones during work, including long commands and their results.
Progress is as current as the last worker update; a current final summary includes the PR link.
The normal finish is **Reviewing → Awaiting acceptance → Done**. Review is performed by agents;
Done requires your acceptance of the delivered result. Neither a passed review nor a merged PR closes
the ticket automatically. Waiting for your acceptance does not trigger stall alerts.

## Stalled work and context

Status questions do not stop a worker. Workers use bounded command waits and save recovery checkpoints.
On request, recovery checks the existing session and preserves its worktree before any replacement.
Optional [Paseo health checks](skills/taro/references/recovery.md) run in separate scheduled sessions and
alert the manager only about exceptions. They are not enabled by setup and do not restart agents.
Native provider compaction remains enabled; the manager does not compact workers automatically.

## Setup details

Requires Python 3.12+, Git, Paseo tools, and Node/npm if Backlog.md is not installed.
Preparation reuses Backlog.md 1.53.0 or installs it privately under ~/.taro/dependencies.

Agents run these from the fetched repository; users can also run them manually:

    python3 skills/taro/scripts/setup.py prepare
    python3 skills/taro/scripts/setup.py onboard       --repo /path/to/shop --project shop --prefix SH --base-branch develop

Installing a discoverable skill is optional. To opt in, add --skills-dir to prepare:

    python3 skills/taro/scripts/setup.py prepare --skills-dir ~/.codex/skills

Without that option, agent skill directories are untouched. Dispatch prompts point directly to the
repository's workflow files, so fresh worker and reviewer sessions need no prior Taro installation.

Existing projects keep their execution boundary. To adopt automatic PR delivery, rerun onboard with
the same project arguments plus --execution-boundary pull-request, then reload the manager's policy.
--execution-boundary local-review keeps work local. Setup never pushes or opens PRs itself.
Rerunning onboard also adds the Awaiting acceptance column to existing Taro boards without moving
tickets or reopening historical Done items.

## Update Taro

Tell the project manager **"Update Taro."** It follows the repository's
[taro-update skill](skills/taro-update/SKILL.md): fast-forward the instruction checkout, prepare the
pinned dependency, refresh this project's setup, and reread its own manager instructions. Existing
execution permissions and tickets are preserved. New workers read the update; existing workers and
reviewers are not contacted or reconfigured. No reinstall or session restart is needed.

The skill can be read directly from the repository; it does not need to be installed as a slash command.
For a manager using a version from before this skill existed, point it once at
skills/taro-update/SKILL.md in the updated Taro checkout. Later updates need only "Update Taro."

## Development

    python3 -m unittest discover -s tests -v

Tests use disposable repositories and real Backlog.md 1.53.0. They do not launch live Paseo agents.
