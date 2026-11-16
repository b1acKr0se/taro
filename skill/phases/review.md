# Review

The work is built: an independent reviewer checks it before delivery. With pull-request delivery,
push your branch and open the PR as a **draft** now (title and body: `phases/delivery.md`):
reviewers post their findings, and you your fix summary, as PR comments.

## The round

- **medium:** one independent reviewer (`roles/reviewer.md`), started like an implementer with
  `taro.role=reviewer` and the strongest model for risky code. Give it the user's words, the
  criteria and the range to review. For a visible change, capture the screenshots first
  (`phases/delivery.md`) and give it their absolute paths: it looks at them before the code, in the
  same round.
- **high:** a reviewer over the combined diff. If it found a blocker, a second round re-reviews the
  whole branch after your fixes, whatever their size; otherwise the fixes get a fix check.

**Every** review checks test sufficiency: each changed behaviour has a test that would fail if it
regressed; a bug fix keeps its reproduction; tests cover the input space (empty, zero, maximum,
rounding, ordering), not the code's own assumption. A missing or empty test for a changed behaviour
is a blocker.

## Findings

Verify every finding against the code yourself (valid, partially valid or invalid, with evidence),
and fix the valid blockers and should-fix findings yourself. A **Question** (a preference the user
did not settle: a label, wording, density, a layout) and a blocker that is really a preference are
yours after approval: decide them as RULINGs. Ask (with `surprise:`) only when the answer would
change an approved criterion or Out of scope line.

## Fix check

Once you fixed a round's valid blockers or should-fix findings, a reviewer checks the fixes before
delivery: fixes alone can break what was reviewed. Send it to the same reviewer (`paseo send`: it
still holds the context), so archive a reviewer only after its fix check; only when it is gone,
start a fresh one with the user's words, criteria, reviewed range and the valid findings. Send the
fix range (`<reviewed head>..HEAD`); each behaviour fix with its test and that test's failing output
from before the fix (at the reviewed head, or with the fix reverted); each text-only fix with its
changed lines; and the full suite's result after the last fix. Ask for a **full re-review** instead
when the fix diff changes more than half as many lines as the reviewed change (`git diff
--shortstat`), or a blocker's fix changed the approach. Invalid findings and Questions are not sent.
New blockers or should-fix findings it raises are fixed and checked once more; still failing after
that → a RULING (`review-dispute` only with `surprise:`).

## The record

Record a **REVIEW** that answers every finding (fixed, or rejected with the reason), says what was
re-checked (the range, fix check or full re-review) and the verdict, and ends with `verdict: clean`
once nothing is left to fix (else `verdict: findings`). The clean verdict brings
`phases/delivery.md`, filled with what the delivery still lacks.
