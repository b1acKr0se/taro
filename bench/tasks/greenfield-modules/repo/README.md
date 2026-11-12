# notesite

A small static site generator for a folder of Markdown notes, in Python 3.12 with the standard
library only (no packages to install).

    python3 -m notesite build <notes folder> <output folder> [--template <file>]

Goal: every note becomes a page, with a home page listing the notes, a page per tag, and
"Linked from" lists built from `[[wiki links]]` between notes.

Nothing is built yet: `notesite/` holds only the package marker.

## Tests

    python3 -m unittest discover -s tests
