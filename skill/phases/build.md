# Build

The plan is approved: build it to delivery without asking again. Save a starting
MILESTONE. Medium: you write the code. High: implementers do. Run affected tests while building, the full suite once at the end. Commit as you go, per the repository's conventions. A bug is reproduced first: the reproduction is
the regression test and must fail before the fix.

## You decide now

Inside the approved goal every call is yours, scope changes too: record each as a RULING
(`reference/tickets.md`) and list the costliest in FINAL. Ask the user only when an
approved criterion or Out of scope line would change, with `surprise:` naming it
(`reference/formats.md`); without one go on with its `default`.

## Implementers and children

- One implementer per task, each with a filled
  **definition of done** (`templates/definition-of-done.md`) in the child ticket or its brief.
  Check it first: every criterion has a concrete check, no placeholders or contradiction, all traced to the plan. Tell each subagent to read `reference/shell.md`.
- **Every child is worked by a subagent of its own**, labelled with the child's id: an implementer,
  or a researcher for an investigation child. Never do a child's work yourself: without an agent of its own its card repeats yours. Start its subagent with the
  child's definition of done, verify its report, mark the child Done.
- Implementers run **one at a time** on your branch (a new tab), unless Parts shows no dependency
  between them, their Owns are disjoint and each interface has an example: then they run at once,
  each started with `taro agent start <job> <child id> … --worktree` (branch `taro/<child id>`),
  only as many as the thread check allows. A child whose tests run another child's code waits for it. Merge each into your
  branch once verified, in Parts order, rerunning the checks; `taro agent stop` then archives its worktree. A child touching
  contracts, money, auth or stored data gets its own independent reviewer before it is Done.
- **Verify every report**: it must hold real command output; read its logged check results at its head
  (`taro check` skips a command that passed there; `--again` reruns) and rerun only to test a doubt; review the commit range (`git diff --stat` first, then the risky
  files). A report without evidence goes back.
- A subagent's question is yours: decide it as a RULING; only a surprise goes to the user.

## When it is built

Set the ticket to Reviewing and end the turn with `waiting: the review page`; with children, the
plugin sends `phases/review.md` when the last one is Done.
