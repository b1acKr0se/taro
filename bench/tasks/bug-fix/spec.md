# What the user wants (the decider's full intent)

The user's tag filter returns notes whose tag merely *contains* the filter (`work` matches
`homework`). Every place the app selects notes by a tag must match whole tags only.

## Stated in the brief (the owner already has these)

- `notes list --tag work` shows only notes tagged `work`.
- "Anything else that breaks the same way" is also in scope: `count --tag` and `rm --tag` select by
  tag too. `rm --tag` is the dangerous one: today it deletes every note whose tag merely contains the
  filter.
- Out of scope: new commands.

## Details the user cares about (answer from these when asked)

- The output formats stay as they are (`removed 2 notes`, `removed 1 note`, `No notes.`, counts).
- `rm --tag work` removes only notes that have the tag `work`; a note with tags `work` and `home`
  goes too; a note tagged only `homework` stays.
- A reproduction first: the fix comes with tests that failed before it.
- Existing tests must keep passing.

## Hidden preferences (the brief leaves these out; reveal one only when a question touches it)

- P1: Matching is whole-tag and case-insensitive: `--tag Work` finds notes tagged `work` or `WORK`.
- P2: Stored tags are never changed: the data file keeps tags exactly as typed (no lowercasing,
  no rewriting), and `list` and `count` never write the data file. `show` and `list` print tags as typed.
- P3: A leading `#` on the filter is ignored: `--tag '#work'` means `work`. A filter that is empty after
  that (`--tag ''`, `--tag '#'`) is an error: exit 1, `a tag filter needs a tag` on stderr, nothing removed.

## How to answer

- Questions about case, upper/lower, `#`, empty filters, rewriting or normalising stored tags touch
  P1, P2 or P3: answer from them and name it.
- Questions about which commands to cover or the output wording: answer from the details.
- Anything else the spec does not cover: pick the simplest option and say it is the owner's call.
