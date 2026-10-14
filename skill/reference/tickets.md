# Tickets

The tracker is a Backlog.md project. Run every command with `BACKLOG_CWD` set to the tracker path
from your brief (your environment has it as `$BACKLOG_CWD` and `$TARO_TRACKER`). Pass text as single
quoted arguments; never build shell code from user text. Never edit task files or commit them.

```bash
backlog task list --plain                      # or --json; filters: -s "In Progress", -l label, -p <parent>
backlog task view SH-012 --plain               # or --json
backlog search "login" --plain
backlog task create "Fix login redirect" -d "<two-part brief>" [-l investigation] [-p SH-010] [--dep SH-011]
backlog task edit SH-012 -s "Planning"
backlog task edit SH-012 -d "<proposal>" --acceptance-criteria "<criterion 1>" --acceptance-criteria "<criterion 2>"
backlog task edit SH-012 --plan "<plan>"
backlog task edit SH-012 --add-label complexity-medium
backlog task edit SH-012 --append-notes "<record>" --plain
backlog task edit SH-012 --check-ac 1
backlog task edit SH-012 --final-summary "<FINAL record>" -s "Awaiting acceptance"
```

After `task create`, read the allocated id back from its output or `task list` — never invent one.
On a timeout, view the ticket before retrying an append (appends are not deduplicated).

## Statuses

`Backlog → Planning → Ready → In Progress → Reviewing → Awaiting acceptance → Done`, plus `Blocked`
and `Cancelled`. Trivial tasks go from Backlog straight to In Progress.

| Status | Who sets it | When |
| --- | --- | --- |
| Backlog | manager | filed |
| Planning | owner | orienting, asking, proposing |
| Ready | owner | approved, waiting on dependencies |
| In Progress | owner | building |
| Reviewing | owner | draft PR open, review under way |
| Awaiting acceptance | owner | delivered; FINAL written |
| Done | owner | the user accepted (and it merged, when merging) |
| Blocked | owner | an outside obstacle; record the resume phase and the action needed |
| Cancelled | owner or manager | the user dropped it |

## Labels

`investigation` (findings, no PR), `complexity-trivial|low|medium|high` (set by the owner).

## Records

Append these to the notes, each starting with its name and the real current time from
`date -u +%Y-%m-%dT%H:%MZ` (never a guessed time), e.g. `MILESTONE 2026-10-13T14:02Z — …`. Append;
never rewrite history.

- **DISPATCH-INTENT** (manager, before launching): ticket, unique token, intended branch.
- **EXECUTION**: owner agent id, workspace id, machine (`hostname`), worktree path, branch, base
  SHA; later the subagents (agent id, job, task) and `review-head: <sha>`.
- **APPROVAL**: the user's exact words, time, and what they approved (scope and criteria).
- **MILESTONE**: what happened, decisions, commit or uncommitted state, checks run with results,
  next step. Before a long command: its log path and expected duration.
- **HANDOFF**: before compaction or stopping (template: `templates/handoff.md`).
- **REVIEW**: reviewer, revision, verdict, every finding answered (fixed, or rejected with the
  reason).
- **EVIDENCE**: what the user sees before Accept; the newest record counts. One fact per line,
  label in any case, separator ` — ` (` -- ` and ` - ` also work):
  `check: <command> — <result>` (one or more), `review: <outcome>`,
  `ux: <the user's-eyes result>` (what your pass found and fixed, the reviewer's visual verdict if
  there was one, anything left open; required whenever there are screenshots),
  `screenshot: <file name> — <caption>` (a bare name; the file is in `$TARO_EVIDENCE/<ID>/`; a name
  that says what it shows and a caption are required: `reference/formats.md`, Images), or
  `screenshots: none — <reason>`. A change needs a check, a review line and screenshots with a `ux:`
  line (or none with a reason); an investigation needs a check. Accept is refused until it is complete.

      EVIDENCE 2026-01-05T10:00Z — before FINAL
      check: npm test — 37 files, 360 passed
      review: one independent round (Sonnet) — 1 blocker, fixed
      ux: own pass fixed a clipped Save button; reviewer: a long title ran under the menu, fixed
      screenshot: notes-list-desktop.png — the list on a wide screen
      screenshot: notes-list-phone.png — the same on a phone

  `$TARO_EVIDENCE` is `$PASEO_HOME/plugin-data/taro/evidence/<project>` when unset
  (`~/.paseo/…` without `PASEO_HOME`).
- **FINAL**: delivered behaviour, revision, PR URL, evidence per criterion (see EVIDENCE), review
  result, limitations. Also set with `--final-summary`.
- **ACCEPTANCE**: the user's words, time, accepted revision and PR, merge result.
- **ANSWER**: written by the plugin when the user answers a decision.
