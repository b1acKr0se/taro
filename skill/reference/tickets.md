# Tickets

The tracker holds one file per ticket, read and written only by the `taro` command; it finds the
tracker from `$TARO_TRACKER` (the path from your brief). Pass text as single quoted arguments; never
build shell code from user text. Never edit ticket files or commit them.

```bash
taro ticket list --plain                      # or --json; filters: -s "In Progress", -l label, -p <parent>
taro ticket view SH-012 --plain               # or --json; shows "Revision: <rev>"
taro ticket search "login" --plain
taro ticket create "Fix login redirect" -d "<two-part brief>" [-l investigation] [-p SH-010] [--dep SH-011]
taro ticket edit SH-012 -s "Planning"
taro ticket edit SH-012 --plan "<plan>" --revision <rev>   # templates/plan.md; its How I'll prove it holds the criteria
taro ticket edit SH-012 --add-label complexity-medium
taro ticket edit SH-012 --append-notes "<record>" --plain
taro ticket edit SH-012 --check-ac 1                # an older ticket's acceptance criterion
taro ticket edit SH-012 --final-summary "<FINAL>" -s "Awaiting acceptance" --revision <rev>   # templates/final.md
taro ticket check                             # problems in any ticket file, one per line; exit 0 when clean
```

After `ticket create`, read the allocated id back from its output (`Created <ID>`) — never invent one.
On a timeout, view the ticket before retrying an append (appends are not deduplicated).

Edits that replace a whole field (`--plan`, `--final-summary`, `-d`, `-t`) take `--revision <rev>`
from a `ticket view` you just ran: the edit is refused if the ticket changed since. Exit code 3
means that happened (it names the current revision): view the ticket again, redo your edit on what
is there now, and pass the new revision. Appends, labels, status and criteria need no revision.
Other exit codes: 1 for an error such as a missing ticket, 2 for a usage mistake (it prints the
usage). New tickets have no acceptance criteria list; the criteria live in the plan's How I'll
prove it. Only an older ticket has a checklist, ticked with `--check-ac <n>`.

## When a command fails

Never go on without the tracker: the ticket is the record of the work (SKILL.md rule 3).

- **Exit 2** is a usage mistake: read the usage it prints and fix the command (`view`, not `show`).
- **`taro` not found:** run it by its full path, `"$TARO_SKILL/../bin/taro" ticket …`.
- **Anything else**, or still failing: stop and ask the user with a blocking decision, saying what
  you ran and what it printed. Do not build, commit or deliver until a ticket command works.

## Statuses

`Queued → Planning → Ready → In Progress → Reviewing → Awaiting acceptance → Done`, plus `Blocked`
and `Cancelled`. Trivial tasks go from Planning straight to In Progress once their plan is written (no approval card).

| Status | Who sets it | When |
| --- | --- | --- |
| Queued | manager | filed |
| Planning | plugin | the owner started: orienting, asking, proposing |
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

Append these to the notes, each starting with its name and the host's current UTC time: run
`date -u +%Y-%m-%dT%H:%MZ` at the moment you write the record and use its output, e.g.
`MILESTONE 2026-10-13T14:02Z — …`. Never type, estimate or carry over a time, nor a local time
labelled Z; the board, Ticket tab and stats sort by these times, and `taro ticket edit` refuses
a record time (or FINAL time) more than two minutes after the host clock. Append; never rewrite
history: a wrong record is corrected by a **CORRECTION** record. Keep each within its limit; cut
rather than exceed it.

- **DISPATCH-INTENT** (manager, before launching): ticket, unique token, intended branch.
- **EXECUTION**: owner agent id, owner model, workspace id, machine (`hostname`), worktree path, branch, base
  SHA; later the subagents (agent id, job, task) and `review-head: <sha>`.
- **APPROVAL**: the user's exact words, time, and what they approved (the plan).
- **MILESTONE**: one line of at most about 150 characters: what happened and what's next, e.g.
  `MILESTONE 2026-10-13T14:02Z — Picker built (6cdd38a), checks green; next: review`. Before a long
  command: its log path and expected duration. Detail belongs in commits and the other records.
- **HANDOFF**: before compaction or stopping (template: `templates/handoff.md`, with its line
  limits).
- **HOLD** (manager): a Queued ticket kept waiting on purpose while a slot is free, with the reason
  (`HOLD 2026-01-05T10:00Z — exclusive rewrite SH-010 first`). The plugin does not wake anyone for it.
