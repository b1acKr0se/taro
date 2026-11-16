# Feature: column widths for minisheet's CSV export, set from sitegen front matter

This repository already exists. It holds two independent stdlib-only packages, `sitegen` (a static site generator) and `minisheet` (a mini spreadsheet engine with a CLI, an HTTP API and a web UI), under `src/`, with their own tests under `tests/`, plus a vendored third-party library under `vendor/`. Your job is to add the feature below. A hidden acceptance suite checks it exactly, and also re-checks that all existing behavior of `sitegen` and `minisheet` is unchanged. Where a rule or example is given, follow it literally. Python >= 3.12, stdlib only at runtime.

Rules:
- Do not modify anything under `vendor/`, and do not import from it. It is not part of the project.
- Existing public behavior of `sitegen` and `minisheet` must not change: every existing call that does not use the new `widths` argument behaves byte-for-byte as before, and existing tests still pass (`uv run pytest` from the root).
- `sitegen` and `minisheet` stay independent: neither imports the other. The only code allowed to import both is the new package `sheetsite` (section 3).
- Add your own tests under `tests/`, and keep everything committed.

## 1. `minisheet.csvio.parse_widths(spec: str) -> dict[int, int]`

Parses a width specification into `{column index: width}`. Column indexes are 0-based (`A` = 0 ... `ZZ` = 701); widths are `int`.

- `spec` must be a `str`, else `ValueError`. A `spec` that is empty or only whitespace gives `{}`.
- Otherwise `spec` is split at every `,` into items. There is no skipping: an empty or whitespace-only item (as in `"A=5,"`, `",A=5"`, `"A=5,,B=6"`) is a `ValueError`.
- An item is `COL=WIDTH` or `COL-COL=WIDTH`, and must fully match this pattern (ASCII only): optional whitespace, 1 or 2 letters (either case), optional whitespace, optionally `-` followed by optional whitespace and 1 or 2 letters and optional whitespace, `=`, optional whitespace, one or more digits `0-9`, optional whitespace.
- `COL-COL=WIDTH` is an inclusive range covering every column from the first letters to the second; the first must not come after the second (`B-B=4` is valid and means just `B`; `C-A=5` is a `ValueError`).
- `WIDTH` is its decimal value; leading zeros are allowed (`05` is 5). It must be between 1 and 255 inclusive, else `ValueError`.
- A column may be set by only one item: a column that appears in two items (including overlapping ranges such as `A-C=5,B=6`, or the same width given twice) is a `ValueError`.
- Every `ValueError` message contains the stripped text of the offending item (for a duplicate, the later item; for a non-str `spec`, any text).
- Column letters beyond `ZZ` (`AAA=5`) and cell-like items (`A1=5`) do not match the pattern, so they are a `ValueError` too.

| `parse_widths(...)` | Result |
|---|---|
| `"A=12,C=8,AA=20"` | `{0: 12, 2: 8, 26: 20}` |
| `" b = 05 , c - e =3 "` | `{1: 5, 2: 3, 3: 3, 4: 3}` |
| `"zy-ZZ=7"` | `{700: 7, 701: 7}` |
| `""`, `"   "` | `{}` |
| `"A"`, `"A="`, `"=5"`, `"A=0"`, `"A=256"`, `"A=-1"`, `"A=1.5"`, `"AAA=5"`, `"A1=5"`, `"C-A=5"`, `"A=5,A=6"`, `"A-C=5,B=6"`, `"A=5,"`, `5` | `ValueError` |

## 2. `to_csv_text` and `save_csv` accept `widths`

New signatures in `minisheet.csvio` (the existing parameters keep their meaning and position):

```python
def to_csv_text(wb: Workbook, values: bool = True, widths=None) -> str: ...
def save_csv(wb: Workbook, path, values: bool = True, widths=None) -> None: ...
```

