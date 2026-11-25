# Review

The work is built: an independent reviewer checks it before delivery. With pull-request delivery,
push your branch and open the PR as a **draft** now (title and body: `phases/delivery.md`). A round
on the PR is the reviewer's **Review**, your **Verdict** after fixing, then the next Review, each a
PR comment, until a review is clean.

## The round

- **medium:** one independent reviewer (`roles/reviewer.md`), started like an implementer with
  `taro.role=reviewer` and the strongest model for risky code. Give it the user's words, criteria, range and the PR's URL. For a visible change, give it the delivery screenshots' absolute paths
  (`phases/delivery.md`): it looks at those before the code, in the same round, with no new ones.
- **high:** a reviewer over the combined diff. If it found a **High finding**, the next review is a
  full re-review of the whole branch after your fixes, whatever their size; otherwise a fix check.

**Every** review checks test sufficiency: each changed behaviour has a test that would fail if it
regressed; a bug fix keeps its reproduction; tests cover the input space (empty, zero, maximum,
rounding, ordering), not the code's own assumption. A missing or empty test for a changed behaviour
is a Medium finding.

## Your verdict

Verify every finding against the code yourself: valid, partly valid or invalid, with evidence; run
a **Plausible** one before fixing it. Confirm or correct its level ("re-graded" in the verdict). Fix
every valid finding, with a test that fails without the fix. Decide each **Question** (a preference
the user did not settle: a label, wording, density, a layout), and a finding that is really one, as
a RULING; ask (with `surprise:`) only when the answer would change an approved criterion or Out of
scope line. Follow-ups go into FINAL's Limitations.

Write `$TARO_EVIDENCE/<ID>/verdict-<n>.md` from `templates/verdict-comment.md` and post it on the
PR, if any; where you disagree with the reviewer's overall verdict, say so in its first sentence.
Send its path to the same reviewer (`paseo send`: it still holds the context) for the next review,
with each test's failing output from before its fix (at the reviewed head, or with the fix reverted)
and the suite's `taro check` result, which it reads, not reruns. Archive a reviewer only after its
last review; if it is gone, start a fresh one with the user's words, criteria, the PR's URL and your
verdict.

**Skip the next review** when the review found no High finding, each fix is text-only or has a
failing-before test, and the suite passed after the last fix; still post the verdict, and say so in
REVIEW. Ask for a **full re-review** when the fix diff changes more than half as many lines as the
reviewed change (`git diff --shortstat`), or a fix changed the approach. A later review's new
findings are fixed and reviewed once more; still failing after that → a RULING (`review-dispute`
only with `surprise:`).

## The record

Record a **REVIEW** (`reference/tickets.md`): its first line quotes the latest review's bottom line
(the words after `Overall:` or `Overall now:`) and answers every finding (fixed, or rejected with
the reason), with what was re-checked (fix check or full re-review, and its range). Then one line
per author model of the reviewed code: `findings: <model> — high <n>, medium <n>, low <n>`, the
model as the author's EXECUTION record names it (valid findings at your grade, first raised in the
rounds this record covers); a plan review or self-review has neither. Its last line is
`verdict: findings`, or `verdict: clean` once nothing is left to fix, which brings
`phases/delivery.md`, filled with what the delivery still lacks. FINAL's How it was verified quotes
the same bottom line with the comment's link, then what your verdict fixed when no review followed
it.
