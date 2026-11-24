<!-- The owner's verdict after fixing Review <n>: `verdict-<n>.md` in `$TARO_EVIDENCE/<ID>/`, posted with `gh pr comment <url> --body-file <file>` and sent to the reviewer, whose next review checks it. One row per finding and question, in number order. Fold detail away and write it only where the reviewer must read more: a fix that differs from the one suggested, a rejection whose evidence takes more than a line, what is still unproven. Leave out empty sections and these comments. -->
## 🧰 Verdict on review <n> · `<reviewed head>..<fix head>`

**<n> valid** · <n> partly valid · <n> invalid · ✅ <n> fixed · <the suite command's result at the fix head>

<one sentence, only when the reviewer must know something first, such as where you disagree with its overall verdict>

| Finding | Verdict | What changed | Proof |
| --- | --- | --- | --- |
| 🔴 **F1** <title> | valid | <the fix in a few words> (`<sha>` when the range has several commits) | `<test>` fails without it |
| 🟡 **F2** <title> | valid, re-graded 🔵 Low | <the fix in a few words> | `<test>` fails without it |
| 🟡 **F3** <title> | invalid | — | <the evidence: a file:line or a command's output> |
| ❓ **Q1** <the question> | decided | <the ruling> | — |
| ↪️ <a follow-up> | follow-up | <fixed in `<sha>`, or "in FINAL"> | — |

<details>
<summary>🔀 F1: <why it differs from the suggested fix></summary>

<the reason, and the code when it is shorter than the words>
</details>

<details>
<summary>⚠️ Still unproven after these fixes</summary>

- <a gap the tests do not cover, or a risk left open>
</details>