- `widths` is `None`, a `dict[int, int]` (as returned by `parse_widths`), or a `str` (parsed with `parse_widths`). `None` and `{}` give exactly today's output.
- Validation happens first, before anything else, even for an empty workbook: any other type, a key that is not an `int` in 0..701, or a value that is not an `int` in 1..255 raises `ValueError` (`bool` is not accepted as an `int`, for keys or values). A str that `parse_widths` rejects raises its `ValueError`.
- Padding: for every field that is emitted in a column listed in `widths`, take the field text `T` (the same text that is written today: `values=True` gives `to_text` of the value, an error gives its code; `values=False` gives the raw text) and pad it on the right with spaces to `len(T) >= W`, i.e. `T.ljust(W)`. Text longer than `W` is never truncated. The quoting rule then applies to the padded text (a field is quoted iff it contains `,` `"` `\n` or `\r`; padding spaces do not trigger quoting, and quoted text contains its padding inside the quotes).
- Only emitted fields are padded: an empty cell that lies inside a row (to the left of that row's last non-empty cell) in a listed column becomes `W` spaces; columns after a row's last non-empty cell are still not emitted; a row without cells is still the line `\n`; an empty workbook is still `""`.
- `save_csv` writes exactly what `to_csv_text` returns for the same arguments (UTF-8, `\n`), and writes nothing if `to_csv_text` raises.

Examples (A1=`ab`, B1=`c`, A2=`x,y`, B2=`=1+1`):

| Call | Output |
|---|---|
| `to_csv_text(wb)` | `ab,c\n"x,y",2\n` |
| `to_csv_text(wb, widths={0: 5})` | `ab   ,c\n"x,y  ",2\n` |
| `to_csv_text(wb, widths="B=3,A=1")` | `ab,c  \n"x,y",2  \n` |
| `to_csv_text(wb, values=False, widths={1: 6})` | `ab,c     \n"x,y",=1+1  \n` |

With only A1=`a`, C1=`c`, A2=`z`: `to_csv_text(wb, widths={1: 3})` is `a,   ,c\nz\n`.

## 3. New package `sheetsite`: widths from front matter

Create `src/sheetsite/` with `__init__.py` (may be empty), `bridge.py`, `cli.py` and `__main__.py` (`sys.exit(main())`), and add the package to the build configuration in `pyproject.toml`, so that `import sheetsite` and `python -m sheetsite` work from the root.

**Front matter key: `csv_widths`.** It is read from a markdown document's front matter exactly as `sitegen.frontmatter.parse` returns it. Its value is either a string holding a width specification (`csv_widths: A=12, C=8`) or a list of strings, each item a width specification (`csv_widths: [A=12, "B-C=8"]`).

`sheetsite.bridge` provides:

```python
def widths_from_meta(meta: dict) -> dict[int, int]: ...
def widths_from_markdown(text: str) -> dict[int, int]: ...
def export_csv(wb: Workbook, markdown_text: str, values: bool = True) -> str: ...
```

- `widths_from_meta(meta)`: if `"csv_widths"` is not a key of `meta`: `{}`. A `str` value: `parse_widths(value)`. A `list` whose items are all `str`: `parse_widths(",".join(items))` (so `[]` gives `{}`, and an empty-string item is an error, as in `parse_widths`). Any other value (int, bool, a list holding a non-str, a dict, ...) raises `ValueError`. Every `ValueError` raised here has a message that starts with `csv_widths: ` (for a `parse_widths` error, followed by its message).
- `widths_from_markdown(text)`: `widths_from_meta` of the metadata that `sitegen.frontmatter.parse(text)` returns. A document with no front matter gives `{}`. A `FrontmatterError` from the parser propagates unchanged.
- `export_csv(wb, markdown_text, values=True)`: `minisheet.csvio.to_csv_text(wb, values, widths=widths_from_markdown(markdown_text))`.

**Command line.** `sheetsite.cli.main(argv: list[str] | None = None, stdout=None, stderr=None) -> int` (argv excludes the program name; defaults come from `sys`; it never raises `SystemExit`):

- `python -m sheetsite export POST_MD CSV_IN CSV_OUT [--raw]`: `POST_MD` is a UTF-8 markdown file, `CSV_IN` is loaded with `minisheet.csvio.load_csv` (formulas on), and `CSV_OUT` is written with `save_csv(wb, CSV_OUT, values=not raw, widths=widths_from_markdown(<POST_MD text>))`. `--raw` may appear anywhere after `export`. On success, stdout gets one line `exported: {N} sized columns` where N is the number of columns in the widths, and the exit code is 0.
- Any `OSError` or `ValueError` (including the `csv_widths` errors, front matter errors and undecodable input): stderr gets one line `error: {message}` (so a bad width spec gives a line starting `error: csv_widths: `), the exit code is 1, and `CSV_OUT` is not created or touched.
- Usage errors (no arguments, an unknown command, an unknown option, or not exactly three positional arguments): stderr gets a line starting `usage: `, the exit code is 2.

Example: `post.md` = `---\ntitle: T\ncsv_widths: A=4, C=2\n---\nbody`, `in.csv` = `a,b,c\nddddd,e,f\n`; after `python -m sheetsite export post.md in.csv out.csv` the file `out.csv` is `a   ,b,c \nddddd,e,f \n` and stdout is `exported: 2 sized columns`.
