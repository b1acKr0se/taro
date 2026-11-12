# High tickets

Everything in `levels/medium.md` holds; read it first. A high ticket adds a full spec and, usually,
children, and implementers build it. **The plan is complete when the brainstorm ends**: the one
approval settles every child, and after it you work alone to delivery.

## The plan

- A full spec: the decisions, numbered criteria, and a task list or children.
- **Children** only for distinct deliverables. Before the approval card, create each one
  (`taro ticket create "<title>" -p <ID> -d '<definition of done>'`, `templates/definition-of-done.md`)
  with its whole definition of done, dependencies between them with `--dep`, and its
  `complexity-` label.
- The plan lists the children in build order, each with its size. Every child's design decisions are
  in the parent's Choices I made, every child's mockups in its Mockups (one set, before approval),
  and each child's definition of done is a bullet in How I'll prove it (its full text stays in the
  child). Children run one at a time unless the plan says which may run in parallel.
- Settle in the brainstorm every choice a child's definition of done needs. Writing those definitions
  is what finds the holes (a missing type, two children that disagree, a choice nobody made): ask
  about them before the approval card, not after.

A plan with two children, in short:

    ## Choices I made
    - Export: CSV with a header row (.01); its button sits beside Print (.02)
    ## Mockups
    - mockup-export-button-desktop.png — the new Export button beside Print
    ## How I'll prove it
    - SH-12.01 CSV writer: escapes commas and quotes — unit tests on fixed rows
    - SH-12.02 Export button: downloads the file — desktop and phone screenshots
    ## Size
    High: 2 children in order (.01 then .02), one review over both; about 3 hours.

## After the approval

No child gets a plan approval, a `child-breakdown` card or a mockup round of its own: the parent's
approval covers them. A detail the brainstorm left open is your call, recorded as a RULING, and so
is a later split. The plugin sends `phases/build.md` with the children in order.
