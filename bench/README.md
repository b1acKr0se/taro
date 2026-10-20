# Benchmark: a ticket end to end, a model playing the user

Runs one ticket on a throwaway Paseo daemon with the plugin from a git checkout and scores what came
out, so two versions of the plugin (an *arm* each) can be compared on the same task. Built for TR-207.

## Run

    export PLAYWRIGHT=<a Playwright module directory>   # as tools/shot.cjs takes it
    node bench/run.ts --plugin <checkout> --task <name> --out <dir> \
        [--owner-model claude/claude-opus-5-5] [--subagent-models claude/claude-sonnet-5-5,claude/claude-haiku-5-5] \
        [--max-minutes 90] [--max-usd 25]
    node bench/report.ts <result dir A> <result dir B> …     # a Markdown table per task, arm A against arm B
    node bench/conformance.ts <tracker dir>                  # the workflow check over a whole tracker, read-only

Tasks (`bench/tasks/<name>/`): `medium-feature` (export notes to Markdown), `bug-fix` (a tag filter that
matches substrings, plus the neighbours that break the same way), `high-children` (notebooks, search and a
summary over one shared field). Each has `brief.md` (the ticket as a manager files it), `spec.md` (the
decider's full intent with hidden preferences), `repo/` (the seed notes app, plain Node 22, `node --test`),
`hidden/` (tests the owner never sees) and `test-command`.

A checkout is used at its `HEAD` through a `git worktree add --detach` copy in a `mktemp -d` folder with
`bench/` removed from it, so the owner cannot read the hidden tests or the decider's spec. To run main, give
`--plugin` a checkout whose HEAD is main (a detached worktree of it, not the main checkout itself).

## Cost and time

A run of an Opus owner is about $5–25 and 30–90 minutes; `--max-usd` (default 25, read from the plugin's own
`stats.json`) and `--max-minutes` (default 90) stop it and `result.json` says which (`stop`). The decider is
Sonnet, one short turn per card (cents). A Haiku smoke run costs under $3. Every agent costs about 65 of the
host's threads; the harness waits while the host is above 85% of `pids.max`.

## Safety

- The daemon gets its own `mktemp -d` home and a random free port in 6810–6899. `bench/safety.ts` refuses port
  6767, any home under `~/.paseo`, an empty or relative path, and any folder that is not a `taro-bench-*`
  folder made by the run (`bench/safety.test.ts`). Removals run only on such folders, by literal path.
- Cleanup runs on success, on error and on Ctrl-C: the daemon is stopped, anything still running from the run's
  folders is killed by pid, the plugin copy is removed with `git worktree remove`, and the home and scratch
  folders are deleted. The log's last lines say what was left (`leftover processes`).
- Nothing touches the real daemon, `~/.paseo` or the main checkout.

## What the run does

1. Starts the daemon, installs the plugin copy, onboards a scratch project (`taro.project.onboard`, no manager).
2. Files the ticket with the task's `brief.md` and starts the owner as the manager does (workspace create,
   `paseo run -d` with the Taro labels and env, the owner prompt with the project facts).
3. The decider (`bench/decider.ts`) answers each card through Paseo's web UI with Playwright and the Accept
   card at the end. It screenshots every card (`cards/<n>-<id>-<device>-<theme>.png`: desktop dark, phone
   light) and checks the visible text (`bench/card-check.ts`).
4. When the ticket is Done (or a cap is hit): the hidden tests run on a copy of the scratch repository's
   merged `main`, the ticket and stats are scored, `result.json` is written.

## Files in `<dir>`

`result.json` (below), `decider.log` (JSON lines: prompts, answers, violations), `cards/`, `ticket.md`,
`stats.json`, `hidden-output.txt`, `run.log`.

## What the numbers mean

- `stop`: `done`, `time`, `cost` (the cap) or `error`. A capped run is not scored for hidden tests.
- `costUsd`, `byRole`: from the plugin's `stats.json` for the ticket, each agent's cost at its last turn end,
  per role with its models, peak context, turns and active time. A child ticket's agents count on the parent.
- `hidden`: `{ passed, total }` of the task's hidden tests on merged main; `null` when not run.
- `questions`: cards that asked a question (not the plan or Accept): how many, how many touched a hidden
  preference (the decider says `preference: P1`…), how many the brief already answered (`brief: yes`).
- `conformance`: `shared/conformance.ts` over the ticket: status order, plan sections and limits, APPROVAL before
  building, EVIDENCE `check:` and `review:`, a FINAL within limits, and the plugin's corrections
  (`DELIVERY-ENDED`, `NO-PLAN`, held-back notes, nudges). Over the live tracker it also reports old tickets
  that predate the templates; compare arms, not the absolute count.
- `records`: how many RISKS, RULING, EVIDENCE and FINAL records the ticket holds.
- `cardFailures`: `card-text` (a leaked `undefined`, raw JSON, a missing option…) and `card-missing` (a card the
  decider could not find or use on screen within two minutes, then answered over RPC).

## The decider's limits

- It is one Sonnet turn per card with the spec, the brief and what it decided before; it does not see the
  owner's chat, only the card, so it cannot judge anything the card does not show.
- It requests changes on a plan or on Accept at most twice per kind, then approves, so a run always ends.
- A model's answers vary between runs: one run per task and arm is a pilot, not a statistic. Differences of a
  few dollars or one hidden test are noise.
- It plays the user for decisions only. It does not test whether the delivered UI looks right.
- The card text check looks for leaks in the card's own text; it cannot tell a wrong but well-formed card.

## Tests

`shared/conformance.test.ts`, `bench/safety.test.ts`, `bench/card-check.test.ts`, `bench/score.test.ts`,
`bench/report.test.ts` (`npm test`). The tasks' own tests run with `node --test` inside a task's `repo/` and
are kept out of vitest.
