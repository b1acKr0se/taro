# Delivery

The review is clean: present the work so the user can accept it. The plugin's message above this
page lists what the ticket still lacks for Accept; each item below says how to supply it.

## The branch

- **Pull-request delivery:** once local checks pass, push `taro/<id>` and open the PR (a draft when
  an independent review runs, then mark it ready; ready at once after a self-review). CI is not a
  gate.
  - **Title and body are yours, never the commit's:** `gh pr create --draft --title '<title>'
    --body-file <file>`, never `--fill` (it copies a lone commit's message). Default title:
    `<ID>: <outcome in user terms>`, usually the ticket title, at most about 70 characters, no
    Conventional Commit prefix. Default body: `templates/pull-request.md`, neutral (SKILL.md
    rule 8). Before Awaiting acceptance, bring the body up to date with `gh pr edit --body-file`.
  - **The repository's conventions win:** a PR template (`.github/pull_request_template.md`, or one
    under `.github/PULL_REQUEST_TEMPLATE/` or `docs/`) is the body instead; a title format in its
    instructions (AGENTS.md, CLAUDE.md, CONTRIBUTING) replaces the default, and if they forbid
    ticket IDs in titles, leave the ID out.
  - The plugin warns on the Accept card when a default-template body is empty, copies the commit
    message or lacks the template's headings; it never blocks Awaiting acceptance. Fix the body, or when the template truly does not fit
    (a repository rule) append `PR-TEMPLATE <time> — <why>` to the ticket.
- **Local-only delivery:** leave a clean branch that fast-forwards from the base branch.

## Show it as the user will see it

Any visible change, at every level:

- Capture with **realistic content**: text of real length and shape, with the markup real text
  carries (Markdown and HTML, not "Lorem"), long names, many items, the empty state; plus **at least
  one stress case per screen touched** (the longest, the most, the emptiest). Names stay neutral.
- **Both themes:** a change that adds or restyles something drawn (an element, a style, a colour,
  an icon) shows each screen it touches at least once in dark and once in light; text in the
  platform's default colour vanishes in one of them. Wording alone needs one theme.
- **Coverage map:** list each screen section or state the diff renders, changes, moves or re-wraps
  (only those; when unsure, include it) and the screenshot that shows it, as EVIDENCE `coverage:`
  lines. Capture each with data that exercises it: a parent with children for a children section, a
  long value for a value column. A changed section with no screenshot is not delivered; with
  screenshots, Accept is refused without the map.
- **User's-eyes pass:** open every screenshot and read it against the user's words as a picky user
  would. On each changed screen write down whether label and value columns and row edges line up,
  and any fallback or placeholder text (Unknown, undefined, null, NaN, `{}`, `[object Object]`, an
  empty label). Reject those and also: mismatched sibling controls; clipped, overlapping or covered
  UI (a keyboard over a button); see-through layers; raw markup or escaped HTML; wrong case; leftover
  debug text. Fix and re-capture, or name it in FINAL as a limitation. Minutes, not a round.
- Record the result as the EVIDENCE `ux:` line, per changed screen; a reviewer's visual verdict goes
  on it too; with screenshots, Accept is refused without it. Images: `reference/images.md`.

## The records

1. **No question of yours open:** each answered, or withdrawn when the user answered it in words or
   it no longer applies. One you went on with by default after approval is a RULING; delivery closes
   it. The plugin takes a delivery with an open question back to In Progress.
2. **EVIDENCE** (`reference/tickets.md`): the checks with results, the review outcome, the `ux:`
   line and coverage map, the screenshots in `$TARO_EVIDENCE/<ID>/` (desktop and phone for visible
   changes), or `screenshots: none` with a reason. An investigation needs at least one `check:` line.
3. A new EXECUTION record with `pr: <url>` (pull request) and `review-head: <sha>` (the full `headRefOid` from
   `gh pr view <url> --json headRefOid`, or your branch head for local delivery): Accept merges
   that head.
4. **FINAL** (`--final-summary`, `templates/final.md`: What changed ≤5 bullets, How it was verified
   ≤3, Limitations ≤3, Rulings ≤5 when you made any, the revision line), moving the ticket to
   **Awaiting acceptance** in the same edit. An investigation then raises its `investigation-done`
   decision.

The user accepts or requests changes from the card under your newest `done:` message: end the
delivering turn with `done: …`
and any later reply while you await acceptance with `waiting: acceptance of <ID>`.

## After delivery

- **Request changes:** the user's words arrive as a message, and the plugin has already moved the
  ticket back to In Progress (if
  the ticket still reads Awaiting acceptance, the plugin's write failed: move it yourself). Size the
  fix like a new task; read the new screenshots against those words; return to Awaiting acceptance
  with a new review head. Words that only ask a question: answer them, and when nothing needs to
  change, deliver again as it was. Either way the turn that delivers again ends with `done: …`.
- **The user chats instead** (not from Request changes): the ticket and its card stay. Words that
  only ask: answer and end with `waiting: acceptance of <ID>`. Words that need a change: move to In
  Progress first, then deliver again. A blocking question back to the user ends the delivery (the
  plugin moves the ticket to In Progress and records DELIVERY-ENDED); once answered, deliver again.
- **Only the user's press of Accept accepts.** Never ask them to accept or merge, in a decision or in
  words: the card is the only Accept. Words in chat ("I merged it", "looks good") are never one:
  verify what they ask, report, and wait. ACCEPTANCE and Done are written only after the plugin hands
  you an Accept (`phases/accept.md`), even when the user merged the PR themselves.
