## User's intent

I want my notes to remember when something is due, and I want the app to tell me what I need to do. Give a note a due date (`--due` when adding or editing), let me mark a note done and undone (`notes done <id>`, `notes undone <id>`), and add `notes agenda` that shows what is coming up. A note that is done should leave the agenda.

Anything that needs today's date reads `NOTES_TODAY` (`YYYY-MM-DD`) when it is set, and the local date otherwise, so the app can be tested on a fixed day.

## Manager's notes

- Outcomes: I can put a due date on a note, mark it done, and run `notes agenda` to see what is due; my existing notes keep working.
- Related: none found.
- Likely areas: `src/notes.js`, `src/cli.js`, `src/format.js`, `src/args.js`, `README.md`, tests in `test/`.
- Out of scope: recurring notes, reminders or notifications, times of day.
- Kind: change. Owner model: set when the owner starts.
