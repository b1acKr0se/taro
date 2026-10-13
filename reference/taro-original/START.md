# Set up Taro from this repository

These instructions are for the agent receiving the Taro GitHub link. Carry out setup for the owner's
project and start its manager without asking the owner to install a skill or run commands.

## 1. Identify the target project

Capture the owner's target repository before changing directories. If they said "this project",
use the existing session's repository, not the Taro checkout. Resolve the primary checkout when
the session is in a worktree. If no target can be inferred, ask only for the project path.

Read that project's AGENTS.md, CLAUDE.md, README.md and applicable parent/scoped instructions.
Determine its base branch and execution rules. Use a short prefix such as SH for shop or SA
for shop-api, preserving an existing configured prefix. Resolve meaningful conflicts with the owner.

## 2. Read Taro locally

If you can already read a checkout of this repository, use it. Otherwise clone it outside the
application repository, for example:

    git clone https://github.com/b1acKr0se/taro.git ~/.taro/source

Use an authenticated GitHub/SSH URL if HTTPS access requires it. Do not overwrite an existing directory.
For an existing checkout, verify its origin identifies b1acKr0se/taro and inspect local changes before
updating it. Fetch and fast-forward only when clean; never discard changes.
Keep this checkout available for the manager and workers. For an existing project, use
[the update procedure](skills/taro/references/update.md): reload the manager for future dispatches;
do not contact or reconfigure existing workers/reviewers during an update.

Read [the workflow](skills/taro/SKILL.md) and its [onboarding instructions](skills/taro/references/onboarding.md)
directly. They are regular repository files; an installed slash command or skill is unnecessary.

## 3. Prepare dependencies and connect the project

Use the setup script from this checkout:

    python3 <taro-checkout>/skills/taro/scripts/setup.py prepare
    python3 <taro-checkout>/skills/taro/scripts/setup.py onboard       --repo <target-primary-checkout> --project <project-slug> --prefix <PREFIX> --base-branch <base>

Preparation reuses compatible Backlog.md or installs it privately. It does not copy skills into the
owner's agent configuration by default. Python 3.12+, Git, and Node/npm for a new Backlog installation
must be available. Paseo tools must be accessible to operate agents; report a missing prerequisite
specifically rather than claiming setup or dispatch succeeded.

Onboarding creates a shared task checkout and writes a local project.json connection, including
instructionFile: the absolute workflow path in this Taro checkout.
New projects use the pull-request boundary: complete implementation/checks, push and open a draft PR,
then review/fix and mark it ready. Tickets then wait in Awaiting acceptance until the owner accepts
the delivered result; only then mark Done. Use --execution-boundary local-review only for an explicit
local-only requirement. Existing projects retain their saved boundary unless the owner changes it;
use --execution-boundary to record that choice and reload the manager for future dispatches.
Use the same --home on both commands if the owner selected a nondefault setup location.
Do not create task copies inside worker code worktrees.

## 4. Start or reuse the manager

Continue with the onboarding reference's Paseo instructions. Resolve the target repository's existing
Paseo project, choose the owner's profile or an appropriate discovered profile, and start its manager.
Do not stop after printing a command or tell the owner to ask again to start the manager.

If a manager is already recorded, inspect it and reuse it when viable. Ask before replacing a live
manager; never silently create competing managers or archive the existing session.
If the owner explicitly wants this session to become the manager, adopt that role instead of spawning one.

Give the manager the absolute project.json and instructionFile paths and tell it to read role manager.
Every worker and reviewer receives those paths too and reads its role directly from this checkout.
Record the manager's identity as described in the onboarding reference.

Tell the owner where its manager tab is, where shared tasks live, and how to open the Backlog board.
Do not launch workers without an owner task, push code, deploy, or start a persistent background service.
Automatic stall checks are optional Paseo schedules, enabled only when requested; see the recovery
reference. Native provider compaction remains enabled without manager-driven compaction.
