# Update an existing project

Run this when the owner asks the manager to "update Taro" or invokes the taro-update skill.
Complete the update and reload your own manager instructions; do not merely print commands.
This procedure never contacts existing workers/reviewers. No polling or session restart is needed.

## Resolve the existing installation

Read the supplied project.json as JSON. Capture primaryRoot, project, prefix, baseBranch, backlogRoot,
executionBoundary and instructionFile. Derive the setup home from the connection's existing
<home>/projects/<project>/project.json location, not from a hardcoded ~/.taro. Keep the same connection.
The shared backlog checkout must already exist; if it is missing, diagnose that rather than creating
a replacement during an update. Never change the project's identity, base branch or execution policy.

Use Git from the directory containing instructionFile to find the Taro checkout root. Verify it is
the b1acKr0se/taro repository (SSH or HTTPS origin) and instructionFile is its tracked
skills/taro/SKILL.md, not an installed copy or the application repository. If only an installed copy
is available, locate the source checkout before proceeding. Do not pull inside an application checkout.
Read the current Taro update/setup instructions and inspect checkout status. Require a clean main
branch; stop on local changes, another branch or an unrelated origin. Do not stash, reset, switch
branches or overwrite the owner's edits to make an update succeed.

## Refresh source and setup

Record the current Taro commit, then run in that verified checkout:

    git fetch origin main
    git merge-base --is-ancestor HEAD origin/main
    git merge --ff-only origin/main

Run each command only if the previous one succeeds. The ancestry check also rejects local commits
ahead of origin/main. Confirm HEAD equals the fetched origin/main and record the new commit. A repeat
on the same version is valid: still refresh setup and reload the manager, since a previous run may
have stopped after fetching. Never merge a feature PR or push as part of this update.

Reread the updated procedure and setup help. Run the updated setup script as a fresh process:

    python3 <taro-checkout>/skills/taro/scripts/setup.py prepare --home <existing-home>

Use backlogBin from that result when refreshing the selected project's setup:

    python3 <taro-checkout>/skills/taro/scripts/setup.py onboard \
      --home <existing-home> --repo <saved-primaryRoot> --project <saved-project> \
      --prefix <saved-prefix> --base-branch <saved-baseBranch> --backlog-bin <prepared-backlogBin>

Substitute saved values using quoted arguments or subprocess argv, not shell evaluation of JSON.
Do not pass --execution-boundary: updates preserve the existing choice. Do not pass --skills-dir:
repository files are authoritative, and optional installed skill copies are not refreshed by this flow.
Preparation reuses or installs the pinned Backlog dependency; onboarding refreshes supported board
configuration without editing tickets or their statuses. Do not manually migrate or recreate tasks.
Only the selected project's configuration is refreshed even if other projects share the Taro checkout.

If any step fails, stop dependent steps and report the exact failure and what already changed. For
example, source may be current while dependency/setup refresh failed. Do not claim the whole update
succeeded or roll back files that other sessions might now be reading. Retrying is supported.

## Reload the manager and finish

Reread the saved connection. Verify identity, primaryRoot, backlogRoot, baseBranch and executionBoundary
are unchanged, instructionFile points to the updated checkout, and taskDataReadable was true. Read the
updated SKILL.md, manager role and its linked ticket/Paseo references in this session. Continue as the
same manager with its existing identity. Do not spawn a replacement, send yourself a Paseo prompt or
reload the provider process.

Every new worker dispatch must supply the current connection and instructionFile and tell the new
worker to read its role directly. Do not reuse a cached copy of the old launch instructions.
Existing workers/reviewers receive no messages and keep their ongoing assignments; do not retroactively
change their task limits or review placement. Files are shared, so this does not pin an immutable
instruction snapshot for sessions that choose to reread them later.

Report the old/new commit (or already current), dependency/setup result, preserved execution boundary,
and that the manager has reloaded and new workers will read the update. If you are not the manager,
report manager reload as pending and give it this message instead:

> Reread <instructionFile>, the manager role and its linked references, and <connection>. Use the
> updated workflow for future dispatches. Keep this session and existing assignments; do not contact
> existing workers/reviewers or create new tasks. Confirm the reload.

If a board is already open, its configuration comes from the same backlogRoot; refresh the browser
view if needed. Do not restart the board, Paseo daemon or any agent during this operation.
