# Benchmark: a ticket end to end, a model playing the user

Runs one ticket on a throwaway Paseo daemon with the plugin from a git checkout and scores what came
out, so two versions of the plugin (an *arm* each) can be compared on the same task. Built for TR-207.

## Run

    export PLAYWRIGHT=<a Playwright module directory>   # only for --ui, as tools/shot.cjs takes it
    node bench/run.ts --plugin <checkout> --task <name> --out <dir> \
        [--owner-model claude/claude-opus-5-5] [--subagent-models claude/claude-sonnet-5-5,claude/claude-haiku-5-5] \
        [--max-minutes 90] [--max-usd 25] [--user-minutes-per-card 30] [--ui]
    node bench/report.ts <result dirs…>                      # per task and arm: min / median / max over the runs, flags arms under 3 finished
    node bench/report.ts --pairs <result dir A> <result dir B>   # one run per arm side by side
    node bench/conformance.ts <tracker dir>                  # the workflow check over a whole tracker, read-only

Ported from superlite (MIT; `bench/tasks/PORTED.md` has the sources and what changed): `sitegen` (a static site
generator from a specification, 89 hidden tests), `brownfield` (a feature in an existing Python app, 201 tests)
and `combo-planted` (the same plus 8 planted defects; `result.json` has `planted: { caught, total }`, the number
of `test_planted_N_*` tests that pass on the merged `main`; the report does not print it). They are Python
tasks: this host has no `uv` or venv, so the scorer installs pytest with `pip install --target` for the hidden
run, and the harness installs another copy for the owner and sets the owner's `PYTHONPATH` to it, so the owner runs
`python3 -m pytest` (the specs' `uv run pytest` does not exist here; the task brief says so in one line).

    node bench/selfcheck.ts <task>     # the task's reference must pass every hidden test; the unfixed repo/ must fail only what task.json's unfixedFails says

Tasks added for TR-263: `high-design` (due dates, done and an agenda: seven hidden preferences, three natural children), `high-surprise` (`notes merge`: the brief wants every note to keep its number and the two files' numbers clash, found only while coding), `trivial-rename` (an exact rename) and `low-fix` (one small bug), the last two to show the light levels gain no time. They ship a `reference/` (copied over `repo/`) so the selfcheck proves their hidden tests; the older native tasks ship none, and for them the selfcheck only needs the hidden tests to run and not all pass on the seed (`unfixedPasses` in `task.json` says how many pass on the seed when that is not 0).

Tasks (`bench/tasks/<name>/`): `medium-feature` (export notes to Markdown), `bug-fix` (a tag filter that
matches substrings, plus the neighbours that break the same way), `high-children` (notebooks, search and a
summary over one shared field), `greenfield-modules` (a multi-module build from scratch in a second language:
`notesite`, a static site generator in Python 3.12, standard library, `unittest`; its hidden tests go into the
repository's `tests/` folder, `hiddenInto` in its `task.json`, and run with `-p "test_hidden_*.py"`; its tests
import lazily and use no `subTest`, so a missing module fails its own tests and counts are comparable). Each has `brief.md` (the ticket as a manager files it), `spec.md` (the
decider's full intent with hidden preferences), `repo/` (the seed notes app, plain Node 22, `node --test`),
`hidden/` (tests the owner never sees) and `test-command` (node:test or unittest output is scored).

A checkout is used at its `HEAD` through a `git archive` copy in a `mktemp -d` folder with `bench/` removed
from it and no `.git`, so the owner can neither read nor `git show` the hidden tests or the decider's spec. To run main, give
`--plugin` a checkout whose HEAD is main (a worktree of it, not the main checkout itself).

## Cost and time

A run of an Opus owner is about $5–25 and 30–90 minutes; `--max-usd` (default 25, read from the plugin's own
`stats.json`) and `--max-minutes` (default 90) stop it and `result.json` says which (`stop`). The decider is
Sonnet (each decider agent is deleted once its reply is read), one short turn per card (cents). A Haiku smoke run costs under $3. Every agent costs about 65 of the
host's threads; the harness waits while the host is above 85% of `pids.max`.

## Safety

- The daemon gets its own `mktemp -d` home and a random free port in 6810–6899. `bench/safety.ts` refuses port
  6767, any home under `~/.paseo` or `$PASEO_HOME`, an empty or relative path, and any folder that is not a `taro-bench-*`
  folder made by the run (`bench/safety.test.ts`). Removals run only on such folders, by literal path.
- Cleanup runs on success, on error and on Ctrl-C: the daemon is stopped, anything still running from the run's
  folders is killed by pid, the plugin copy is removed with the other folders, and the home and scratch
  folders are deleted. The log's last lines say what was left (`leftover processes`).
- Nothing touches the real daemon, `~/.paseo` or the main checkout.

## What the run does

1. Starts the daemon, installs the plugin copy, onboards a scratch project (`taro.project.onboard`, no manager).
2. Files the ticket with the task's `brief.md` and starts the owner as the manager does (workspace create,
   `paseo run -d` with the Taro labels and env, the owner prompt with the project facts).
3. The decider (`bench/decider.ts`) answers each card over RPC by default, with no browser: the plan card gets
   Approve and the Accept card Accept by rule (no model call, never Request changes), every other question goes
   to the Sonnet decider and its answer is sent over RPC. A reply that matches no option of the card is
   answered with the card's recommended option and logged as an `unmatched-answer` violation. A permission ask
   has no RPC answer, so rpc mode leaves it for the owner's own handling. `--ui` (needs `PLAYWRIGHT`) answers
   through Paseo's web UI with Playwright instead, screenshots every card
   (`cards/<n>-<id>-<device>-<theme>.png`: desktop dark, phone light) and checks the visible text
   (`bench/card-check.ts`). `result.json` says which in `decider`.
4. When the ticket is Done (or a cap is hit): the hidden tests run on a copy of the scratch repository's
   merged `main`, the ticket and stats are scored, `result.json` is written.

## Files in `<dir>`

`result.json` (below), `decider.log` (JSON lines: prompts, answers, violations), `cards/`, `ticket.md`,
`stats.json`, `hidden-output.txt`, `run.log`.

## What the numbers mean

- `stop`: `done`, `time`, `cost` (the cap), `blocked` (the owner ended `blocked:` and stayed so ten minutes) or `error`. Only a `done` run is scored for hidden tests.
- `costUsd`, `byRole`: from the plugin's `stats.json` for the ticket, each agent's cost at its last turn end,
  per role with its models, peak context, turns and active time. A child ticket's agents count on the parent.
- `decider`: `rpc` (default) or `ui` (`--ui`); results from before it was recorded were all `ui`.
- `caps` and `models`: what the run was allowed and ran on; the report prints both and warns when arms differ.
- `ownerPeakContextTokens`: the owner's largest request, read from its Claude transcript (not the last turn's
  context; the session id comes from the daemon home's stored agent record, as `paseo inspect` has none); `null` when the transcript is not found.
- `hidden`: `{ passed, total }` of the task's hidden tests on merged main; `null` when not run.
- `questions`: cards that asked a question (not the plan or Accept): how many, how many touched a hidden
  preference (the decider says `preference: P1`…), how many the brief already answered (`brief: yes`).
- `conformance`: `shared/conformance.ts` over the ticket: status order, plan sections and limits, APPROVAL before
  building, EVIDENCE `check:` and `review:`, a FINAL within limits, and the plugin's corrections
  (`DELIVERY-ENDED`, `NO-PLAN`, held-back notes, nudges). Over the live tracker it also reports old tickets
  that predate the templates; compare arms, not the absolute count.
- `cardsAfterApproval`, `userMinutesModelled`, `wallMinutes`, `wallMinutesWithUser`, `preferences`: cards (not the plan or Accept) answered after the first Approve of the round; every card answered at `--user-minutes-per-card` (default 30) each, added to the wall minutes; the hidden preferences the decider touched, once each, split by the time of the first Approve (`bench/score.ts`, `scoreCards`). `bench/report.ts` prints each as min / median / max.
- `records`: how many RISKS, RULING, EVIDENCE and FINAL records the ticket holds.
- `cardFailures`: `card-text` (a leaked `undefined`, raw JSON, a missing option…) and `card-missing` (a card the
  decider could not find or use on screen within two minutes, then answered over RPC).

## The decider's limits

- It is one Sonnet turn per card with the spec, the brief and what it decided before; it does not see the
  owner's chat, only the card, so it cannot judge anything the card does not show.
- It requests changes on a plan or on Accept at most twice per kind, then approves, so a run always ends.
- A model's answers vary between runs: one run per task and arm is a pilot, not a statistic. Differences of a
  few dollars or one hidden test are noise.
- A card asking several questions is answered question by question in the UI (a tab, then Next, then Submit), with one `answer` per question in `decider.log`.
- It plays the user for decisions only. It does not test whether the delivered UI looks right.
- The card text check looks for leaks in the card's own text; it cannot tell a wrong but well-formed card.

## Tests

`shared/conformance.test.ts`, `bench/safety.test.ts`, `bench/card-check.test.ts`, `bench/score.test.ts`,
`bench/report.test.ts` (`npm test`). The tasks' own tests run with `node --test` inside a task's `repo/` and
are kept out of vitest.
