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
`prompt` back to you as the user's words.

**One open question at a time** (owners, TR-124): ask one decision per message, and the next only
after the user has answered the last one, in a later turn, with that answer folded in (a plan
approval comes after the clarifying question's answer, and the plan includes it). While one of your
decisions is open the plugin does not show another: it tells you which it held back. Re-asking the
open decision (same `id`) is fine; to ask something else instead, withdraw the open one in the same
message. Only an answer on the card or your withdrawal closes an owner's decision: messages in your
tab, the manager's included, leave it open (TR-134). So when the user answers it in words instead
(in your tab or chat), withdraw it in your reply. The manager may ask about several tickets at once.

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
  user may override later. This is the normal case once a plan is approved: decide, state the
  assumption, keep going. An owner still settles it before delivering: answered, or withdrawn when
  the user answered it in words or it no longer applies (Accept waits until then).
- **Blocking** (`blocking: true`): stop and wait. Only for real gates: an owner's question before
  its plan is approved (every one: the plugin shows it as blocking whatever its flag), a reviewer's
  Question (asked and answered before the owner delivers), scope approval when you made a choice the
  user did not, a child breakdown, a merge, anything destructive, a review dispute you cannot settle.
  An owner never delivers with a question open: the plugin takes such a delivery back.
- The board shows the `question` and the option labels on a card with nothing else, and a tap on a
  label answers. So the `question` stands alone, in at most about three lines: say what is to be
  decided, never "three options", "recommends A" or "see above". Labels are a few words each and
  read as answers to it.
- Every card ends with an Other row and a text box: picking Other and typing is how the user asks for
  a change or answers in their own words (a `scope-approval` card has Request changes… instead,
  which opens its box). A picked option is sent alone, with no note. So never offer an option that only stands for that: no "Change…", "Adjust…",
  "Alternative…", "Other" or "Something else" (the plugin hides them). Real options stay, such as
  "Split into children".
- An option whose `prompt` ends with `…` asks the user to type more words with it (e.g. `Pick a
  name…`).
- A long value (any field, option fields too) may span lines as a YAML block scalar: `why: |`
  keeps the line breaks, `why: >` joins the lines into one paragraph; indent the lines under it.
- To withdraw a decision: a block with the same `id` and `status: withdrawn`.
- A choice between things the user should see (mockups, layouts): each option names its images
  under `images:`, one `file — caption` per line (rules: Images, below). The card shows them under
  the option; tapping one opens that option's images with its label in the viewer's bar.

  ```
  options:
    - label: Floating pills
      prompt: Use floating pills
      images: |
        option-a-floating-pills-phone.png — the notes list on a phone
        option-a-floating-pills-desktop.png — the notes list on a desktop
  ```

## Images

Every image you show the user (evidence screenshots, mockups) is a file in `$TARO_EVIDENCE/<ID>/`
(the folder is in `reference/tickets.md`, EVIDENCE), shown with a caption:

- **The name says what it shows**: which version, which view, which screen, e.g.
  `option-a-floating-pills-phone.png`, `after-desktop-board.png`, `before-phone-inbox.png`. Never
  `screenshot-1.png` or `mockup.png`: the name is shown under the image.
- **Every image has a short caption** saying what it shows: the text after ` — ` in an EVIDENCE
  `screenshot:` line or an option's `images:` line, the alt text of an image in a message
  (`![the board on a phone](/absolute/path/after-phone-board.png)`). A screenshot line without a
  caption fails the evidence check; an option image without one is an incomplete block.
- Options with images: name them `option-<letter>-<what>-<device>.png`, so each file says which
  option it belongs to even outside the card.

### Presets

Use these ids and options for recurring decisions (add free-form ones as needed):

| id | Options | Recommend |
| --- | --- | --- |
| `scope-approval` | Approve · Split into children (when proposed) | Approve; the `question` is `Approve the plan for <ID>?`, the plan in the ticket (`templates/plan.md`, `roles/owner.md`) |
| `complexity` | Keep · Lower · Raise | Keep |
| `child-breakdown` | Approve · Fewer children | Approve |
| `merge` | Merge · Hold | Merge, when review passed and the head is unchanged |
| `investigation-done` | Build the recommendation · File follow-up · Close | Build |
| `review-dispute` | Apply the fix · Accept as a limitation | your verdict |

The user asks for a change, or another approach, by typing in the card's field (for a plan, the
box Request changes… opens); no preset has an option for it.

Acceptance is not a decision block: the plugin shows Accept / Request changes on tickets in
Awaiting acceptance.
