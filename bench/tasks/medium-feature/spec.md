# What the user wants (the decider's full intent)

The user keeps notes with the notes app and wants to read them in their editor (they use a Markdown
vault). `notes export <dir>` writes one Markdown file per note into `<dir>`.

## Stated in the brief (the owner already has these)

- One `.md` file per note, in `<dir>`.
- Each file starts with front matter holding the note's title, tags and dates, then the note's body.
- Out of scope: importing.

## Details the user cares about (answer from these when asked)

- The front matter is YAML between `---` lines with the fields `id`, `title`, `tags`, `created`,
  `updated`, in that order; the body follows after one blank line. Dates are the stored ISO 8601
  strings. A note with no body is just the front matter.
- `export` prints `exported <n> notes to <dir>` (`exported 1 note to <dir>` for one) and exits 0.
- An empty store prints `No notes to export.`, exits 0 and creates no folder.
- The folder is created when it is missing, with its parents.
- An error (the path is an existing file, the folder cannot be written) exits 1 with the reason on
  stderr and leaves the notes data file as it was.
- A very long title must not make a file name too long: file names are capped at 80 characters.

## Hidden preferences (the brief leaves these out; reveal one only when a question touches it)

- P1: File names are the title lowercased with every run of characters other than letters and digits
  turned into one hyphen, hyphens trimmed from both ends, cut to 60 characters, plus `.md`
  (`Buy milk!` → `buy-milk.md`). Two notes with the same name get `-2`, `-3` before `.md` in id order. A
  title with no letters or digits (`!!!`) is named `note-<id>.md`.
- P2: Titles are written as a double-quoted JSON string so a colon or a quote in a title is safe
  (`title: "Re: \"plan\""`); tags are written on one line as a JSON array (`tags: ["home", "errands"]`,
  `tags: []` when there are none).
- P3: Export is safe to repeat and never destructive: running it twice gives the same files (a note's
  own file is rewritten, not given a `-2`), and it never deletes or changes any file in the folder that
  it did not write (other files, other notes' files from an earlier export stay).

## How to answer

- Questions about file names, collisions, quoting of titles, tags format, repeat runs or existing
  files touch P1, P2 or P3: answer from them and name it.
- Questions about the front matter fields, the dates, messages or errors: answer from the details.
- Anything else the spec does not cover: pick the simplest option and say it is the owner's call.
