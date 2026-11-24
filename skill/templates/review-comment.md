<!-- The PR comment a reviewer posts (`gh pr comment <url> --body-file`), and the shape of its final message. Written for a reader skimming a PR: the verdict and what to do come first, passing areas take one table row, and only findings get detail. Keep the sections in this order; leave out empty sections and this comment. Aim for under 2,500 characters; a long finding list earns more. -->
**Review: <ready | fix first | questions open>** — <n> blockers, <n> should-fix, <n> questions · `<base>..<head>`

<one or two sentences: what you reviewed and the main thing the owner must know>

| Area | Verdict | Checked |
| --- | --- | --- |
| Does what was asked | pass / findings / n/a | <at most 12 words> |
| Correct and robust | pass / findings / n/a | <at most 12 words> |
| Tested | pass / findings / n/a | <at most 12 words> |
| Safe and compatible | pass / findings / n/a | <at most 12 words> |

### Blockers
1. **<short title>** — `<file:line>`
   <the failure: input or state, then the wrong result, one or two lines>
   Fix: <specific change>

### Should-fix
<same shape as Blockers>

### Questions
- **<short title>** — <the preference, options, your recommendation>

<details><summary>Follow-ups outside this ticket</summary>

- <item>
</details>
