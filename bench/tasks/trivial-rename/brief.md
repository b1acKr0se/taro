## User's intent

Rename the `rm` command of the notes app to `delete`. Everything else stays exactly as it is: the same arguments, the same output.

## Manager's notes

- Outcomes: `notes delete 3` removes note 3 and prints what `notes rm 3` printed; `notes rm` is gone.
- Related: none found.
- Likely areas: `src/cli.js` (the command and its help text), `README.md`, `test/cli.test.js`.
- Out of scope: any other command, any alias.
- Kind: change. Owner model: set when the owner starts.
