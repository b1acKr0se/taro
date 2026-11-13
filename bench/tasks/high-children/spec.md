# What the user wants (the decider's full intent)

Three connected features for the notes app: notebooks, search and a summary. All three share one idea:
every note has a notebook, and the notebook filter works the same everywhere.

## Stated in the brief (the owner already has these)

- `--notebook <name>` on `add` and `edit`; `notes notebooks`; `notes list --notebook <name>`.
- `notes search <words> [--notebook n] [--tag t]`; `notes summary`.
- Existing notes keep working. Out of scope: renaming or deleting notebooks, regular expressions.

## Details the user cares about (answer from these when asked)

- A note without a notebook is in `inbox`, including notes already in an existing data file that has no
  notebook field (the file is not rewritten just by reading it).
- `list` lines end with `@<notebook>`: `#3  Buy milk  [home]  @work` (`#3  Buy milk  @work` without tags).
  `show` prints a `notebook: <name>` line right after the title line.
- `notebooks` prints one line per non-empty notebook, `<name>  <count>`, alphabetical;
  `No notebooks.` when there are no notes.
- `search` prints the same lines as `list`; `No matching notes.` (exit 0) when nothing matches; no words
  is an error: exit 1, `search needs words` on stderr.
- `--tag` in `search` and `list` stays whole-tag, case-insensitive.
- Errors exit 1 with the reason on stderr and leave the data file as it was. `search`, `list`,
  `notebooks` and `summary` never write the data file.

## Hidden preferences (the brief leaves these out; reveal one only when a question touches it)

- P1: Notebook names are normalised everywhere (add, edit, list, search filters): trimmed, lowercased,
  each run of whitespace turned into one hyphen (`  Side Project ` → `side-project`). A name empty after
  that is an error: exit 1, `a notebook needs a name`, nothing written. The default is `inbox`.
- P2: Search needs every word (any order, case-insensitive, substring) to appear somewhere in the title,
  body or tags. Notes whose title alone holds every word come first, then the others, each group by id.
- P3: `summary` prints `<n> note(s) in <m> notebook(s)` (singular for 1: `1 note in 1 notebook`), then
  one line per non-empty notebook, two spaces indent, `<name>  <count>`, most notes first, ties by name;
  `No notes.` when there are none.

## How to answer

- Questions about name normalisation, empty names, search matching or ranking, the summary's layout or
  singular forms touch P1, P2 or P3: answer from them and name it.
- Questions about output formats of list, show, notebooks, search, errors or old data files: answer from
  the details.
- Anything else the spec does not cover: pick the simplest option and say it is the owner's call.
