# Formats the plugin reads

## Status line

The **last line of every turn's final message**:

```
<state>: <one short line>
```

| State | Means | Example |
| --- | --- | --- |
| `working` | Mid-task, stopping only because the turn ended. Avoid it: the plugin nudges you. | `working: tests half written` |
| `waiting` | You wait on something **outside yourself**: the user, a subagent, a command, the plugin's next page. Say what. | `waiting: implementer SH-012.2 building the API` |
| `blocked` | Someone else must clear an obstacle. Say what and who. | `blocked: needs a DATABASE_URL for integration tests` |
| `done` | Your job, or this phase of it, is finished. | `done: PR https://github.com/o/r/pull/42 ready for acceptance` |
| `failed` | You could not do it and stopped. Say why. | `failed: the reproduction needs hardware we do not have` |

A question to the user is a decision block plus `waiting: <what you asked>`.

## Decision block

Every question to the user is one fenced block named exactly `decision` (YAML, never JSON) with a
recommendation and its reason. The plugin shows it as a card; a button sends its `prompt` back to
you as the user's words.

````
```decision
id: fee-storage            # unique within the ticket; reuse it to replace the decision
question: Store fees per trade or aggregate hourly?
why: Hourly loses per-trade audit; per-trade grows the collection about 40×
blocking: false            # true only for real gates (below)
options:
  - label: Per trade
    prompt: Store fees per trade
    consequence: full audit, larger storage
  - label: Hourly
    prompt: Aggregate fees hourly
    consequence: small, no per-trade audit
recommended: Per trade
reason: audits need it; storage is cheap at current volume
default: Per trade         # what you do if the user does not answer
surprise: Out of scope says "no schema change"   # only after approval, below
```
````

- **One open question at a time** (owners): ask the next only after the user answered the last, in
  a later turn; the plugin holds back a second. Re-asking the open one (same `id`) is fine; to ask
  something else, withdraw it in the same message (same `id`, `status: withdrawn`). Only the
  card's answer or your withdrawal closes it, never words in your tab: when
  the user answers in words, withdraw it.
- **Blocking** (`blocking: true`) stops you until answered: every owner question before its plan is
  approved (the plugin makes it so), the plan approval, anything destructive, and after approval only
  a surprise. **Non-blocking**: go on at once with `default`.
- **`surprise:`** (after the round's approval only; leave it out before): the approved criterion or
  Out of scope line the answer would change. Without it the plugin does not show a plan approval
  again, shows any other blocking question as not blocking with its `default`, and holds one
  without a `default`; it tells you.
- The `question` stands alone on the card, in at most about three lines: never "three options" or
  "see above". Labels are a few words answering it. Never offer an option meaning only "type
  something else" (Other, Change…): every card has a text box. A `prompt` ending in `…` asks the
  user to type more with it.
- A long value may be a YAML block scalar (`why: |` keeps lines, `why: >` joins them).
- Options the user should see (mockups, layouts) name images under `images:`, one `file — caption`
  per line (`reference/images.md`).
- Before approval, 2–4 independent questions share a card: `reference/several-questions.md`.

### Presets

| id | Options | Recommend |
| --- | --- | --- |
| `scope-approval` | Approve · Split into children (when proposed) | Approve; the question is `Approve the plan for <ID>?` |
| `child-breakdown` | Approve · Fewer children | Approve; after approval only when the scope changes, with `surprise:` |
| `review-dispute` | Apply the fix · Accept as a limitation | after approval: Accept as a limitation, listed in FINAL, non-blocking; blocking only with `surprise:` |

Acceptance and the merge are never a decision block: the plugin shows Accept on a delivered ticket,
and does not show a question asking for one.
