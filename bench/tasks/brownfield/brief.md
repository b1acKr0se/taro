## User's intent

Add column widths to minisheet's CSV export, set from sitegen front matter, as the attached specification describes: a new `parse_widths` in `minisheet.csvio`, a `widths` argument on the CSV writers, and a new `sheetsite` package that reads a `csv_widths` front matter key. This is a feature on an existing repository, not a rebuild; existing behaviour must not change.

## Manager's notes

- Outcomes: exporting a sheet for a post writes a CSV with the widths the post's front matter asks for; every existing call without `widths` behaves byte for byte as before.
- Interfaces: `minisheet.csvio.parse_widths`, `widths=` on `to_csv_text` and `save_csv`, and the `sheetsite` package with its CLI, as the specification defines them.
- Related: the existing `sitegen` and `minisheet` packages and their tests; `vendor/` is a third-party copy, not part of the project.
- Likely areas: `src/minisheet/csvio.py`, `src/sitegen/frontmatter.py` (read, not changed), new `src/sheetsite/`, `pyproject.toml`, `tests/`.
- Out of scope: anything under `vendor/`; any change to existing public behaviour.
- Kind: change. Owner model: set when the owner starts.

- Specification: attached as `SPEC.md` at the repository root.
