# Stalled work and recovery

Use this for an owner-requested stall investigation or an explicitly enabled scheduled health check.
Read the supplied connection and [ticket records](tickets.md). Keep routine observations out of the
manager's context. Taro does not infer a hang from elapsed time or an old board status alone.

## Check the task

1. Read the current assignment and latest worker milestone, including operation handle, log path,
   start time and expected duration. Skip Awaiting acceptance tickets: a finished worker waiting for
   the owner's verification is not stalled. Waiting for scope approval or a running reviewer is not a hang.
2. Inspect that session on the recorded daemon once, plus a bounded recent activity excerpt. If needed,
   inspect the recorded command/log or reviewer. Do not scan unrelated transcripts or processes.
3. Distinguish: active work; waiting for owner/permission/reviewer; a completed/failed command whose
   worker has not resumed; provider error/closed session; or insufficient evidence. A listing failure
   means unknown. Silence during a long build is not proof the worker is dead.
4. Record a concise HEALTH observation only for an anomaly: time, worker session, latest worker
   milestone, last activity/operation evidence and next action. Never treat a health-check note's
   timestamp as new worker progress. Keep task status unchanged while the diagnosis is uncertain.

For suspected inactivity, compare two scheduled observations with the same assignment and unchanged
worker/tool activity before alerting. Respect the operation's expected duration/timeout; with none
recorded, use 30 minutes without observable activity as a reason to investigate, not a death verdict.
An explicit provider error or exited command needing intervention can be reported on the first check.
Alert the manager once per unresolved incident with the ticket, evidence and action needed. Record
HEALTH-ALERT-SENT/PENDING in the ticket and use the safe delivery rules in [Paseo operations](paseo.md).
Do not send routine healthy summaries, repeatedly report the same failure, or wake workers to ask
whether they are healthy. A later worker milestone or changed assignment can resolve the incident.

## Recover when authorized

The health check observes and alerts; it never stops, reloads, compacts, replaces or messages a worker.
After the owner asks for recovery, inspect current activity again before acting:

- Prefer resuming the existing idle session with its ticket and unfinished next action. Reconcile any
  running command first; do not launch the same build or PR creation twice.
- For a confirmed stuck operation, stop only that task's identified operation/session as authorized,
  preserve logs and uncommitted files, and verify it stopped. Do not kill unrelated processes.
- If the session cannot resume, create a replacement only after the old worker and any code-writing
  child processes are confirmed stopped. Reuse its existing code worktree and branch; inspect the diff
  and current HEAD, preserve dirty work, and retain approval/review evidence that still applies.
- Record the old assignment as superseded and the replacement identity before sending its start
  prompt. Require it to read the ticket/checkpoint and reconcile actual checkout state. Disregard late
  results from the superseded worker. Never reset the worktree to manufacture a clean restart.

Archive only with explicit authorization. If absence or process ownership is uncertain, report that
uncertainty instead of allowing two workers to write the same checkout.

## Optional automatic detection

Skill instructions alone cannot detect a frozen agent. When the owner enables automatic stall checks,
use one Paseo **schedule** per project that starts a fresh, lightweight agent, for example every ten
minutes. Do not use a manager heartbeat. Discover the current schedule interface and a suitable profile;
if its supported settings cannot express the required profile, report that limitation.

List existing schedules on that daemon before creating one. Reuse the matching schedule; on an uncertain
creation response, reconcile the list instead of creating another. Record its ID/daemon next to the
project connection in health-check.json, solely for managing the schedule. Respect the owner's chosen
cadence/expiry and disable it when requested. Setup itself does not create schedules.

Supply a prompt with absolute paths and the project identity:

> Run one Taro health check for <project>. Read <instructionFile>, role recovery, and <connection>.
> List unfinished tickets in the shared backlog. Inspect assigned workers/reviewers only as needed
> for possible stalls, using the latest worker milestone and actual activity. Follow recovery.md's
> observation, deduplication and alert rules. Do not recover, message or compact workers, change task
> status, or send healthy summaries to the manager. Record exceptions in the shared ticket. Exit after
> one bounded pass; do not wait in a polling loop or install another schedule.

Choose schedule isolation/local cwd so each run can read the connection without creating new code
worktrees. Verify whether the installed Paseo schedule surface sends automatic parent callbacks; if
routine callbacks cannot be disabled, do not enable it as a quiet monitor. Automatic detection remains
best-effort: report a failed observation as unknown, and never describe an unconfigured monitor as active.
