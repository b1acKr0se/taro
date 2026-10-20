## User's intent

I keep my notes in this little notes app, and I want to read them in my editor. Add `notes export <dir>`: it writes one Markdown file per note into that folder, with the note's title, tags and dates at the top as front matter, then the note's text.

## Manager's notes

- Outcomes: I can run `notes export ~/vault` and find one `.md` file per note there, each starting with front matter and followed by the note's text.
- Related: none found.
- Likely areas: `src/cli.js` (the commands), a new `src/export.js`, `README.md`, tests in `test/`.
- Out of scope: importing notes back.
- Kind: change. Owner model: set when the owner starts.
