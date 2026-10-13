# Shared ticket records

Read project.json for backlogBin and backlogRoot. Set BACKLOG_CWD explicitly on EVERY command.
Do not source project.json as shell code. Do not run bare Backlog commands from a code worktree.
Substitute real values below and quote paths/text as data:

    BACKLOG_CWD="/absolute/shared/backlog-checkout" /absolute/backlog task view SH-001 --json
    BACKLOG_CWD="/absolute/shared/backlog-checkout" /absolute/backlog task list --json
    BACKLOG_CWD="/absolute/shared/backlog-checkout" /absolute/backlog search "login" --json

Create and edit through Backlog's CLI or a correctly pinned MCP server; don't hand-edit task YAML:

    ... task create "Fix login" -d "<owner request>" --ac "<acceptance criterion>"
    ... task edit SH-001 --status "Planning"
    ... task edit SH-001 --plan "<implementation plan>"
    ... task edit SH-001 --append-notes "<milestone record>" --plain
    ... task edit SH-001 --comment "<review record>" --comment-author "<reviewer identity>"
    ... task edit SH-001 --final-summary "<result, evidence, awaiting owner acceptance>" --status "Awaiting acceptance"

The ellipsis represents the same explicit environment/executable prefix, not a runnable command.
Pass multiline text as one literal argument (or use subprocess argv); never interpolate it into shell code.
Read commands support versioned JSON. Create/edit commands do not universally accept --json:
use their supported output, then read the ticket back to confirm ID and data.
On a timeout inspect the ticket before retrying an append. Backlog locks file edits but doesn't deduplicate
a repeated comment. On lock contention reread before retrying, preserving other agents' notes.

## Parent and child tickets

The ticket owner proposes children for user confirmation before creating them, then maintains their
records; see [parent tracking](parent.md).
Use Backlog's parent relationship, not a naming convention or a manually allocated ID:

    ... task create "Subscription API" --parent <parent-id> -d "<approved deliverable>" --ac "<criterion>"
    ... task create "Subscription UI" --parent <parent-id> --depends-on <api-child-id> -d "<approved deliverable>"

Read the allocated IDs back, link them in the parent's plan, and record each child's approval reference
and owning parent session. Child IDs may use Backlog's hierarchical suffix; never rename them to fit an
agent/session scheme. All records stay in backlogRoot and appear on the same board without a commit.
Children are deliverables, not agent assignments; a child can share execution and PRs with other children.

## Essential records

Use these short record names with an ISO timestamp and author. They are ordinary Markdown notes/comments;
do not create a second task database or parse them as a rigid protocol.

- **DISPATCH-INTENT:** ticket, role, unique dispatch token, desired branch/revision, before an external launch.
- **EXECUTION:** current worker session, workspace, machine/daemon, absolute code worktree, branch, base SHA,
  manager session; include review assignments with reviewer session, SHA and active/superseded status.
  For parent-owned children, identify the parent owner and relevant workflow/artifact mapping instead
  of requiring a separate worker; record actual execution identities only when they exist.
- **APPROVAL:** exact owner words, source, timestamp, approved description/criteria snapshot or an immutable
  Git reference to them. Approval applies to scope, not incidental status/notes edits.
- **MILESTONE:** meaningful result, decisions/rationale, constraints, unresolved issues, exact code revision
  or uncommitted state, actual test commands/results, current operation and next action. Before a long
  command add its handle/log path, start time and expected duration or timeout; append its outcome.
- **REVIEW:** assigned reviewer identity, exact SHA, approved/changes requested, findings, checks performed.
- **FINAL:** current delivered behavior, exact SHA, PR URL/base or local-review boundary, test and review
  evidence references, limitations and next action. Replace this summary when delivery changes.
- **ACCEPTANCE:** owner's exact acceptance words, timestamp/source, accepted revision and PR URL if any.
- **ALERT-PENDING / ALERT-SENT:** blocker/readiness summary, target manager and delivery outcome.

Use notes for worker milestones and comments for reviewer evidence to reduce overlapping replacements.
Append-only notes are history; status, checked criteria and final summary must reflect the current state.
Keep validation precise: pending, failed, interrupted and explicitly waived are different outcomes.
Before completion, leave any unverified criterion unchecked rather than inferring success from a unit test.
Keep the latest recovery milestone concise. Long logs remain artifacts/transcripts referenced from the ticket.
A teammate's session IDs and absolute paths are observations on that machine, not executable links here.

## Board and sharing

Columns are Backlog, Planning, Ready, In Progress, Reviewing, Awaiting acceptance, Blocked, Cancelled, Done.
Done is last because Backlog treats its last configured status as the terminal status.
Use Blocked only for an external impediment; record the resume phase and required action.
The implementer owns execution/review and moves verified work to Awaiting acceptance. Reviewers append
evidence. Done means the owner explicitly accepted that delivered result, not merely a ready or merged PR.
The draft PR exists before independent review; keep the ticket Reviewing during it.
The worker updates phases when work starts and changes, not just in its final report. An optional health
check records observations without changing task status or impersonating a worker milestone.
If someone manually moves a card to Done without evidence, report it as unverified; don't invent approval.

## Owner acceptance

The owner can accept in the manager tab or worker tab. The agent receiving that acceptance records it
and marks Done; no second confirmation or cross-tab handoff is needed. Use the exact words and source,
the currently delivered full SHA and PR URL. Confirm acceptance refers to this ticket/result; resolve
an ambiguous ticket or changed revision rather than guessing. Reuse an existing acceptance of the same
revision on retry. Scope approval, review approval, silence and merging alone do not count as acceptance.

Read the current FINAL and delivery/review evidence first. Record ACCEPTANCE before changing status:

    ... task edit SH-001 --append-notes "ACCEPTANCE <time/source>: <owner words>; revision <full SHA>; PR <url>"
    ... task edit SH-001 --status "Done"

Update FINAL to say accepted, then read back the record and confirm to the owner. This does not
authorize merging/deploying. Do not wake the manager with another routine callback when acceptance
is recorded in the worker tab; the shared ticket is current. If the owner requests rework, preserve
the earlier record as history, move back to In Progress, and obtain acceptance of the new result.
Waiting in Awaiting acceptance needs no polling, reminders or stale-worker alerts.

For a parent delivery, its FINAL must identify the included children and delivered revisions. One explicit
acceptance of the complete listed feature can cover parent and children: read their evidence, record the
same owner words/source against each covered revision, then mark those tickets Done. Do not require the
user to visit child tabs or accept each one separately. Acceptance of only the parent or a subset does
not cover unmentioned work; clarify ambiguous coverage. Never close unfinished or changed children by
cascade. If interrupted, reconcile existing acceptance records and finish only the already-covered updates.

## Shared checkout

The board, manager and all workers use the same local backlogRoot. No cross-branch task aggregation is
needed; it is disabled by setup. Commit only backlog/ changes in that checkout for shared history.
Pushing and syncing the task branch follows owner authorization; check others' changes before merging.
There is no automatic cross-machine live sync or cross-machine dispatch lock. Agree on one active owner
per ticket. New work on another machine needs synchronized tickets and explicit takeover when one is active.
