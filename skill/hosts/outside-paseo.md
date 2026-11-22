# Taro outside Paseo

A session in any coding harness (Claude Code, Codex, others) gets Taro's tickets, cards and checks as
shell commands. Here nothing is required: no Paseo daemon, no plugin, no manager. You get tools, not a workflow;
the harness's own means start any helper agents.

## Find `taro` and the tracker

- `taro` is `bin/taro` in the Taro plugin's folder (Node 22.18 or newer, `git`). Put that folder's `bin/` on
  your `PATH` or call the file by its absolute path.
- A tracker is a folder of ticket files. Pass `--tracker <path>`, or set `$TARO_TRACKER`. A Paseo project's
  is `~/.paseo/plugin-data/taro/home/projects/<name>/tracker`. To try commands, make one with `mktemp -d`.
- A ticket you create here carries the label `external-host`: Paseo's manager and automation leave it alone.
  `taro ticket create <title> --paseo` leaves the label off, for a ticket Paseo should work.

## Take over a Paseo ticket, hand it back

1. Pause its owner: `taro ticket pause <ID>` (needs the Paseo daemon).
2. `taro ticket edit <ID> --add-label external-host`.
3. Work it. Hand it back: `taro ticket edit <ID> --append-notes "HANDOFF …"` saying what is done, what is
   left and where the branch is, then `--remove-label external-host`, then `taro ticket resume <ID>` (needs the daemon).

## Commands

Every command below works with nothing of Paseo's running, except those marked "needs the Paseo daemon".
Set `--project <name>` or `$TARO_PROJECT` for `check` and `deliver`.

| Command | Daemon |
| --- | --- |
| `taro board [--watch]` tickets, open cards, agents | no |
| `taro ticket create`, `taro ticket view`, `taro ticket edit`, `taro ticket list` | no |
| `taro card ask`, `answer`, `withdraw`, `show` | no |
| `taro agent record`, `taro agent finish` | no |
| `taro check -- <command>` logs a result | no |
| `taro deliver <ID>` on an `external-host` ticket | no |
| `taro ticket accept`, `reopen`, `pause`, `resume`, `request-changes`, `change-spec`, `close-round`, `relaunch-owner`; `taro decision answer`, `dismiss` | needs the Paseo daemon (exit 4 when it is not reachable) |
| `taro agent start`, `taro agent stop`, `taro daemon …` | needs the Paseo daemon |

Ask the user with `taro card ask` and read the answer with `taro card show <ID> <cardId> --wait 60`
(exit 0 answered, 5 open, 6 withdrawn). Record helpers you start with `taro agent record`.

## Claude Code (tested)

Put a line in the project's `CLAUDE.md`: "Read `<plugin folder>/skill/hosts/outside-paseo.md` before using
`taro`." The plugin's `skill/` folder is also a skill: link it into `.claude/skills/taro`.

## Codex

Codex reads `AGENTS.md` in the repository: put the same line there. Untested.

## Other harnesses

Use whatever file the harness loads for standing instructions (`AGENTS.md` is the common one), or paste
this page into the first message. Untested.
