# Tasks ported from superlite

Source: `github.com/iha2/superlite` (MIT), commit `0d19ac4`; see `THIRD_PARTY_NOTICES.md`.

| Task | From | Copied verbatim | Changed |
|---|---|---|---|
| `sitegen` | `bench/task/SPEC.md`, `bench/hidden_tests/`, `bench/reference/` | `spec.md` (the SPEC), `hidden/` (89 tests), `reference/` | `repo/` is a README only; `brief.md` is new |
| `brownfield` | `bench/tasks/brownfield/` | `spec.md`, `repo/` (superlite's `start/`, with vendored `rich` 15.0.0 and its LICENSE), `hidden/` (201 tests), `reference_patch/` | `brief.md` is new; `hidden/requirements.txt` pins `playwright==1.62.0` |
| `combo-planted` | `bench/tasks/combo-planted/` | `spec.md`, `repo/` (its `start/` with the 8 defects), `hidden/` (185 tests: 177 plus `suite_planted`) | `repo/.superlite/incidents.jsonl` dropped (a superlite-only memory file whose entries point at four of the defects); `PLANTED.md` and `fixes.patch` live in `answers/`, outside `repo/`; `hidden/requirements.txt` as above; `brief.md` is new |

## How a task runs here

- The hidden tests are copied to `hidden_tests/` in a copy of the owner's merged `main` (`hiddenInto`)
  and run with `test-command`: `PYTHONPATH="$PYTEST_PATH:$PWD/src:$PWD" python3 -m pytest hidden_tests -v`.
  This host has no `uv` and no `python3 -m venv`, so the scorer installs pytest (and the packages in
  `hidden/requirements.txt`) with `python3 -m pip install -q --target <dir>`, sets `PYTEST_PATH` to the
  folder for that call, and removes it afterwards (`runTestCommand` in `bench/score.ts`).
- `playwright` must match the Chromium the host has under `~/.cache/ms-playwright` (revision 1234 is
  Playwright 1.62); the 10 `minisheet` UI tests error on a different pairing. Change the pin with the host.
- `node bench/selfcheck.ts <task>` applies the task's `reference` (a folder or a patch, named in
  `task.json`) to a copy of `repo/` and runs the hidden tests: the reference must pass all, and the
  unfixed `repo/` must fail only what `unfixedFails` says (brownfield: the 24 `suite_feature` tests;
  combo-planted: the 8 `test_planted_*`; sitegen: every test).
- Scoring combo-planted adds `planted: { caught, total: 8 }` to the hidden result: a defect is caught
  when its `test_planted_N_*` test passes on the merged `main`.
- The specs still say `uv run pytest`; pytest is not installed for the owner on this host.
