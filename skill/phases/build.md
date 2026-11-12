# Build

The plan is approved: build it to delivery without asking the user again. Save a starting
MILESTONE. Medium: you write the code. High: implementers do. Commit as you go, following the
repository's conventions. A bug is reproduced first; the reproduction becomes the regression test
and must fail before the fix.

## You decide now

Inside the approved goal every call is yours, scope changes included: record each as a RULING
(`reference/tickets.md`) and list the costliest in FINAL's Rulings. Ask the user only when an
approved criterion or an Out of scope line would change, with `surprise:` naming it
(`reference/formats.md`); without one the plugin does not show the question as blocking.

## Implementers and children

- One implementer per task, **one at a time** in your workspace (a new tab), each with a filled
  **definition of done** (`templates/definition-of-done.md`) in the child ticket or its brief.
  Check it first: every criterion has a concrete check, no placeholders, nothing contradicts,
  everything traces to the approved plan. Tell each subagent to read `reference/shell.md`.
- **Every child is worked by a subagent of its own**, labelled with the child's id: an implementer,
  or a researcher for an investigation child. Never do a child's work yourself: a child with no
  agent of its own borrows your chat, and its card repeats yours. Start its subagent with the
  child's definition of done, verify its report, and mark the child Done.
- Children run one at a time in your worktree, each subagent committing on your branch. Children
  the plan runs in parallel get their own worktree and branch, merged locally into yours when done.
  A child touching contracts, money, auth or stored data gets its own independent reviewer before
  it is Done.
- **Verify every report**: it must hold real command output; rerun the checks yourself; review the
  commit range (`git diff --stat` first, then the risky files). A report without evidence goes back.
- A subagent's question comes to you: decide it as a RULING; only a surprise goes to the user.

## When it is built

Set the ticket to Reviewing and end the turn with `waiting: the review page`; with children, the
plugin sends `phases/review.md` when the last one is Done.
