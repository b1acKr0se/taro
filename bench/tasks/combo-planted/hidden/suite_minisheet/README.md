# minisheet hidden acceptance suite

88 tests written from SPEC.md alone. Run from the directory that contains `hidden/`
(PYTHONPATH must point at the implementation; no pyproject or install is needed):

    PYTHONPATH=<impl>/src:<impl> uv run --no-project --with pytest --with playwright python -m pytest hidden -q

UI tests need Chromium (`playwright install chromium`). If Playwright or Chromium is
unavailable the UI tests fail with a message starting `INFRA:` (infrastructure failure, not a pass).

The `server` fixture is function-scoped: each API/UI test gets its own server and
therefore a fresh workbook (the SPEC offers no reset).

Counts: refs 6, lexer 6, parser 10, evaluator 12, workbook 12, functions 14, csvio 5,
cli 5, api 8, ui 10.
