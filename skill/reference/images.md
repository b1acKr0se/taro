# Images

Every image you show the user (evidence screenshots, plan mockups, options) is a file in
`$TARO_EVIDENCE/<ID>/` (the folder: `reference/tickets.md`, EVIDENCE), shown with a caption:

- **The name says what it shows**: which version, view and screen, e.g.
  `option-a-floating-pills-phone.png`, `after-desktop-board.png`, `before-phone-inbox.png`. Never
  `screenshot-1.png` or `mockup.png`: the name is shown under the image. Name the theme when it
  matters (`after-desktop-dark-board.png`).
- **Every image has a short caption** saying what it shows: the text after ` — ` in an EVIDENCE
  `screenshot:` line or an option's `images:` line, the alt text of an image in a message
  (`![the board on a phone](/absolute/path/after-phone-board.png)`). A screenshot line without a
  caption fails the evidence check; an option image without one is an incomplete block.
- Plan mockups: `mockup-<what>-<device>.png`, listed in the plan's Mockups section as `file —
  description` (`templates/plan.md`); the description says what changes, not just what is shown.
- Options with images: `option-<letter>-<what>-<device>.png`, so each file says which option it
  belongs to even outside the card. The card shows them under the option:

  ```
  options:
    - label: Floating pills
      prompt: Use floating pills
      images: |
        option-a-floating-pills-phone.png — the notes list on a phone
        option-a-floating-pills-desktop.png — the notes list on a desktop
  ```
