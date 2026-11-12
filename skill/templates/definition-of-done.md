<!--
Template the task owner fills for every implementer, written into the child ticket
or the implementer's brief. It is the implementer's whole brief.
Before dispatch the owner self-checks it: every criterion has a concrete check, no
placeholders, no contradictions, every criterion traces to the approved spec. It says what to build
and how to check it, never the code: no function bodies. A high parent's plan approval waits until
each child has Owns, Interfaces and Tests required (and Review Focus when labelled risk).
After `done` the owner verifies: the report holds real command output, the owner reruns the
checks and reviews the commit range; a report without evidence goes back.
-->
# <CHILD-ID> · <objective in one line>

## Context
Parent: <ID> — <one line>. Spec: <path to the parent ticket>.
Earlier children delivered: <only the interfaces or functions this child uses, with file:line>.

## Acceptance criteria
1. <observable behaviour> — proven by: `<exact test name or command>`
2. <...> — proven by: `<...>`

## Scope
Out: <what not to touch, including other children's areas>. Anything else you notice → report it, don't fix it.

## Owns
- `<exact path of each file this child creates or changes>`

## Interfaces
- Provide: `<signature / endpoint / event, exactly>`
  - e.g. `<call>` → `<result>` (two or three: a usual case, an edge, an error)
- Use: `<name>` — from <child id>, or existing (<file:line>)
<or `- none — <why>`>

## Tests required
- `<test name>`: <input> → <expected output>
<each boundary to cover (empty, zero, max, rounding…) is one named test>
Bug: reproduce first; the reproduction becomes the regression test and must fail before the fix.

## Review Focus
- <risky input> — test: `<test name>`
<required when labelled risk>

## Detail
<how much this spec spells out: tests (default) | full (money, auth, contracts, stored data) | contracts (mechanical work)>

## Size and model
<about N minutes>; <model>

## Checks
`<lint>` · `<typecheck>` · `<tests for the touched packages>` — all must pass.

## Delivery
Commit on `taro/<parent>` in this worktree, following the repo's commit conventions.
Never push, merge, rebase others' commits, or open a PR.

## Report (your final message)
- commits: <SHAs>
- each criterion → the command you ran and its actual output (pass/fail)
- checks: commands + actual result
- deviations from this brief, and why
- anything noticed outside scope

Last line: `done: <one line>` only if every criterion and check passed;
otherwise `blocked: <what stops you, what you tried>`.

## Stop rules
- Same obstacle twice → `blocked`.
- A choice the brief doesn't settle → a decision block to the task owner (never to the user), then stop.
- Never report done on red checks; a done that isn't green is worse than blocked.
