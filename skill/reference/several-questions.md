# Several questions on one card

Before the plan is approved, when you need two to four answers before your next step and they are **independent** (no answer
changes another's options), ask them on one card: `questions:`, a list of 2–4 items in place of the
top-level `question` and `options`. Each item has a short `header` (at most 24 characters, unique
on the card: it is the question's tab and pill) and the same fields and rules as a single decision
(`question`, `why`, `options`, `recommended`, `reason`). `id`, `blocking` and `status` stay at the
top. No `default`: each question waits for the user. When one answer would change what you ask
next, ask one question, then the next after its answer. After the plan is approved a block of
several questions is held back like any second question: ask one at a time then.

The card is one decision: it is withdrawn whole. The user answers the questions one at a time on the card, but they reach you as **one
message**, a line per question in the card's order: `<header>: <option prompt>`, or
`<header>: "<their own words>"` (quoted). `scope-approval` stays a single question.

````
```decision
id: export-format
blocking: true
questions:
  - header: Tag format
    question: Should exported notes keep their tags as YAML front matter or as a hashtag line?
    why: Front matter is read by static site tools; hashtags read better in plain editors
    options:
      - label: YAML front matter
        prompt: Write tags as YAML front matter
      - label: Hashtag line
        prompt: Write tags as a hashtag line at the top
    recommended: YAML front matter
    reason: the notes are mostly published through a site generator
  - header: Attachments
    question: What should happen to images attached to notes?
    options:
      - label: Copy beside each note
        prompt: Copy images beside each note
      - label: Leave them out
        prompt: Leave images out of the export
    recommended: Copy beside each note
    reason: an export should open without the app
```
````
