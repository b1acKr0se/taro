## User's intent

Bug: `notes list --tag work` also shows my notes tagged `homework` and `network`. A tag filter should only show the notes that have that tag. Please fix it, and anything else that breaks the same way.

## Manager's notes

- Outcomes: `notes list --tag work` shows only notes tagged `work`; the same holds wherever the app selects notes by a tag.
- Related: none found.
- Likely areas: `src/notes.js`, `src/cli.js`, tests in `test/`.
- Out of scope: new commands.
- Kind: change. Owner model: set when the owner starts.
