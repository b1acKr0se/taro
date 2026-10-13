# Formats the plugin reads

## Status line

The **last line of every turn's final message**:

```
<state>: <one short line>
```

| State | Means | Example |
| --- | --- | --- |
| `working` | You are mid-task and stopping only because the turn ended. Avoid it: the plugin treats it as a stall and nudges you. | `working: tests half written` |
| `waiting` | You wait on something **outside yourself** — the user, a subagent, a running command. Say what. | `waiting: implementer SH-012.2 building the API` |
| `blocked` | You cannot continue without someone else clearing an obstacle. Say what and who. | `blocked: needs a DATABASE_URL for integration tests` |
| `done` | Your job (or this phase of it) is finished. | `done: PR https://github.com/o/r/pull/42 ready for acceptance` |
| `failed` | You could not do it and stopped. Say why. | `failed: the reproduction needs hardware we do not have` |

A question to the user is a decision block plus `waiting: <what you asked>`.

## Decision block

Every question to the user is one fenced `decision` block (YAML) in your message, with a
recommendation and its reason. The plugin shows it as a card with buttons; a button sends its
`prompt` back to you as the user's words. Several blocks in one message are fine.

````
```decision
id: fee-storage            # unique within the ticket; reuse it to replace the decision
question: Store fees per trade or aggregate hourly?
why: Hourly loses per-trade audit; per-trade grows the collection about 40×
blocking: false            # true only for real gates (see below)
options:
  - label: Per trade
    prompt: Store fees per trade
    consequence: full audit, larger storage
  - label: Hourly
    prompt: Aggregate fees hourly
    consequence: small, no per-trade audit
recommended: Per trade
reason: audits need it; storage is cheap at current volume
default: Per trade         # what you do if the user does not answer (non-blocking)
```
````

- **Non-blocking** (`blocking: false`): carry on at once with `default`; the card says so and the
  user may override later. This is the normal case: decide, state the assumption, keep going.
- **Blocking** (`blocking: true`): stop and wait. Only for real gates: scope approval when you made a
  choice the user did not, a child breakdown, a merge, anything destructive, a review dispute you
  cannot settle.
- An option whose `prompt` ends with `…` asks the user to type (e.g. `Change…`).
- A long value (any field, option fields too) may span lines as a YAML block scalar: `why: |`
  keeps the line breaks, `why: >` joins the lines into one paragraph; indent the lines under it.
- To withdraw a decision: a block with the same `id` and `status: withdrawn`.

### Presets

Use these ids and options for recurring decisions (add free-form ones as needed):

| id | Options | Recommend |
| --- | --- | --- |
| `scope-approval` | Approve · Change… · Split into children | Approve |
| `complexity` | Keep · Lower · Raise | Keep |
| `child-breakdown` | Approve · Fewer children · Adjust… | Approve |
| `merge` | Merge · Hold | Merge, when review passed and the head is unchanged |
| `investigation-done` | Build the recommendation · File follow-up · Close | Build |
| `review-dispute` | Apply the fix · Accept as a limitation · Alternative… | your verdict |

Acceptance is not a decision block: the plugin shows Accept / Request changes on tickets in
Awaiting acceptance.
