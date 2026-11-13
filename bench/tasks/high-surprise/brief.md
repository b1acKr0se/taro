## User's intent

My notes are in two files, one on my laptop and one on my desktop, and I want them in one. Add `notes merge <file>`: it adds the notes of the other file to mine.

I refer to notes by number (`#12`) in other documents, so each note should keep its number.

## Manager's notes

- Outcomes: after `notes merge desktop.json`, my file holds my notes and the desktop's, every note under the same `#` it had; none lost or overwritten.
- Related: none found.
- Likely areas: `src/cli.js` (the command), a new `src/merge.js`, `src/store.js`, `README.md`, tests in `test/`.
- Out of scope: syncing, merging more than one file at a time.
- Kind: change. Owner model: set when the owner starts.
