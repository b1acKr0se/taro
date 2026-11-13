# E12 combo-planted: the planted defects

Kept out of `start/` on purpose. `start/` is the clean combined reference (sitegen + minisheet, `benchsuite`)
with the 8 defects below. `fixes.patch` turns `start/src` back into the clean reference
(`git apply fixes.patch` from the repo root of a copy of `start/`).

Four defects (D1-D4) sit next to seeded entries in `start/.superlite/incidents.jsonl` (same file, 1-3 lines
away, plausible context text, no hint of the actual bug). Four (D5-D8) are controls with no entries.

| # | Group | File : line (in start/) | Defect | Spec | Detecting test |
|---|---|---|---|---|---|
| D1 | entry (line 13) | `src/sitegen/feed.py:14` | `_DATE_RE.match` instead of `.fullmatch`: dates with trailing text (`2024-01-15T10:00:00`, `2024-01-155`) are accepted | Part A 6 | `test_planted_1_rss_rejects_dates_with_trailing_text` |
| D2 | entry (line 150) | `src/minisheet/functions.py:152` | `math.floor(n)` instead of `math.trunc(n)` for ROUND's digits: `ROUND(15.5,-0.5)` gives 20 not 16 | Part B 6 | `test_planted_2_round_truncates_digits_toward_zero` |
| D3 | entry (line 144) | `src/minisheet/workbook.py:146` | `_unregister` no longer drops `_range_users[key]`: an overwritten range formula keeps depending on its old range (extra entries in `last_changed`, extra `recalc_count`) | Part B 7 | `test_planted_3_overwritten_range_formula_stops_depending_on_range` |
| D4 | entry (line 49) | `src/sitegen/links.py:50` | the href is no longer `.strip()`ped: padded hrefs resolve wrongly and are reported unstripped | Part A 8 | `test_planted_4_href_whitespace_is_stripped` |
| D5 | control | `src/sitegen/site.py:162` | posts sorted by `(date, slug)` descending: same-date ties come out slug DESCENDING | Part A 9 | `test_planted_5_same_date_posts_are_ordered_by_slug_ascending` |
| D6 | control | `src/sitegen/search.py:40` | duplicate query terms no longer de-duplicated (`dict.fromkeys` dropped): the score double counts them and can reorder results | Part A 7 | `test_planted_6_duplicate_query_terms_do_not_double_the_score` |
| D7 | control | `src/minisheet/csvio.py:41` | `_field` no longer quotes fields containing `\r`: CSV save/load round trip splits the cell | Part B 8 | `test_planted_7_csv_save_quotes_carriage_return` |
| D8 | control | `src/minisheet/cli.py:37` | `show` computes the row-number width from the first row (`a.row`) instead of the last (`b.row`): `show A9:A10` misaligns | Part B 9 | `test_planted_8_show_grid_row_number_width_uses_largest_row` |

## Design notes

- The 177 combo tests do not detect any of the 8 defects: all 177 pass on `start/`. Only the 8 `test_planted_*`
  tests (`hidden/suite_planted/test_planted.py`) fail. Each defect is detected by exactly one test, and each
  test fails only for its own defect (checked by applying the mutations one at a time).
- The reference's own tests (`start/tests/`) caught D4 and D8, so two assertions were removed from them
  (`tests/minisheet/test_io.py::test_cli_show`, `tests/sitegen/test_units.py::test_links_misc`). With that,
  `uv run pytest` on `start/` is green (189 passed), like a branch whose tests simply missed these cases.
- Score for an arm: planted defects fixed (the 8 `test_planted_*` tests) plus the hidden 177.

## Validation (from the superlite repo root)

```
BENCH_TASK=combo-planted  # then, with bench/harness.py hidden_score(run_dir):
start/             -> 177 / 185 passed; the 8 planted tests fail
start/ + fixes     -> 185 / 185 passed
```
