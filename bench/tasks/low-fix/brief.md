## User's intent

`notes show 0x1` shows note 1. I typed a hex number by mistake and it opened a note instead of telling me the id was wrong. It should say there is no such note.

## Manager's notes

- Outcomes: an id that is not a plain number of digits finds no note, wherever the app takes an id.
- Related: none found.
- Likely areas: `src/notes.js`, tests in `test/`.
- Out of scope: new commands, changing any message.
- Kind: fix. Owner model: set when the owner starts.
