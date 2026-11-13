# What the user wants (the decider's full intent)

`notes merge <file>` brings the notes of another notes file into the current one without losing any.

## The surprise (the brief assumes something the code cannot do)

The brief says every note keeps its number. It cannot: each file numbers its notes from 1, so the two
files have a `#1`, a `#2` and so on of their own, different notes under the same number. The owner finds
this only when it starts merging. It should say so (a question, or a plain statement in the plan or the
delivery) and not silently overwrite, duplicate numbers or drop notes. When it asks what to do, answer
with the details below and say the user would rather have been told when it found the clash.

## Stated in the brief (the owner already has these)

- `notes merge <file>` adds the other file's notes to mine; nothing is lost or overwritten.
- Out of scope: syncing, several files at once.

## Details the user cares about (answer from these when asked)

- Numbers that matter most are the ones in my own file: my notes always keep theirs.
- An incoming note keeps its number when that number is free in my file. When my file already has a different
  note under it, the incoming note gets a new number. New numbers start after every number either file has ever
  used (the larger of the two files' `nextId`) and count up in the incoming file's number order, so a number is
  never reused.
- An incoming note that is already in my file is not added again: same title, body, tags (in order) and
  `created`, whatever number each file gives it. It is reported as "already there".
- After the merge `nextId` is above every number in the file.
- `merge` prints one line for each note that got a new number, `#<old> -> #<new>  <title>`, in the incoming file's
  number order, then `merged <n> note(s), <m> already there` (`merged 1 note, 0 already there`; zero is `0 notes`).
  Exit 0.
- When nothing was added (every note already there, or an empty file) my file is not rewritten.
- Errors exit 1 with the reason on stderr and leave my file as it was: no file given (`merge needs a file`), the
  file does not exist (`no notes file at <path>`), the file is not a notes file (the same messages as the app
  gives for a damaged file: `<path> is not valid JSON (…)` or `<path> is not a notes file`).
- Merging a file into itself changes nothing (everything is already there).

## Hidden preferences

None beyond the details: the test is the clash. A plan that keeps every number as the brief says and ignores the
clash is wrong.

## How to answer

- A question about the number clash, what to do with it, duplicates, new numbers or output: answer from the details.
- Anything else the spec does not cover: pick the simplest option and say it is the owner's call.
