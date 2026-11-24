<!-- The reviewer's first review of a PR: `review-1.md` in `$TARO_EVIDENCE/<ID>/`, posted with `gh pr comment <url> --body-file <file>` when the change has a PR (a later round: `templates/re-review-comment.md`). For someone skimming the PR: verdict and counts first, then your overall verdict for someone who will not read the code (`roles/reviewer.md`), one table row per area, each finding one line that opens. Leave out empty sections and these comments. Number findings F1, F2…, questions Q1…, most severe first. Levels: 🔴 High, 🟡 Medium, 🔵 Low. Link a line at the reviewed head: `<repo URL>/blob/<head SHA>/<path>#L<a>-L<b>`; with no PR or an unpushed head, `file:line` without a link. Keep a blank line after `</summary>`, or GitHub shows the markdown raw. -->
## 🛠️ Review 1: <fix first | questions open | ready> · `<base>..<head>`

🔴 <n> high · 🟡 <n> medium · 🔵 <n> low · ❓ <n> questions · ↪️ <n> follow-ups · *reviewer: <model>*

### 🧭 Overall: <your bottom line in a few words>

<your judgement of the work as a whole, in plain words: a short paragraph or a few bullets, at most about 100 words, on what matters most for this change; name the finding behind each concern (F1)>

| Area | Verdict | Checked |
| --- | --- | --- |
| Does what was asked | ✅ pass | <at most 12 words> |
| Correct and robust | ⚠️ F1 F2 | <at most 12 words> |
| Tested | ✅ pass | <at most 12 words> |
| Safe and compatible | — n/a | <why> |
| <each focus area the brief names> | ✅ pass | <at most 12 words> |
| Past escapes | ✅ pass | <how many listed, which applied> |

<details>
<summary>🔴 <b>F1 · High</b> — <the defect, stated as a fact></summary>

**<The failure: the input or state, then the wrong result, in one or two sentences.>**
<Confirmed: the command and its result, or the trace | Plausible: argued, not run> · [`<file>:<line>`](<link>)

**Fix:** <the specific change>. **Test:** <the test that fails before the fix; none for a text-only fix>.

<optional: the few lines that show it, or the fix as a diff; at most 10 lines>
</details>

### ❓ Questions
- **Q1. <the question>?** <the options>; I recommend <one>: <why>.

<details>
<summary>☑️ <n> things the owner asked about</summary>

- <the item>: <your answer in a line; the finding's number when it became one>
</details>

<details>
<summary>↪️ <n> follow-ups outside this change</summary>

- <what and where; why it can wait>
</details>
