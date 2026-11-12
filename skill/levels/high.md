# High tickets

Everything in `levels/medium.md` holds; read it first. A high ticket adds a full spec and, usually,
children. **The plan is complete when the brainstorm ends**: the one approval settles every child,
and after it you work alone to delivery.

## The brainstorm

- Open with a question about a real case ("walk me through the last time this went wrong").
- Play each settled part back in a line before the next; offer a look at the code or a short spike
  when an answer depends on it. Say what the user needs to know to answer each question.

## The plan

- A full spec: numbered criteria, Choices I made as `<decision> — default: <what I chose> — <why>`,
  and Parts and Risks (`templates/plan.md`).
- **Children** only for distinct deliverables. Before the card, create each
  (`taro ticket create "<title>" -p <ID> -d '<definition of done>'`, `templates/definition-of-done.md`)
  with its definition of done, `--dep` between them and its `complexity-` label; `-l risk` and
  a Review Focus when it touches money, auth, contracts or stored data. Children with no dependency
  may run in parallel, so never share a file.
- A child's decisions, mockups and proof go in the parent's plan. Writing the definitions finds the
  holes (two children that disagree, a choice nobody made): ask about them before the card.
- **Plan review**: one independent reviewer reads the plan and the child specs for coverage of every
  criterion, interfaces that agree, and Review Focus gaps. Fix its findings, then record
  `REVIEW <time> — plan review by <reviewer>: <findings, each fixed or rejected> — verdict: <clean|findings>`.
  The plugin holds the card until that record is newer than the plan's last edit.

    ## Choices I made
    - Export format — default: CSV with a header row — opens in any spreadsheet
    ## Parts
    - SH-12.01 — CSV writer — S — depends on: none
    - SH-12.02 — Export button beside Print — M — depends on: SH-12.01

## After the approval

No child gets a plan approval, a `child-breakdown` card or a mockup round of its own: the parent's
approval covers them. A detail the brainstorm left open is your call, recorded as a RULING, and so
is a later split. The plugin sends `phases/build.md` with the children in order.
