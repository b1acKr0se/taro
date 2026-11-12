## User's intent

My notes are one long pile. I want three things in the notes app: notebooks to group notes in, a search to find notes by words, and a summary of what I have.

- Notebooks: a note belongs to one notebook (`--notebook <name>` when adding or editing); `notes notebooks` lists the notebooks with their counts; `notes list --notebook <name>` shows one notebook.
- Search: `notes search <words>` finds notes by words, and can be narrowed with `--notebook` and `--tag`.
- Summary: `notes summary` says how many notes I have and how they spread over notebooks.

## Manager's notes

- Outcomes: I can put notes in notebooks, see them listed, search them, and get the summary; my existing notes keep working.
- Related: none found.
- Likely areas: `src/notes.js`, `src/cli.js`, `src/format.js`, `README.md`, tests in `test/`.
- Out of scope: renaming or deleting notebooks, regular expressions in search.
- Kind: change. Owner model: set when the owner starts.
