# What the user wants (the decider's full intent)

Due dates, a done state and an agenda for the notes app. Three pieces that fit together: a note's due date, whether
it is done, and the agenda view over both.

## Stated in the brief (the owner already has these)

- `--due` on `add` and `edit`; `notes done <id>`; `notes undone <id>`; `notes agenda`.
- A done note leaves the agenda. Today's date is `NOTES_TODAY` (`YYYY-MM-DD`) when set, else the local date.
- Existing notes keep working. Out of scope: recurring notes, notifications, times of day.

## Details the user cares about (answer from these when asked)

- `list` still shows every note, done or not. Its lines end with the due date and the done mark, after the tags:
  `#3  Buy milk  [home]  due 2026-03-12` and, when done, `#3  Buy milk  [home]  due 2026-03-12  done`
  (`#3  Buy milk  done` with neither tags nor a due date). Notes with neither are printed as before.
- `show` prints a `due: <date>` line right after the `tags:` line (after the title line when there are no tags) and
  a `done: <date>` line right after `updated:`. Neither line is printed when the note has no such field.
- The data file keeps `due` and `done` as `YYYY-MM-DD` strings, and a note without one has no such key at all (not
  `null`). An old data file without them keeps working, and a command that only reads never writes the file.
- `done` prints `done #3`, `undone` prints `undone #3`. Errors exit 1 with the reason on stderr and leave the data file
  as it was.

## Hidden preferences (the brief leaves these out; reveal one only when a question touches it)

- P1: A due date is `YYYY-MM-DD` and a real calendar day (`2026-02-30` is not one). Anything else is an error: exit 1,
  `a due date must be YYYY-MM-DD` on stderr, nothing written. `--due none` on `edit` clears the due date; on `add` it
  means no due date.
- P2: `--due today` and `--due tomorrow` are accepted and stored as the dates they mean on the day they are typed
  (from `NOTES_TODAY` or the local date), never as the words.
- P3: `done` stores today's date as the note's `done` date. `done` on a note that is already done is not an error: exit 0,
  `#3 is already done`, and its done date stays. `undone` removes the done date; on a note that is not done: exit 0,
  `#3 is not done`. A done note can still be edited, and editing never changes its due or done date unless asked.
- P4: The agenda has four groups in this order: `Overdue` (due before today), `Today`, `Next 7 days` (tomorrow up to and
  including today + 7), `Later`. Each opens with a heading line `<Group> (<count>)` and its notes follow, two spaces of
  indent, in the same form as `list`, ordered by due date then id. A blank line separates groups; a group with no notes
  is left out. With nothing to show the agenda prints `Nothing due.` and exits 0.
- P5: In `Overdue`, each line ends with how late it is: `  (9 days late)`, `  (1 day late)`. No other group gets a note of
  this kind.
- P6: The agenda leaves out done notes and notes with no due date. `notes agenda --tag <tag>` narrows it to notes carrying
  that whole tag, the way `list --tag` does.
- P7: `agenda`, `list` and `show` never write the data file.

## How to answer

- Questions about date formats, `today`/`tomorrow`, clearing, invalid dates, done twice, undone, what editing does to a
  done note, agenda groups, ordering, the week's edge, late notes, tags or what is left out of the agenda touch P1…P7:
  answer from them and name the one.
- Questions about the line formats of list or show, the data file, messages or errors: answer from the details.
- Anything else the spec does not cover: pick the simplest option and say it is the owner's call.
