<!--
Template the task owner fills for every implementer (decision 33), written into the child ticket
or the implementer's brief. It is the implementer's whole brief.
Detail: `contracts` (the default, and medium work) gives names and exact values; `tests` (high
work's children after the skeleton) gives the test code in full, written against the stubs so it
runs as written.
Before dispatch the owner self-checks it: every criterion has a concrete check, no
placeholders, no contradictions, every criterion traces to the approved spec, the RISKS cases for
its files are among its tests, and two tasks that can run at once own no path in common.
After `done` the owner verifies: the report holds real command output, the owner reruns the
checks and reviews the commit range; a report without evidence goes back.
-->
# <CHILD-ID> · <objective in one line>

Detail: <contracts | tests>
Owns: <exact paths this task alone changes>
Model: <model> (<tier>) — <why, from reference/model-tiers.md, Matching the task>
Estimate: <n>k — start <n>k + <lines written> × 22 + <lines read> × 37 + <brief characters> × 0.45, plus 15% (a rough guide)

## Context
Parent: <ID> — <one line>. Spec: <path to the parent ticket>.
Earlier children delivered: <only the interfaces or functions this child uses, with file:line>.

## Acceptance criteria
1. <observable behaviour> — proven by: `<exact test name or command>`
2. <...> — proven by: `<...>`

## Scope
In: the paths under Owns.
Out: <what not to touch, including other children's areas>. A change needed anywhere else → report it, don't make it.

## Interfaces
Provide: <exact signature / endpoint / event>, and for each one another task consumes, 2–3 call → result lines:
  e.g. `parseNote("# A\nbody") -> { title: "A", body: "body" }`
  e.g. `parseNote("") -> error "empty note"`
Use: <existing ones, exactly, with file:line>.

## Tests required
<Detail: contracts> each test by name, with its exact input and expected outcome:
  `<test name>`: <input> → <outcome>
<Detail: tests> the test code in full, in the file it goes in.
Every new test is seen failing before the code that passes it.
Bug: reproduce first; the reproduction becomes the regression test and must fail before the fix.

## Risks
The RISKS cases touching these files, each a named test with its exact input and outcome:
  `<test name>`: <input> → <outcome>

## Checks
`<lint>` · `<typecheck>` · `<tests for the touched packages>` — all must pass.

## Delivery
Commit on `<branch>` in `<absolute worktree path>`, following the repo's commit conventions.
Never push, merge, rebase others' commits, or open a PR.

## Report (your final message)
- commits: <SHAs>
- each criterion → the command you ran and its actual output (pass/fail)
- checks: commands + actual result
- guesses: each choice this brief did not settle and each workaround, one line each
- deviations from this brief, and why
- anything noticed outside scope, including a change needed outside Owns

Last line: `done: <one line>` only if every criterion and check passed;
otherwise `blocked: <what stops you, what you tried>`.

## Stop rules
- Same obstacle twice → `blocked`. Three fixes that did not cure a failure → change the approach or `blocked`.
- A choice the brief doesn't settle → a decision block to the task owner (never to the user), then stop.
- Never report done on red checks; a done that isn't green is worse than blocked.
