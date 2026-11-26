# Spec task tickets

`SPEC.md` is settled and the user approved it with the Shape ticket, so you do not brainstorm and
ask no approval. Read `SPEC.md` and your section, `## Task <n>`, named in the brief.

## The plan

Write it from your section with `taro ticket edit <ID> --plan` (`templates/plan.md`), then check it
yourself against the section's Done when: every line has a proof in the plan. The plugin does not
lint it. Set In Progress and go on: `taro next <ID>` prints the build page.

## Build and deliver

Build, run the tests and the app, get one independent review, deliver (`phases/review.md`,
`phases/delivery.md`). Everything the spec leaves open is your call, recorded as a RULING.

## A real conflict

Only three cases stop you:
- the spec contradicts itself or the code;
- a requirement cannot be met as written;
- the work needs something the spec does not cover, such as money, credentials or an account.

Ask one blocking card with `surprise:` naming the spec line, offering to amend the spec or keep it
and change the work. If the user amends it, append a `SPEC-AMENDED <time> — <line changed, why>`
record and edit `SPEC.md` in the same PR. The manager tells the owners of tasks it affects.
