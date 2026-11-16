# notes-app

A small command-line notes app. Notes live in one JSON file; set `NOTES_FILE` to choose it
(default `~/.notes.json`).

    node bin/notes.js add "Buy milk" --body "2 litres" --tag home --tag errands
    node bin/notes.js list [--tag home]
    node bin/notes.js show 1
    node bin/notes.js edit 1 --title "Buy oat milk" --body "1 litre"
    node bin/notes.js rm 1
    node bin/notes.js rm --tag errands      # every note with that tag
    node bin/notes.js count [--tag home]
    node bin/notes.js tags

Every command exits 0 on success and 1 on a problem, with the reason on stderr.

## Layout

- `src/args.js`   command line parsing
- `src/store.js`  reading and writing the JSON file (written atomically)
- `src/notes.js`  creating, finding, editing and removing notes
- `src/format.js` the text the commands print
- `src/cli.js`    the commands
- `bin/notes.js`  the entry point

## Tests

    npm test
