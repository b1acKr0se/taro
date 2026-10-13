# Skills-based workflow

Status: completed.

- Replaced the runtime CLI, SQLite ledger and Paseo bridges with a Taro skill and setup script.
  No migration or compatibility implementation; historical code remains in Git.
- Backlog.md 1.53.0 owns tickets and Kanban. Paseo owns sessions and workspaces.
- All agents target one dedicated backlog checkout per project. Implementers own planning, approval,
  implementation, spawning reviewers, rework and completion. Only blockers/completion reach managers.
- Skills require evidence and recovery milestones, but do not intercept tools or enforce board transitions.
- Verification: 7 integration tests against the real Backlog CLI passed, including shared writes from
  separate code worktrees, board API updates, repeat setup, primary-checkout preservation, project
  isolation, shared-branch reads from another clone, and skill installation.
- Private npm dependency installation was exercised in a disposable directory and passed.
- Skill frontmatter validation and git diff --check passed.
- No live Paseo agents were launched or changed. No application repository was onboarded.

## Repository-link entry point

- Added START.md and a direct README/AGENTS entry path for an agent given the GitHub URL.
- Setup now prepares Backlog.md without installing skills by default; explicit --skills-dir is optional.
- Local connections store instructionFile from the source checkout and all dispatched roles read it directly.
- The bootstrap runs onboarding and starts/reuses the manager in one requested workflow.
- No application state or live sessions changed.
- Verification: all 8 integration tests passed in 23.514s, including real CLI setup from a fresh
  instruction checkout without installed skills. Skill validation and git diff --check passed.
  Only the human-readable next-step message changed after the test run.

## Worker completion and recovery

- New projects default to pull-request delivery. Existing boundaries are preserved; an explicit
  --execution-boundary changes local/shared settings without rewriting tickets.
- Workers record starting/progress milestones, bound command waits, continue after status questions,
  and distinguish review waivers from unrelated unfinished checks. PR delivery updates the current
  final summary before Done and the completion notification.
- Added on-request recovery and an optional separate Paseo health-check role/schedule recipe. Checks
  report exceptions without automatic takeover or compaction. No live schedules or agents changed.
- Native automatic compaction is retained, with checkpoints during work and reload after compaction.
- Verification: all 9 integration tests against real Backlog.md 1.53.0 passed in 26.765s, including
  fresh PR defaults, preserved local-only policy across repeat setup and another clone, explicit
  policy changes preserving tickets/primary checkout, and shared board updates without commits.
- Skill validation, relative instruction links and git diff --check passed. Only documentation changed
  after the final integration run. Live scheduling/recovery and agent adherence to the new prose were
  not exercised; no application state or live sessions were modified.

### PR before independent review

- Complete implementation/checks, then push and open a draft PR before assigning an independent reviewer.
  Keep the ticket Reviewing, push rework to the same PR, and review the new head before marking it ready.
- Manager/worker/reviewer instructions and onboarding documentation now use this order. Local-review
  remains local; existing PRs are reused. Opening the PR alone never marks a ticket Done.
- Verification: all 9 real Backlog integration tests passed in 27.101s; skill validation, relative
  Markdown links and git diff --check passed. No runtime code or live agent behavior changed in this
  adjustment; the revised agent sequence has not been exercised live.

## Owner acceptance before Done

- Workers move verified delivery to Awaiting acceptance and send one readiness notification. Only an
  explicit owner acceptance of the delivered revision permits Done; it can be recorded in either tab.
- New and existing Taro boards gain the new column after Reviewing, with Done still terminal. Repeat
  onboarding preserves ticket contents, historical Done states and other configured columns.
- Recovery skips tickets waiting for owner acceptance. Rework returns to In Progress and requires
  acceptance of the resulting revision. These are role instructions, not a runtime authorization gate.
- Verification: all 10 real Backlog integration tests passed in 33.293s, including board API visibility
  of Reviewing → Awaiting acceptance → Done and repeat setup preserving custom columns and ticket bytes.
  Skill validation, relative Markdown links and git diff --check passed. Only this validation note
  changed after the test run. No live tickets, sessions or boards were modified; agent adherence to
  the acceptance instruction has not been exercised live.

## Reviewer tabs in the implementer workspace

- Reviewer creation reuses the implementer's recorded Paseo workspaceId, with a new agent tab and
  notifyOnFinish=true. It does not create a Review workspace or a separate Git worktree.
- Both roles keep the shared checkout stable during review. Reviewers check the assigned SHA and
  clean tracked files before and after reviewing, and never detach/reset/switch the shared checkout.
- Verification: all 10 existing Backlog integration tests passed in 33.429s; skill validation,
  relative Markdown links and git diff --check passed. Placement semantics were checked against the
  installed Paseo create_agent tool schema. This instruction-only change was not exercised with live
  reviewers; no live agents or workspaces were created, moved or archived.

## Manager-triggered update skill

- Added the repository-readable taro-update skill and a procedure shared with the Taro manager role.
  It verifies/fast-forwards the source, prepares the pinned dependency, reruns setup from saved
  project values, and reloads only the current manager for future dispatches.
- Existing execution permissions, tickets and session identities remain intact. Updates never contact
  or reconfigure existing workers/reviewers, install skill copies, create tasks or restart services.
- Dirty/diverged checkouts stop without resetting work; partial failures report what already changed.
- Verification: both skill validators, links across 12 Markdown files and git diff --check passed.
  All 10 existing real Backlog integration tests passed in 33.707s, covering repeat setup, preserved
  policy/tickets, board updates and repository-backed instructions without skill installation.
  Only this record changed afterward. The new agent-driven update procedure was not run against a
  live manager; no live project update or session messaging was performed for this change.

## Parent-owned child ticket tracking

- Task owners propose child tickets for distinct deliverables and wait for explicit confirmation
  before creating them, including decomposition during execution of already-approved scope.
- The parent owner maintains all ticket progress around the chosen execution workflow. Children
  need no dedicated agent or PR; delegated agents need no Taro integration. Progress is recorded
  at workflow boundaries, with limited visibility stated when an opaque workflow cannot return it.
- Parent delivery requires integration evidence. One acceptance can cover the explicitly listed
  feature and children; unfinished or changed children are never closed by an automatic cascade.
- Verification: 11 real Backlog.md 1.53.0 integration tests passed in 39.401s. New coverage verifies
  parent relationships and dependencies; board API coverage now verifies child updates without
  commits and independent parent status. Both skill validators, 37 relative links across 13 Markdown
  files, and git diff --check passed. Only prose changed after the suite run. No live agents or
  project tickets were modified; arbitrary workflow adherence to these instructions is not proven
  by the CLI tests.
