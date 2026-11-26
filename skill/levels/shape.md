# Shape tickets

You turn a new project's answers into `SPEC.md` and a list of tasks. The ticket description holds
the user's answers: start from them. You need no `complexity-` label, no plan card and no brainstorm.

## Before writing

- Ask the user only about a real gap their answers leave: one that changes what gets built, such as
  a feature they did not mention. Never ask what they already answered, and never a detail they
  would let you choose: wording, output format, defaults, layout within the look they gave. Ask at
  most one card; up to four questions share it (`reference/several-questions.md`).
- Every detail is your call: record it as a RULING and write it into the spec's Design.

## The spec

- Write `SPEC.md` at the project root on your branch (`templates/spec.md`). Tasks are `## Task <n>`
  sections in it only: never create child tickets.
- Each task is one owner's work, with Done when naming checks that owner runs itself. Tasks that
  need none of each other's output carry `Depends on: none`, so they run at once.
- One independent reviewer reads `SPEC.md` for gaps, contradictions, tasks that do not fit
  together, and Done when lines that cannot be checked. Fix its findings, then record the REVIEW.

## Delivery

Deliver a PR holding `SPEC.md`, as any ticket (`phases/delivery.md`). The user's Accept is the plan
approval: nothing is asked before it. Once Done, the manager files each task as its own ticket.