- **RELEASE** (manager): the hold's reason is gone; the ticket is queued like any other again.
- **PAUSE-REQUESTED**, **HOLD** "parked by the user" (older ones: "paused by the user"), **RELEASE**
  "resumed by the user", **RESUMED**: written by the plugin when the user presses Park (the owner
  writes a HANDOFF and is archived; the ticket keeps its status; a Queued ticket nobody started is
  held at once, "before it started") and Resume (a fresh owner starts in the same worktree, at once or,
  as "queued to resume", when a slot frees; a ticket parked before it started goes "back in the
  queue" instead, or gets the manager's HOLD from before the park again). A parked owner is told so
  by a message.
- **SCOPE-CHANGE**: written by the plugin when the user presses Change spec… on a Queued ticket
  with no owner, with their words; the manager then rewrites the Description to match.
- **QUEUE-WAKE**, **QUEUE-ALERT**, **QUEUE-RESTART**: written by the plugin as it wakes the manager
  for a queued ticket, alerts the user, and restarts the manager.
- **OWNER-STARTED**: written by the plugin as an owner's first turn starts on a Queued ticket; it
  sets Planning in the same write. A ticket already past Queued keeps its status.
- **DELIVERY-ENDED**: written by the plugin when an owner asks a blocking question while its ticket
  awaits acceptance; it moves the ticket to In Progress in the same write (`roles/owner.md`).
- **REVIEW**: reviewer, revision, verdict, every finding answered (fixed, or rejected with the
  reason); after fixes, what the fix check re-checked: its range, fix check or full re-review, and
  its verdict (`roles/owner.md`, Review).
- **EVIDENCE**: what the user sees before Accept; the newest record counts. One fact per line,
  label in any case, separator ` — ` (` -- ` and ` - ` also work):
  `check: <command> — <result>` (one or more), `review: <outcome>`,
  `ux: <the user's-eyes result>` (per changed screen: where values start and whether columns and
  row edges line up, any placeholder text found; what your pass fixed, the reviewer's visual
  verdict if there was one, anything left open; required whenever there are screenshots),
  `coverage: <section or state> — <screenshot file>[, <file>…]` (one per section or state the diff
  renders, changes, moves or re-wraps, each naming screenshots of this record; required whenever there are
  screenshots: `roles/owner.md`, Delivery),
  `screenshot: <file name> — <caption>` (a bare name; the file is in `$TARO_EVIDENCE/<ID>/`; a name
  that says what it shows and a caption are required: `reference/formats.md`, Images), or
  `screenshots: none — <reason>`. A change needs a check, a review line and screenshots with a `ux:`
  line (or none with a reason); an investigation needs a check. Accept is refused until it is complete.

      EVIDENCE 2026-01-05T10:00Z — before FINAL
      check: npm test — 37 files, 360 passed
      review: one independent round (Sonnet) — 1 blocker, fixed; fix check by the same reviewer (fix range, callers, suite) — pass
      ux: list rows: titles and dates start at one x on both; no placeholder text; own pass fixed a clipped Save button; reviewer agrees
      coverage: notes list, 40 notes with long titles — notes-list-desktop.png, notes-list-phone.png
      coverage: empty list — notes-empty-phone.png
      screenshot: notes-list-desktop.png — the list on a wide screen
      screenshot: notes-list-phone.png — the same on a phone
      screenshot: notes-empty-phone.png — no notes yet, on a phone

  `$TARO_EVIDENCE` is `$PASEO_HOME/plugin-data/taro/evidence/<project>` when unset
  (`~/.paseo/…` without `PASEO_HOME`).
- **FINAL**: set with `--final-summary`, following `templates/final.md`: What changed (at most 5
  bullets; the first is the ticket's one-line result), How it was verified (at most 3, the review
  among them), Limitations (at most 3), then `Revision: <sha> on <branch> · PR: <URL or none>`.
  The evidence per criterion is the EVIDENCE record; do not repeat it.
- **ACCEPTANCE**: the user's words, time, accepted revision and PR, and the merge result as one
  fixed field the board reads (a Done card shows GitHub's merged icon from it): `merge: merged
  <merge commit or old → new>`, `merge: not merged — <reason>` or `merge: none` (nothing to merge,
  such as an investigation). Write it exactly so, once, after the prose:
  `ACCEPTANCE 2026-01-06T09:00Z — user: "I accept SH-012." Accepted 3f2a…, PR https://github.com/o/r/pull/42; merge: merged 9c1d…`.
- **NOT-MERGED**: after Accept, a local-branch merge you did not make because of the main checkout
  (dirty, or on another branch), or a pull request GitHub would not merge with the project's merge
  method, and only then: the reason in one short line the user reads on the card, what they do
  first. It ends the "merging" state and puts the card back in Needs you:
  `NOT-MERGED 2026-01-06T09:00Z — commit or discard src/app.ts in the main checkout, then Accept again`.
- **NOT-SYNCED** (older tickets only, TR-215): a pull request merged while the base branch in the main
  checkout could not fast-forward to origin's. It is no longer written: the ticket closes, and
  ACCEPTANCE says `local <base> not updated: <reason>`. The next Accept on an old one closes it.
- **ACCEPTED**, **ACCEPT-HANDOFF**: written by the plugin when the user presses Accept (the card
  says it merges), and when its own merge stops on something that needs an owner: who took over
  and why (the owner, or a fresh owner when the owner had been idle 5 minutes or more), then what
  it found. The plugin itself writes ACCEPTANCE and NOT-MERGED on the routine
  path; an owner writes them only after a hand-off.
- **ANSWER**: written by the plugin when the user answers a decision.
- **NO-PLAN**: written by the plugin when an owner's turn ends with commits on its branch and no
  plan on the ticket (TR-206); the owner is told to stop, write the plan and, above trivial, ask
  `scope-approval` before building on.
- **ESCAPE**: on a delivered ticket, when a later ticket fixes a defect it shipped; written by the
  later ticket's owner. What escaped, the fixing ticket, and the check that should have caught it
  (coverage map, alignment, placeholder text, a test, a review area):
  `ESCAPE 2026-01-06T09:00Z — children listed as "Unknown"; fixed by NA-14; missed by: coverage map (no screenshot had children)`.
- **CORRECTION**: fixes an earlier record without rewriting it: which record, what was wrong, what
  is right. Quote a wrong record mid-line (`- REVIEW stamped 17:40Z …`), never at a line's start,
  where it would read as a record of its own:
  `CORRECTION 2026-01-06T09:30Z — future-dated times; actual times from the tracker commits:`
  `- REVIEW stamped 2026-01-06T10:40Z, written 09:43Z`.
