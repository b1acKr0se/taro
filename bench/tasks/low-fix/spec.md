# What the user wants (the decider's full intent)

An id that is not a plain run of digits must not find a note.

## Stated in the brief (the owner already has these)

- `notes show 0x1` says there is no such note, instead of showing note 1.
- It applies wherever the app takes an id (`show`, `edit`, `rm`).

## Details the user cares about (answer from these when asked)

- The message is the existing one: `no note 0x1` on stderr, exit 1, whatever was typed.
- Ids such as `1e0`, `1.0`, `+1`, ` 1` and `` (empty) are not ids either; `1` and `01` still find note 1.
- A failed `rm` leaves the data file as it was.
- A test that failed before the fix comes with it.

## Hidden preferences

None. If a question comes up, answer "do exactly what the brief says, nothing more".

## How to answer

- Anything the spec does not cover: pick the simplest option and say it is the owner's call.
