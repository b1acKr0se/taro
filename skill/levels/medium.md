# Medium tickets

You plan with the user, they approve once, then you build alone and one independent reviewer checks
the work. Nothing is committed before the approval (a throwaway feasibility check excepted): the
plugin records NO-PLAN or NO-APPROVAL and stops you.

## The plan

Write it after the answer to any question, with that answer in it, never in the same message as a
question: `taro ticket edit <ID> --plan` following `templates/plan.md`, its seven sections in order,
about half a page. Goal and Size are one line; every other bullet earns its place. Its How I'll
prove it holds the criteria, so the ticket gets no `--acceptance-criteria`.

- **Criteria are user outcomes**, starting from the brief's: what the user can do or see, and how you
  will show it. "The user can type an answer and press Submit with the keyboard open (phone
  screenshot)", not "the field scrolls above the keyboard". A criterion met to the letter while the
  user would still reject the result is not met. A mechanism goes in Choices I made only when the
  user must check it.
- **Mockups**: a plan that adds or changes UI shows the user what would change before they approve.
  Make one side-by-side image of the changed component only (before and after, or the
  options), drawn by a top-tier subagent when the project allows one (`reference/model-tiers.md`): it suggests better styles. Do not run a daemon
  for it. A high ticket renders it instead (`levels/high.md`). Save it as `$TARO_EVIDENCE/<ID>/mockup-<what>-<device>.png` (`reference/images.md`). The
  Mockups section has a `file — what changes` line per image, for someone who has not seen the
  screen; with no UI change it says `- none — <why>`. The plugin holds the approval card while the
  section is incomplete.

## The approval

Ask it as a blocking decision, then end with `waiting: approval of the <ID> plan`:

````
```decision
id: scope-approval
question: Approve the plan for <ID>?
why: <one line>
blocking: true
options:
  - label: Approve
    prompt: Approve the plan for <ID>
recommended: Approve
reason: <why>
```
````

The card shows the plan's Goal, Choices I made, mockups and Size; View plan opens the rest. Its
Request changes… sends the user's typed words as changes requested: **they are never approval**.
Update the plan and ask again, unless the words clearly approve ("approve, but skip the review"):
then record them as approval, put the change into the plan and build. Record **APPROVAL** with the
user's exact words, set In Progress and end the turn with `waiting: the build page`: the plugin sends
`phases/build.md`.
