# What the user wants (the decider's full intent)

The `rm` command is renamed `delete`, and nothing else changes.

## Stated in the brief (the owner already has these)

- `notes delete <id>` does what `notes rm <id>` did, with the same output (`removed #3`) and errors (`no note 3`, exit 1).
- `rm` no longer exists: it is an unknown command like any other.
- Out of scope: other commands and aliases.

## Details the user cares about (answer from these when asked)

- The help text and the README name `delete`, not `rm`.
- The existing tests that used `rm` use `delete`.

## Hidden preferences

None. This is an exact rename: if a question comes up, answer "do exactly what the brief says, nothing more".

## How to answer

- Anything the spec does not cover: pick the simplest option and say it is the owner's call.
